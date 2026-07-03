// Thin wrapper around nodemailer (SMTP send) and imapflow (IMAP fetch).
// Works with Gmail, Outlook, or any IMAP/SMTP provider using an app password.
//
// IMPORTANT serverless adaptation: the original polled the inbox forever in a
// while-loop. On Vercel, each cron invocation opens one IMAP connection,
// fetches whatever's new since the last processed UID (persisted in the
// `imap_cursor` table so it's safe across invocations), processes a bounded
// batch, and closes the connection — well within the function's max duration.

import nodemailer from 'nodemailer';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { config } from './config';
import { getImapCursor, setImapCursor } from './db';
import { uploadBuffer, buckets } from './storage';

// Cap how many messages one cron invocation will process, so a mail backlog
// can never blow through the 300s Vercel function timeout. Remaining
// messages are simply picked up on the next cron run.
const MAX_MESSAGES_PER_RUN = 15;

export async function sendEmail(
  toAddress: string,
  subject: string,
  body: string,
  attachment?: { filename: string; content: Buffer } | null
) {
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpPort === 465,
    auth: { user: config.emailAddress, pass: config.emailPassword },
  });

  await transporter.sendMail({
    from: config.emailAddress,
    to: toAddress,
    subject,
    text: body,
    attachments: attachment ? [{ filename: attachment.filename, content: attachment.content }] : undefined,
  });

  console.log(`Sent email to ${toAddress}: ${subject}`);
}

export type FetchedReply = {
  from: string;
  subject: string;
  body: string;
  /** Storage paths (in the attachments bucket) of any saved attachments. */
  attachments: string[];
};

/**
 * Fetches new messages since the last recorded UID for the mailbox and
 * uploads any attachments to Supabase Storage. Does NOT rely on IMAP \Seen
 * flags (safer across retried/overlapping invocations) — instead advances a
 * persisted UID cursor once each message is fetched.
 */
export async function fetchUnreadReplies(): Promise<FetchedReply[]> {
  const results: FetchedReply[] = [];
  const mailbox = 'INBOX';

  const client = new ImapFlow({
    host: config.imapHost,
    port: config.imapPort,
    secure: true,
    auth: { user: config.emailAddress, pass: config.emailPassword },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const lastUid = await getImapCursor(mailbox);

      // Search for UIDs greater than the last one we processed.
      const searchRange = `${lastUid + 1}:*`;
      let highestUidSeen = lastUid;
      let processed = 0;

      for await (const message of client.fetch(
        { uid: searchRange },
        { uid: true, envelope: true, source: true }
      )) {
        if (message.uid <= lastUid) continue; // guard against inclusive range edge case
        if (processed >= MAX_MESSAGES_PER_RUN) break;

        try {
          const parsed = await simpleParser(message.source as Buffer);
          const fromAddr = parsed.from?.value?.[0]?.address || '';
          const subject = parsed.subject || '';
          const body = (parsed.text || '').trim();

          const attachmentPaths: string[] = [];
          for (const att of parsed.attachments || []) {
            const path = `${Date.now()}-${att.filename || 'attachment.pdf'}`;
            await uploadBuffer(buckets.attachments, path, att.content, att.contentType || 'application/octet-stream');
            attachmentPaths.push(path);
          }

          results.push({ from: fromAddr, subject, body, attachments: attachmentPaths });
        } catch (exc) {
          // Don't let one bad message (e.g. a failed attachment upload) block
          // the whole batch forever — log it, skip it, and keep the cursor
          // moving so it's never retried on every subsequent poll.
          console.error(`Failed to process message uid=${message.uid}, skipping:`, exc);
        }

        // Advance regardless of success/failure above, so a persistently
        // failing message can't wedge the cursor and get refetched forever.
        highestUidSeen = Math.max(highestUidSeen, message.uid);
        processed += 1;

        // Persist after each message rather than only at the end, so a crash
        // partway through a batch doesn't lose progress on earlier messages.
        await setImapCursor(mailbox, highestUidSeen);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return results;
}

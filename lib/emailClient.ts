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
import { getImapCursor, setImapCursor, listContractEmailIds } from './db';
import { uploadBuffer, buckets } from './storage';
import { extractContractIdFromSubject } from './contractTag';

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
  /** Contract this reply's [CB-<id>] tag was matched to. */
  contractId: number;
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

  const contractPairs = await listContractEmailIds();
  const idsByEmail = new Map<string, Set<number>>();
  for (const { id, client_email } of contractPairs) {
    const key = client_email.toLowerCase();
    if (!idsByEmail.has(key)) idsByEmail.set(key, new Set());
    idsByEmail.get(key)!.add(id);
  }

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

      // Pass 1: envelope-only scan (cheap — no body/attachment download) to
      // find which UIDs are from a known contract sender. Cursor is advanced
      // through unrelated mail freely, but stops right before any matched
      // reply beyond the per-run cap, so nothing real is ever skipped.
      const scanned: { uid: number; matched: boolean }[] = [];
      for await (const message of client.fetch({ uid: searchRange }, { uid: true, envelope: true })) {
        if (message.uid <= lastUid) continue; // guard against inclusive range edge case
        const fromAddr = (message.envelope?.from?.[0]?.address || '').toLowerCase();
        const subject = message.envelope?.subject || '';
        const contractIds = idsByEmail.get(fromAddr);
        const taggedId = extractContractIdFromSubject(subject);

        // Require BOTH: sender is a known contract email, AND the subject
        // carries a [CB-<id>] tag that actually belongs to that sender's
        // contract. This rejects unrelated mail from a known client address
        // (e.g. a different, non-contract conversation) as well as mail
        // from unknown senders.
        const matched = !!contractIds && taggedId !== null && contractIds.has(taggedId);
        scanned.push({ uid: message.uid, matched });
      }
      scanned.sort((a, b) => a.uid - b.uid);

      let highestUidSeen = lastUid;
      const matchedUids: number[] = [];
      let matchedRemaining = 0;

      for (const item of scanned) {
        if (item.matched) {
          if (matchedUids.length < MAX_MESSAGES_PER_RUN) {
            matchedUids.push(item.uid);
            highestUidSeen = item.uid;
          } else {
            matchedRemaining += 1; // left for next run; stop advancing past it
          }
        } else if (matchedRemaining === 0) {
          // Only safe to skip past unrelated mail while we haven't yet hit a
          // capped-out matched reply — otherwise we'd advance past it too.
          highestUidSeen = item.uid;
        }
      }

      if (highestUidSeen > lastUid) {
        await setImapCursor(mailbox, highestUidSeen);
      }

      // Pass 2: only now fetch full source (body + attachments) for the
      // messages that actually matter.
      if (matchedUids.length) {
        for await (const message of client.fetch(
          { uid: matchedUids.join(',') },
          { uid: true, envelope: true, source: true }
        )) {
          const fromAddr = (message.envelope?.from?.[0]?.address || '').toLowerCase();
          try {
            const parsed = await simpleParser(message.source as Buffer);
            const subject = parsed.subject || '';
            const body = (parsed.text || '').trim();
            const contractId = extractContractIdFromSubject(subject);

            if (contractId === null) {
              // Shouldn't happen (this UID was matched in pass 1), but guard
              // against a malformed/edited subject just in case.
              console.warn(`Message uid=${message.uid} lost its contract tag between passes, skipping`);
              continue;
            }

            const attachmentPaths: string[] = [];
            for (const att of parsed.attachments || []) {
              const path = `${Date.now()}-${att.filename || 'attachment.pdf'}`;
              await uploadBuffer(buckets.attachments, path, att.content, att.contentType || 'application/octet-stream');
              attachmentPaths.push(path);
            }

            results.push({ from: fromAddr, subject, body, contractId, attachments: attachmentPaths });
          } catch (exc) {
            // Don't let one bad message (e.g. a failed attachment upload)
            // block the rest — log it and move on. This UID is already past
            // the cursor from pass 1, so it won't be retried on every poll.
            console.error(`Failed to process message uid=${message.uid}, skipping:`, exc);
          }
        }
      }

      if (matchedRemaining > 0) {
        console.log(`${matchedRemaining} more matched reply(ies) left for next run (per-run cap reached)`);
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }

  return results;
}

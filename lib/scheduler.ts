// Daily expiry scan + inbox poll — ported from scheduler.py. On Vercel these
// run as bounded, single-shot cron invocations instead of an infinite loop
// (see /app/api/cron/*/route.ts and vercel.json).

import { config } from './config';
import * as db from './db';
import * as aiEngine from './aiEngine';
import { sendEmail } from './emailClient';
import { fetchUnreadReplies, pollMailbox } from './emailClient';
import type { ImapFlow } from 'imapflow';
import { processIncomingReply } from './replyProcessor';
import { downloadBuffer, buckets } from './storage';
import { withContractTag } from './contractTag';

export async function runExpiryScan() {
  const expiring = await db.listExpiringContracts(config.expiryWarningDays);
  console.log(`Expiry scan found ${expiring.length} contract(s) approaching expiry`);

  for (const contract of expiring) {
    if (contract.status === 'renewal_sent') continue; // already reminded, waiting on reply

    try {
      const body = await aiEngine.draftRenewalReminderEmail(
        contract.client_name,
        contract.expiry_date,
        contract.contract_link || ''
      );

      let attachment: { filename: string; content: Buffer } | null = null;
      if (contract.template_path) {
        try {
          const buf = await downloadBuffer(buckets.templates, contract.template_path);
          attachment = { filename: contract.template_path, content: buf };
        } catch (exc) {
          console.warn(`Template not found for contract ${contract.id}:`, exc);
        }
      }

      await sendEmail(
        contract.client_email,
        withContractTag('Your contract renewal is coming up', contract.id),
        body,
        attachment
      );
      await db.logMessage(
        contract.id,
        'outbound',
        config.emailAddress,
        withContractTag('Your contract renewal is coming up', contract.id),
        body
      );
      await db.updateContract(contract.id, { status: 'renewal_sent' });
    } catch (exc) {
      console.error(
        `Failed to process renewal reminder for ${contract.client_email} (contract id ${contract.id}) — will retry next scan`,
        exc
      );
    }
  }

  if (expiring.length && config.employeeEmails.length) {
    const reportLines = expiring.map(
      (c) => `- ${c.client_name} (${c.client_email}) — expires ${c.expiry_date}, status: ${c.status}`
    );
    const reportBody = 'Contracts approaching expiry:\n\n' + reportLines.join('\n');
    for (const employeeEmail of config.employeeEmails) {
      try {
        await sendEmail(employeeEmail, `Upcoming contract renewals (${expiring.length})`, reportBody);
      } catch (exc) {
        console.error(`Failed to send expiry report to employee ${employeeEmail}:`, exc);
      }
    }
  }

  return { scanned: expiring.length };
}

export async function runReplyPoll(client?: ImapFlow) {
  const replies = client ? await pollMailbox(client) : await fetchUnreadReplies();
  console.log(`Found ${replies.length} new reply(ies)`);
  let ok = 0;
  let failed = 0;
  for (const reply of replies) {
    try {
      await processIncomingReply(reply);
      ok += 1;
    } catch (exc) {
      failed += 1;
      console.error(`Failed to process reply from ${reply.from}:`, exc);
    }
  }
  return { found: replies.length, processed: ok, failed };
}

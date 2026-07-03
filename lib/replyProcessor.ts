// The core workflow. This mirrors the original diagrams exactly:
//
//   inbound reply
//     -> is AI still managing this contract? if not, log and stop (human took over)
//     -> classify intent: confirmation / changes_requested / unclear
//     -> changes_requested -> acknowledge, escalate to employee with summary + PDF
//     -> unclear            -> escalate to employee as an AI-failure case
//     -> confirmation        -> check attached contract for a signature
//          -> signed          -> queue for human final confirmation
//          -> missing         -> reply asking client to sign and resend
//          -> unknown         -> escalate to employee

import { config } from './config';
import * as db from './db';
import * as aiEngine from './aiEngine';
import { sendEmail, type FetchedReply } from './emailClient';
import { checkSignature } from './pdfSignature';
import { compareDocuments } from './pdfCompare';
import { buildEscalationPdf } from './pdfExport';
import { downloadBuffer, buckets } from './storage';
import type { Contract, ConversationMessage } from './db';

async function escalate(contract: Contract, reason: string, messages: ConversationMessage[]) {
  const summary = await aiEngine.summarizeConversation(messages);
  await db.createEscalation(contract.id, reason, summary);

  const pdfPath = await buildEscalationPdf(contract, messages, summary, reason);
  const pdfBuffer = await downloadBuffer(buckets.exports, pdfPath);

  for (const employeeEmail of config.employeeEmails) {
    await sendEmail(
      employeeEmail,
      `[Action needed] Contract renewal — ${contract.client_name}`,
      `A contract renewal for ${contract.client_name} needs your review.\n\n` +
        `Reason: ${reason.replace(/_/g, ' ')}\n\n` +
        `Summary:\n${summary}\n\n` +
        `Full conversation attached as PDF.`,
      { filename: pdfPath, content: pdfBuffer }
    );
  }
  console.log(`Escalated contract ${contract.id} (${reason})`);
}

export async function processIncomingReply(rawReply: FetchedReply) {
  const senderEmail = rawReply.from;
  const contract = await db.getContract(rawReply.contractId);

  if (!contract || contract.client_email.toLowerCase() !== senderEmail.toLowerCase()) {
    console.warn(
      `Reply tagged for contract ${rawReply.contractId} but sender ${senderEmail} doesn't match — skipping`
    );
    return;
  }

  // Always log the inbound message, even if AI has been taken off this contract.
  await db.logMessage(contract.id, 'inbound', senderEmail, rawReply.subject, rawReply.body);

  if (!contract.ai_managed) {
    console.log(`Contract ${contract.id} is human-managed — AI will not act on this reply`);
    return;
  }

  const classification = await aiEngine.classifyReply(rawReply.body);
  const intent = classification.intent;
  console.log(`Contract ${contract.id} classified as ${intent} (${classification.confidence})`);

  const messages = await db.getConversation(contract.id);

  if (intent === 'unclear') {
    await escalate(contract, 'classification_failed', messages);
    return;
  }

  if (intent === 'changes_requested') {
    const ack = await aiEngine.draftAcknowledgmentEmail(contract.client_name);
    await sendEmail(senderEmail, `Re: ${rawReply.subject}`, ack);
    await db.logMessage(contract.id, 'outbound', config.emailAddress, `Re: ${rawReply.subject}`, ack);
    await escalate(contract, 'changes_requested', await db.getConversation(contract.id));
    return;
  }

  // intent === "confirmation" -> verify it's the same contract we sent, then check signature
  if (!rawReply.attachments.length) {
    await escalate(contract, 'no_contract_attached', messages);
    return;
  }

  const submittedPath = rawReply.attachments[0];
  const submittedBuffer = await downloadBuffer(buckets.attachments, submittedPath);

  let templateBuffer: Buffer | null = null;
  if (contract.template_path) {
    try {
      templateBuffer = await downloadBuffer(buckets.templates, contract.template_path);
    } catch (exc) {
      console.warn(`Could not download template ${contract.template_path}:`, exc);
    }
  }

  const matchResult = await compareDocuments(templateBuffer, submittedBuffer);
  await db.updateContract(contract.id, { match_status: matchResult.match ? 'match' : 'mismatch' });

  if (!matchResult.match) {
    await db.updateContract(contract.id, { status: 'flagged' });
    console.warn(
      `Contract ${contract.id} flagged — returned document does not match template (${matchResult.reason})`
    );
    await escalate(contract, 'contract_mismatch', await db.getConversation(contract.id));
    return;
  }

  const signatureStatus = await checkSignature(submittedBuffer);
  await db.updateContract(contract.id, { signature_status: signatureStatus });

  if (signatureStatus === 'signed') {
    // AI has verified the contract matches the template and is signed — but
    // final renewal confirmation is a human decision. Queue it for review
    // instead of updating status to "renewed" directly.
    await db.updateContract(contract.id, { status: 'pending_confirmation' });
    console.log(`Contract ${contract.id} matched and signed — queued for human final confirmation`);
    await escalate(contract, 'ready_for_confirmation', await db.getConversation(contract.id));
  } else if (signatureStatus === 'missing') {
    const replyBody = await aiEngine.draftSignatureMissingEmail(contract.client_name);
    await sendEmail(senderEmail, `Re: ${rawReply.subject}`, replyBody);
    await db.logMessage(contract.id, 'outbound', config.emailAddress, `Re: ${rawReply.subject}`, replyBody);
  } else {
    // "unknown" — could not read the PDF at all
    await escalate(contract, 'signature_check_failed', await db.getConversation(contract.id));
  }
}

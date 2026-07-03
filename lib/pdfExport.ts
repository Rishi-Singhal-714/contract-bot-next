// Builds the PDF forwarded to an employee: the full email thread plus the
// AI-generated summary. Uploaded to the Supabase "exports" bucket (replacing
// the original's local EXPORTS_DIR) and returned as a storage path.

import PDFDocument from 'pdfkit';
import type { Contract, ConversationMessage } from './db';
import { uploadBuffer, buckets } from './storage';

export async function buildEscalationPdf(
  contract: Contract,
  messages: ConversationMessage[],
  aiSummary: string,
  reason: string
): Promise<string> {
  const doc = new PDFDocument({ margin: 54 }); // 0.75in
  const chunks: Buffer[] = [];
  doc.on('data', (chunk) => chunks.push(chunk));

  const done = new Promise<Buffer>((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
  });

  doc.fontSize(20).text('Contract renewal — needs your review', { align: 'left' });
  doc.moveDown(0.5);
  doc.fontSize(11).text(`Client: ${contract.client_name} (${contract.client_email})`);
  doc.text(`Contract expiry: ${contract.expiry_date}`);
  doc.text(`Reason for escalation: ${reason.replace(/_/g, ' ')}`);
  if (contract.contract_link) doc.text(`Contract link: ${contract.contract_link}`);
  doc.moveDown();

  doc.fontSize(14).text('AI summary', { underline: true });
  doc.fontSize(11).text(aiSummary || 'No summary available.');
  doc.moveDown();

  doc.fontSize(14).text('Full conversation', { underline: true });
  doc.moveDown(0.5);
  for (const m of messages) {
    doc.fontSize(9).fillColor('#555555').text(`${m.direction.toUpperCase()} — ${m.sender} — ${m.timestamp}`);
    doc.fontSize(11).fillColor('#000000').text(m.body || '');
    doc.moveDown(0.5);
  }

  doc.end();
  const buffer = await done;

  const filename = `contract_${contract.id}_${new Date().toISOString().slice(0, 10)}.pdf`;
  await uploadBuffer(buckets.exports, filename, buffer, 'application/pdf');
  return filename;
}

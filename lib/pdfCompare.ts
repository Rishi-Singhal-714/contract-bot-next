// Compares a contract PDF the client sends back against the original template
// — catches "is this the same contract we sent, or did something change".
//
// Approach: extract text from both PDFs, strip lines expected to differ
// (signatures, dates, page numbers), normalize whitespace/case, then compare
// with a sequence-similarity ratio (mirrors Python's difflib.SequenceMatcher).

import { diffChars } from 'diff';
import { config } from './config';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

const IGNORE_LINE_PATTERNS = [
  /^signed\s*by\s*[:\-]?.*/i,
  /^signature\s*[:\-]?.*/i,
  /^\/s\/.*/i,
  /^digitally\s+signed\s+by.*/i,
  /^e-?signed\s+by.*/i,
  /^\s*date\s*[:\-].*/i,
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,
];

async function extractNormalizedText(pdfBuffer: Buffer): Promise<string> {
  const data = await pdfParse(pdfBuffer);
  const lines: string[] = [];
  for (const rawLine of (data.text || '').split('\n')) {
    let clean = rawLine.trim().toLowerCase();
    if (!clean) continue;
    if (IGNORE_LINE_PATTERNS.some((p) => p.test(clean))) continue;
    clean = clean.replace(/\s+/g, ' ');
    lines.push(clean);
  }
  return lines.join('\n');
}

/** Sequence-similarity ratio in [0, 1], equivalent in spirit to difflib.SequenceMatcher.ratio(). */
function similarityRatio(a: string, b: string): number {
  if (!a.length && !b.length) return 1;
  const parts = diffChars(a, b);
  let matched = 0;
  for (const part of parts) {
    if (!part.added && !part.removed) matched += part.value.length;
  }
  return (2 * matched) / (a.length + b.length);
}

export type CompareResult = { match: boolean; similarity: number; reason: string };

export async function compareDocuments(
  templateBuffer: Buffer | null,
  submittedBuffer: Buffer
): Promise<CompareResult> {
  if (!templateBuffer) {
    return { match: false, similarity: 0.0, reason: 'No template on file to compare against' };
  }

  let templateText: string;
  try {
    templateText = await extractNormalizedText(templateBuffer);
  } catch (exc: any) {
    console.warn('Could not read template PDF:', exc);
    return { match: false, similarity: 0.0, reason: `Could not read template PDF: ${exc.message || exc}` };
  }

  let submittedText: string;
  try {
    submittedText = await extractNormalizedText(submittedBuffer);
  } catch (exc: any) {
    console.warn('Could not read submitted PDF:', exc);
    return { match: false, similarity: 0.0, reason: `Could not read submitted PDF: ${exc.message || exc}` };
  }

  if (!templateText || !submittedText) {
    return { match: false, similarity: 0.0, reason: 'One of the documents had no extractable text' };
  }

  const similarity = similarityRatio(templateText, submittedText);
  const match = similarity >= config.contractMatchThreshold;

  const reason = match
    ? `Similarity ${(similarity * 100).toFixed(0)}% vs ${(config.contractMatchThreshold * 100).toFixed(0)}% threshold`
    : `Content differs from template — similarity only ${(similarity * 100).toFixed(0)}%`;

  return { match, similarity, reason };
}

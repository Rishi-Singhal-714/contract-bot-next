// Signature detection on an attached contract PDF.
//
// This is a HEURISTIC starting point, not a production-grade solution. It
// checks the last two pages of the PDF for text-based signature markers, or
// an embedded image on the last page (common for scanned/pasted signatures).
//
// For production reliability, prefer DocuSign/Adobe Sign/HelloSign's API
// instead of parsing the PDF yourself.
//
// Returns one of: "signed", "missing", "unknown" (unknown = couldn't read the PDF at all).

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfParse = require('pdf-parse');

const SIGNATURE_MARKERS = [
  /signed\s*by\s*[:\-]?\s*\S+/i,
  /signature\s*[:\-]?\s*\S+/i,
  /\/s\/\s*\S+/i,
  /digitally\s+signed\s+by\s+\S+/i,
  /e-?signed\s+by\s+\S+/i,
];

const EMPTY_MARKERS = [
  /signature\s*[:\-]?\s*_{2,}/i, // "Signature: ____"
  /signature\s*[:\-]?\s*$/im, // "Signature:" with nothing after it
  /sign\s+here/i,
];

export type SignatureStatus = 'signed' | 'missing' | 'unknown';

export async function checkSignature(pdfBuffer: Buffer): Promise<SignatureStatus> {
  try {
    // pdf-parse gives whole-document text; we don't have per-page image info
    // without a heavier PDF lib, so we approximate the original's "last two
    // pages" text-marker check against the tail of the document, and fall
    // back to "missing" (rather than assuming an image = signature) since we
    // can't reliably detect embedded images per-page here. If you need the
    // embedded-image fallback from the original heuristic, swap in
    // `pdfjs-dist` for page-level rendering.
    const data = await pdfParse(pdfBuffer);
    const fullText = (data.text || '').toLowerCase();

    // Approximate "last two pages" by taking the tail portion of the text,
    // proportional to how many pages exist.
    const numPages = data.numpages || 1;
    const fraction = numPages > 1 ? 2 / numPages : 1;
    const tailStart = Math.max(0, Math.floor(fullText.length * (1 - fraction)));
    const tailText = fullText.slice(tailStart);

    for (const pattern of EMPTY_MARKERS) {
      if (pattern.test(tailText)) return 'missing';
    }
    for (const pattern of SIGNATURE_MARKERS) {
      if (pattern.test(tailText)) return 'signed';
    }

    return 'missing';
  } catch (exc) {
    console.warn('Could not inspect PDF for signature:', exc);
    return 'unknown';
  }
}

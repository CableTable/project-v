// ai-file.js — .ai files open as PDFs when Illustrator saved them PDF-compatible (T12).
export const OPEN_EXTS = ['pdf', 'ai'];
export const NO_PDF_PART = "This .ai file has no PDF part. In Illustrator, save it again with 'Create PDF Compatible File' on.";

export const isAi = (name) => /\.ai$/i.test(name);

/** True when `%PDF` is in the first 1024 bytes (a PDF header may follow a little junk). */
export function hasPdfHeader(bytes) {
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i + 4 <= head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) return true;
  }
  return false;
}

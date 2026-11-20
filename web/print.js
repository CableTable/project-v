// print.js — pure numbers for printing (T11): the page size in CSS points and the render scale for the print dpi.
export const PRINT_DPI = 300, BIG_DPI = 150, BIG_DOC_PAGES = 100; // shortcut: fixed 100-page line, upgrade to a RAM-based cap if big sets get printed
export const MAX_SIDE = 16384, MAX_PIXELS = 268e6; // Chromium canvas limits (px a side, px area)

/** The page's size in CSS pt (1 pt = 1/72 in): a pdf.js viewport at scale 1 is in pt, rotation already applied. */
export const pageCss = ({ width, height }) => ({ w: Math.round(width * 100) / 100, h: Math.round(height * 100) / 100 });

/** The dpi for a document: 300, or 150 over 100 pages (memory: every page's PNG is held until the dialog closes). */
export const dpiFor = (pageCount) => pageCount > BIG_DOC_PAGES ? BIG_DPI : PRINT_DPI;

/** pdf.js render scale for a page of w x h pt at `dpi`; lowered for this page only when the canvas would pass the limits. */
export function printScale(w, h, dpi = PRINT_DPI) {
  if (!(w > 0 && h > 0)) throw new RangeError('page size must be positive');
  const cap = Math.min(MAX_SIDE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));
  return Math.min(dpi / 72, cap * 0.999); // 0.999: the canvas size is rounded up to whole pixels
}

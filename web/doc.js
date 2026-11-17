// doc.js — the document model (Q10): a document is a list of pages. Pure: no DOM, no pdf.js.
// Page sizes are in PDF points (1/72 in), already rotated. Zoom 1 = 100% = 96 dpi on screen.
export const PX_PER_PT = 96 / 72, MIN_ZOOM = 0.1, MAX_ZOOM = 5, GAP = 12, PAD = 12;

/** A document from its page sizes [{ w, h }]; throws on an empty list or a size that is not a positive number. */
export function makeDoc(name, sizes) {
  if (!sizes.length) throw new Error('no pages');
  for (const { w, h } of sizes) if (!(w > 0 && h > 0 && w < Infinity && h < Infinity)) throw new Error('bad page size');
  return { name, pages: sizes.map(({ w, h }) => ({ w, h })) };
}

export const clampZoom = (z) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
export const zoomBy = (z, factor) => clampZoom(z * factor);

/** Fit width / Fit page: the zoom at which `page` fills a viewW × viewH view inside the padding. */
export const fitWidthZoom = (page, viewW) => clampZoom((viewW - 2 * PAD) / (page.w * PX_PER_PT));
export const fitPageZoom = (page, viewW, viewH) => Math.min(fitWidthZoom(page, viewW), clampZoom((viewH - 2 * PAD) / (page.h * PX_PER_PT)));

/** Pages stacked top to bottom (px): tops / widths / heights per page, the scroll height, the widest page + padding. */
export function layout(doc, zoom) {
  const k = zoom * PX_PER_PT, tops = [], widths = [], heights = [];
  let y = PAD;
  for (const p of doc.pages) { tops.push(y); widths.push(p.w * k); heights.push(p.h * k); y += p.h * k + GAP; }
  return { tops, widths, heights, total: y - GAP + PAD };
}

export const MAX_CANVAS_PIXELS = 2 ** 25, MAX_CANVAS_SIDE = 32767;

/** The render scale for a w × h pt page: `scale` lowered so the canvas stays within 2^25 pixels and 32767 on a side (CSS stretches it to the page box). */
export function canvasScale(w, h, scale) {
  const cap = Math.min(Math.sqrt(MAX_CANVAS_PIXELS / (w * h)), MAX_CANVAS_SIDE / Math.max(w, h));
  // 0.999 leaves room for the canvas size being rounded up to whole pixels
  return scale <= cap * 0.999 ? scale : cap * 0.999;
}

/** The page at scroll position y: the last page that starts at or above y (page 0 above the first). Binary search. */
export function pageAt(lay, y) {
  let lo = 0, hi = lay.tops.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lay.tops[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}

/** The pages to keep rendered (Q4): those in view plus `extra` before and after. [first, last], inclusive. */
export function visibleRange(lay, scrollTop, viewH, extra = 1) {
  return [Math.max(0, pageAt(lay, scrollTop) - extra), Math.min(lay.tops.length - 1, pageAt(lay, scrollTop + viewH) + extra)];
}

/** The page the page box shows: most of the view on it; the last page when scrolled to the end. */
export function currentPage(lay, scrollTop, viewH) {
  const n = lay.tops.length;
  if (scrollTop > 0 && scrollTop + viewH >= lay.total - 1) return n - 1;
  const [first, last] = visibleRange(lay, scrollTop, viewH, 0);
  let best = first, bestSeen = -1;
  for (let i = first; i <= last; i++) {
    const seen = Math.min(lay.tops[i] + lay.heights[i], scrollTop + viewH) - Math.max(lay.tops[i], scrollTop);
    if (seen > bestSeen) { best = i; bestSeen = seen; }
  }
  return best;
}

/** Scroll position that puts page i at the top of the view. */
export const scrollTopFor = (lay, i) => (i === 0 ? 0 : lay.tops[i] - PAD);

/** A point as (page, fraction down the page): survives a zoom change, so the view stays on the same spot. */
export function anchorAt(lay, y) {
  const i = pageAt(lay, y);
  return { i, f: (y - lay.tops[i]) / lay.heights[i] };
}
export const yOfAnchor = (lay, a) => lay.tops[a.i] + a.f * lay.heights[a.i];

// viewer.js — the page view: continuous scroll that renders only the pages in view + 1 (Q4), zoom, Fit, page box, thumbnails.
// The open document lives in one object (`cur`: model, pdf.js document, zoom, what is rendered) so a tab (T2b) can hold one each.
import { makeDoc, layout, visibleRange, currentPage, scrollTopFor, anchorAt, yOfAnchor, fitWidthZoom, fitPageZoom, zoomBy, canvasScale, PX_PER_PT, GAP, PAD } from './doc.js';

// pdf.js is loaded on demand, so cold start does not parse its 400 KB.
const loadPdfjs = () => import('./vendor/pdfjs/pdf.min.mjs');
const THUMB_W = 96, WHEEL_ZOOM = 1.1, KEY_ZOOM = 1.25, SIZE_BATCH = 50;
const $ = (id) => document.getElementById(id);
const view = $('view'), pages = $('pages'), thumbs = $('thumbs'), pageBox = $('page');
const dpr = () => Math.min(window.devicePixelRatio || 1, 2); // 2x sharpness is enough; more costs memory per canvas

let cur = null, side = true, queued = false;
pages.style.setProperty('--gap', GAP + 'px');
pages.style.setProperty('--pad', PAD + 'px');
thumbs.style.setProperty('--tw', THUMB_W + 'px');

/** Opens a PDF from its bytes and shows it, replacing the open one. Throws Error('<name>: <why>') for a broken or password file. */
export async function openPdf(name, bytes) {
  const pdfjs = await loadPdfjs();
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  const task = pdfjs.getDocument({ data: bytes });
  let pdf;
  try { pdf = await task.promise; }
  catch (e) {
    task.destroy(); // frees the worker side of the failed open
    const why = e?.name === 'InvalidPDFException' ? 'not a valid PDF' : e?.name === 'PasswordException' ? 'needs a password (not supported yet)' : e?.message || e;
    throw new Error(`${name}: ${why}`);
  }
  const pageSize = async (i) => { const v = (await pdf.getPage(i + 1)).getViewport({ scale: 1 }); return { w: v.width, h: v.height }; };
  let sizes, doc;
  try {
    // Page 1 first: until the other sizes are read every page is laid out like it.
    const first = await pageSize(0);
    sizes = Array.from({ length: pdf.numPages }, () => first);
    doc = makeDoc(name, sizes);
  } catch (e) { pdf.destroy(); throw new Error(`${name}: damaged PDF (${e?.message || e})`); }
  closeCur();
  cur = { pdf, doc, zoom: 1, fit: null, lay: layout(doc, 1), live: new Map(), liveThumbs: new Map(), slots: [], sel: -1, closed: false, io: null };
  build(cur);
  $('empty').hidden = true;
  view.hidden = false;
  showControls();
  setZoom(1);
  view.scrollTop = view.scrollLeft = 0;
  update();
  readSizes(cur, sizes, pageSize);
}

/** Reads the sizes of pages 2.. in batches; after each batch the layout (and the pages already drawn) follow. */
async function readSizes(t, sizes, pageSize) {
  for (let from = 1; from < sizes.length && !t.closed; from += SIZE_BATCH) {
    const idx = Array.from({ length: Math.min(SIZE_BATCH, sizes.length - from) }, (_, k) => from + k);
    const got = await Promise.all(idx.map((i) => pageSize(i).catch((e) => { if (!t.closed) console.warn('page size', i + 1, e); return null; })));
    if (t.closed) return;
    const changed = idx.filter((i, k) => got[k] && (got[k].w !== sizes[i].w || got[k].h !== sizes[i].h));
    if (!changed.length) continue;
    changed.forEach((i) => { sizes[i] = got[idx.indexOf(i)]; });
    try { t.doc = makeDoc(t.doc.name, sizes); } catch (e) { console.warn('page sizes', e); return; } // a bad size: keep what is laid out
    for (const i of changed) {
      const box = thumbs.children[i].firstChild;
      box.style.height = (THUMB_W * sizes[i].h) / sizes[i].w + 'px';
      t.live.get(i)?.task?.cancel();
      t.live.delete(i); // drawn at the old shape: update() draws it again
      if (t.liveThumbs.has(i)) paint(t, t.liveThumbs, i, box, (THUMB_W / sizes[i].w) * dpr());
    }
    t.fit ? applyFit() : setZoom(t.zoom);
  }
}

function closeCur() {
  const t = cur;
  if (!t) return;
  t.closed = true;
  t.io.disconnect();
  for (const rec of [...t.live.values(), ...t.liveThumbs.values()]) rec.task?.cancel();
  t.pdf.destroy();
  pages.replaceChildren();
  thumbs.replaceChildren();
  cur = null;
}

function build(t) {
  const el = (tag, cls) => Object.assign(document.createElement(tag), { className: cls });
  t.slots = t.doc.pages.map((_, i) => { const d = el('div', 'pg'); d.dataset.i = i; return d; });
  pages.replaceChildren(...t.slots);
  t.io = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const i = +target.dataset.i;
      if (!isIntersecting) { drop(t.liveThumbs, i, target); continue; }
      if (!t.liveThumbs.has(i)) paint(t, t.liveThumbs, i, target, (THUMB_W / t.doc.pages[i].w) * dpr());
    }
  }, { root: thumbs, rootMargin: '200px' });
  thumbs.replaceChildren(...t.doc.pages.map((p, i) => {
    const b = el('button', 'th'), box = el('span', 'tp'), n = el('span', 'tn');
    box.dataset.i = i;
    box.style.height = (THUMB_W * p.h) / p.w + 'px';
    n.textContent = i + 1; // textContent only: nothing from the file is HTML
    b.append(box, n);
    b.onclick = () => goto(i);
    t.io.observe(box);
    return b;
  }));
}

/** Renders page i into `slot` (a canvas) unless it is already there at this scale; `live` tracks what is on screen. */
async function paint(t, live, i, slot, scale) {
  live.get(i)?.task?.cancel();
  const rec = { scale, task: null };
  live.set(i, rec);
  try {
    const page = await t.pdf.getPage(i + 1);
    if (live.get(i) !== rec) return;
    const p = t.doc.pages[i], vp = page.getViewport({ scale: canvasScale(p.w, p.h, scale) }), canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    rec.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    await rec.task.promise;
    if (live.get(i) === rec) slot.replaceChildren(canvas); // the old canvas stays (stretched) until the new one is ready
  } catch (e) {
    if (live.get(i) === rec) live.delete(i);
    if (e?.name !== 'RenderingCancelledException' && !t.closed) console.warn('render page', i + 1, e);
  }
}
function drop(live, i, slot) { live.get(i)?.task?.cancel(); live.delete(i); slot.replaceChildren(); }

/** Sizes the page slots for the current zoom; no pixels are drawn here. */
function sizeSlots(t) {
  t.slots.forEach((s, i) => { s.style.width = t.lay.widths[i] + 'px'; s.style.height = t.lay.heights[i] + 'px'; });
}

/** Draws what is in view + 1 each side, frees the rest, updates the page box. */
function update() {
  const t = cur;
  if (!t) return;
  const [first, last] = visibleRange(t.lay, view.scrollTop, view.clientHeight), scale = t.zoom * PX_PER_PT * dpr();
  for (const i of [...t.live.keys()]) if (i < first || i > last) drop(t.live, i, t.slots[i]);
  for (let i = first; i <= last; i++) if (t.live.get(i)?.scale !== scale) paint(t, t.live, i, t.slots[i], scale);
  const n = currentPage(t.lay, view.scrollTop, view.clientHeight);
  if (document.activeElement !== pageBox) pageBox.value = n + 1;
  if (t.sel !== n) {
    thumbs.children[t.sel]?.classList.remove('sel');
    thumbs.children[n].classList.add('sel');
    if (side) thumbs.children[n].scrollIntoView({ block: 'nearest' });
    t.sel = n;
  }
}

/** Zoom to z keeping the view point (cx, cy) (px in the view) on the same spot of the same page. */
function setZoom(z, cx = view.clientWidth / 2, cy = view.clientHeight / 2) {
  const t = cur, a = anchorAt(t.lay, view.scrollTop + cy), r = z / t.zoom;
  t.zoom = z;
  t.lay = layout(t.doc, z);
  sizeSlots(t);
  view.scrollTop = yOfAnchor(t.lay, a) - cy;
  view.scrollLeft = (view.scrollLeft + cx) * r - cx;
  $('zoom').textContent = Math.round(z * 100) + '%';
  update();
}

function zoomStep(factor, cx, cy) {
  if (!cur) return;
  cur.fit = null;
  setZoom(zoomBy(cur.zoom, factor), cx, cy);
}

function fit(mode) {
  if (!cur) return;
  cur.fit = mode;
  applyFit();
}
function applyFit() {
  const t = cur, i = currentPage(t.lay, view.scrollTop, view.clientHeight), p = t.doc.pages[i];
  setZoom(t.fit === 'width' ? fitWidthZoom(p, view.clientWidth) : fitPageZoom(p, view.clientWidth, view.clientHeight));
  if (t.fit === 'page') view.scrollTop = scrollTopFor(t.lay, i);
}

function goto(i) {
  if (cur) view.scrollTop = scrollTopFor(cur.lay, Math.min(Math.max(i, 0), cur.doc.pages.length - 1));
}

function showControls() {
  for (const id of ['side', 'zout', 'zin', 'fitw', 'fitp', 'page']) $(id).disabled = false;
  for (const id of ['pagebox', 'zoom']) $(id).classList.remove('off');
  $('count').textContent = cur.doc.pages.length;
  thumbs.hidden = !side;
}

// Toolbar, keys, wheel.
$('zout').onclick = () => zoomStep(1 / KEY_ZOOM);
$('zin').onclick = () => zoomStep(KEY_ZOOM);
$('fitw').onclick = () => fit('width');
$('fitp').onclick = () => fit('page');
$('side').onclick = toggleSide;
function toggleSide() {
  if (!cur) return;
  side = !side;
  thumbs.hidden = !side;
  $('side').setAttribute('aria-pressed', side);
  if (side) thumbs.children[cur.sel]?.scrollIntoView({ block: 'nearest' });
}
pageBox.onkeydown = (e) => {
  if (e.key !== 'Enter' || !cur) return;
  const n = Number(pageBox.value.trim());
  if (Number.isInteger(n) && n >= 1 && n <= cur.doc.pages.length) goto(n - 1);
  pageBox.blur();
  view.focus();
  update(); // an invalid entry goes back to the current page
};
pageBox.onblur = () => cur && update();
document.addEventListener('keydown', (e) => {
  if (e.key === 'F4') { e.preventDefault(); toggleSide(); }
  else if (e.ctrlKey && !e.altKey && ['=', '+', '-', '_'].includes(e.key)) { e.preventDefault(); zoomStep(e.key === '-' || e.key === '_' ? 1 / KEY_ZOOM : KEY_ZOOM); }
});
document.addEventListener('wheel', (e) => {
  if (!e.ctrlKey) return;
  e.preventDefault(); // no page zoom of the whole window
  const r = view.getBoundingClientRect();
  zoomStep(e.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM, e.clientX - r.left, e.clientY - r.top);
}, { passive: false });
view.addEventListener('scroll', () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; update(); });
});
new ResizeObserver(() => { if (cur) cur.fit ? applyFit() : update(); }).observe(view);

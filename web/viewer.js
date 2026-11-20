// viewer.js — the page view: continuous scroll that renders only the pages in view + 1 (Q4), zoom, Fit, page box, thumbnails.
// A document is one handle (model, pdf.js document, zoom, scroll, what is rendered); a tab (tabs.js) holds one. `cur` is the one on screen.
import { makeDoc, layout, visibleRange, currentPage, scrollTopFor, anchorAt, yOfAnchor, fitWidthZoom, fitPageZoom, zoomBy, zoomPaint, canvasScale, PX_PER_PT, GAP, PAD } from './doc.js';
import { rangesForHits, textNodes } from './find-layer.js';
import { buildPageLists, THUMB_W } from './page-lists.js';
import { keepList } from './keep.js';
import { horizontalWheel, wheelLine } from './wheel.js';

// pdf.js is loaded on demand, so cold start does not parse its 400 KB.
const loadPdfjs = () => import('./vendor/pdfjs/pdf.min.mjs');
const WHEEL_ZOOM = 1.1, KEY_ZOOM = 1.25, SIZE_BATCH = 50;
const $ = (id) => document.getElementById(id);
const view = $('view'), pages = $('pages'), thumbs = $('thumbs'), pageBox = $('page');
const dpr = () => Math.min(window.devicePixelRatio || 1, 2); // 2x sharpness is enough; more costs memory per canvas

let cur = null, side = true, queued = false, wheelLog = null;
let instant = true, kept = []; // T15: with `instant` on, `kept` (most recent first, `cur` included) are the 5 handles whose drawn pages stay while in the background
pages.style.setProperty('--gap', GAP + 'px');
pages.style.setProperty('--pad', PAD + 'px');
thumbs.style.setProperty('--tw', THUMB_W + 'px');

/** Opens a PDF from its bytes and returns its handle (not on screen until show(handle)). Throws Error('<name>: <why>') for a broken or password file. */
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
  const t = { pdf, doc, zoom: 1, fit: null, lay: layout(doc, 1), live: new Map(), liveThumbs: new Map(), slots: [], thumbEls: [], sel: -1, closed: false, io: null, scrollTop: 0, scrollLeft: 0, changedAt: -Infinity, repaintTimer: null,
    TextLayer: pdfjs.TextLayer, find: { open: false, query: '', result: null, reveal: null } };
  build(t);
  sizeSlots(t);
  readSizes(t, sizes, pageSize);
  return t;
}

/** Puts a handle on screen (null: the empty state). The one leaving keeps its scroll and zoom; its big page canvases are freed,
 *  unless "Instant tab switching" is on and it is one of the 5 most recent (then they stay drawn, only pending renders stop). */
export function show(t) {
  if (t === cur) return;
  if (cur) {
    clearTimeout(cur.repaintTimer);
    cur.repaintTimer = null;
    cur.scrollTop = view.scrollTop;
    cur.scrollLeft = view.scrollLeft;
    if (instant) for (const live of [cur.live, cur.liveThumbs]) settle(live);
    else for (const i of [...cur.live.keys()]) drop(cur.live, i, cur.slots[i]);
  }
  cur = t;
  if (!t) return showEmpty();
  if (instant) {
    const { order, free } = keepList(kept, t);
    kept = order;
    free.forEach(freeTab);
  }
  pages.replaceChildren(...t.slots);
  pages.style.setProperty('--scale-factor', t.zoom * PX_PER_PT);
  thumbs.replaceChildren(...t.thumbEls);
  $('empty').hidden = true;
  view.hidden = false;
  setControls(true);
  $('zoom').textContent = Math.round(t.zoom * 100) + '%';
  view.scrollTop = t.scrollTop;
  view.scrollLeft = t.scrollLeft;
  t.fit ? applyFit() : update();
  revealFindHit(t.find.reveal);
  if (side) thumbs.children[t.sel]?.scrollIntoView({ block: 'nearest' });
}

/** The ⚙ toggle. Off: every background tab's kept pages are freed at once. */
export function setInstantTabs(on) {
  if (on === instant) return;
  instant = on;
  if (!on) kept.filter((h) => h !== cur).forEach(freeTab);
  kept = on && cur ? [cur] : [];
}

/** A tab leaves the screen: stop renders that are still running, keep the finished canvases (a started page with none is forgotten so it is drawn again). */
function settle(live) {
  for (const [i, rec] of live) {
    cancelPending(rec);
    if (!rec.page) live.delete(i);
  }
}

function freeTab(t) {
  for (const i of [...t.live.keys()]) drop(t.live, i, t.slots[i]);
  for (const i of [...t.liveThumbs.keys()]) drop(t.liveThumbs, i, t.thumbEls[i].firstChild);
}

function showEmpty() {
  pages.replaceChildren();
  thumbs.replaceChildren();
  view.hidden = thumbs.hidden = true;
  $('empty').hidden = false;
  setControls(false);
  refreshFind();
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
      const box = t.thumbEls[i].firstChild;
      box.style.height = (THUMB_W * sizes[i].h) / sizes[i].w + 'px';
      const rec = t.live.get(i);
      if (rec) {
        cancelPaint(rec);
        rec.scale = null; // keep the drawn page until its replacement is ready
      }
      if (t.liveThumbs.has(i)) paintThumbnail(t, i, box);
    }
    if (t === cur) t.fit ? applyFit() : setZoom(t.zoom);
    else { t.lay = layout(t.doc, t.zoom); sizeSlots(t); } // off screen: a Fit zoom is worked out again by show()
  }
}

/** Frees a handle: its pdf.js document and renders are destroyed. The tab's owner drops the handle afterwards. */
export function closeDoc(t) {
  t.closed = true;
  kept = kept.filter((h) => h !== t);
  clearTimeout(t.repaintTimer);
  t.io.disconnect();
  for (const rec of [...t.live.values(), ...t.liveThumbs.values()]) cancelPaint(rec);
  t.live.clear();
  t.liveThumbs.clear();
  t.pdf.destroy();
  if (cur === t) { cur = null; showEmpty(); }
}

function build(t) {
  t.io = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const i = +target.dataset.i;
      if (!isIntersecting) {
        if (t !== cur && kept.includes(t)) continue; // a kept tab's thumbnails leave the DOM on a switch but stay drawn
        drop(t.liveThumbs, i, target);
        continue;
      }
      if (!t.liveThumbs.has(i)) paintThumbnail(t, i, target);
    }
  }, { root: thumbs, rootMargin: '200px' });
  Object.assign(t, buildPageLists(t.doc, goto, (box) => t.io.observe(box)));
}

function paintThumbnail(t, i, slot) {
  const { w, h } = t.doc.pages[i];
  paint(t, t.liveThumbs, i, slot, canvasScale(w, h, (THUMB_W / w) * dpr()));
}

/** Keeps the drawn canvas and text layer in place until the replacement is ready. */
async function paint(t, live, i, slot, scale) {
  const rec = live.get(i) ?? {};
  cancelPending(rec);
  const render = rec.pending = { scale, task: null };
  live.set(i, rec);
  const active = () => live.get(i) === rec && rec.pending === render;
  try {
    const page = await t.pdf.getPage(i + 1);
    if (!active()) return;
    const vp = page.getViewport({ scale }), canvas = document.createElement('canvas');
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    render.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
    await render.task.promise;
    if (!active()) return;
    rec.layer?.cancel();
    live.set(i, { scale, page });
    slot.replaceChildren(canvas);
    if (live === t.live) refreshFind();
  } catch (e) {
    if (active()) {
      rec.pending = null;
      if (!rec.page) live.delete(i);
    }
    if (e?.name !== 'RenderingCancelledException' && !t.closed) console.warn('render page', i + 1, e);
  }
}
function cancelPending(rec) {
  const pending = rec?.pending;
  if (!pending) return;
  rec.pending = null;
  pending.task?.cancel();
}
function cancelPaint(rec) { cancelPending(rec); rec?.layer?.cancel(); }
function drop(live, i, slot) { cancelPaint(live.get(i)); live.delete(i); slot.replaceChildren(); }

async function paintFindLayer(t, rec, i) {
  rec.textRequested = true;
  try {
    const content = await rec.page.getTextContent();
    if (t.live.get(i) !== rec) return;
    const viewport = rec.page.getViewport({ scale: t.zoom * PX_PER_PT });
    const container = document.createElement('div');
    container.className = 'find-text-layer';
    container.setAttribute('aria-hidden', 'true');
    rec.layer = new t.TextLayer({ container, viewport, textContentSource: content });
    await rec.layer.render();
    if (t.live.get(i) !== rec) return;
    t.slots[i].append(container);
    rec.nodes = textNodes(content.items, rec.layer.textDivs);
    rec.layer = null;
    refreshFind();
  } catch (error) {
    if (t.live.get(i) !== rec) return;
    rec.nodes = [];
    rec.layer = null;
    console.warn('Render PDF text', i + 1, error);
    refreshFind();
  }
}

let findHighlights, currentHighlight;
function refreshFind() {
  const t = cur, result = t?.find.open ? t.find.result : null;
  if (!result?.hits.length && !findHighlights) return;
  if (!findHighlights) {
    findHighlights = new Highlight();
    currentHighlight = new Highlight();
    CSS.highlights.set('pdf-find', findHighlights);
    CSS.highlights.set('pdf-find-current', currentHighlight);
  }
  findHighlights.clear();
  currentHighlight.clear();
  if (!result?.hits.length) return;
  for (const [i, rec] of t.live) {
    const hits = result.byPage.get(i);
    if (!hits || !rec.page) continue;
    if (!rec.textRequested) paintFindLayer(t, rec, i);
    if (!rec.nodes) continue;
    if (rec.hits !== hits) {
      rec.hits = hits;
      rec.ranges = rangesForHits(rec.nodes, hits);
    }
    for (let j = 0; j < hits.length; j++) {
      const hit = hits[j], ranges = rec.ranges[j];
      const highlight = hit === result.hits[result.index] ? currentHighlight : findHighlights;
      for (const range of ranges) highlight.add(range);
      if (t.find.reveal === hit) {
        t.find.reveal = null;
        if (ranges.length) scrollToRange(ranges[0]);
      }
    }
  }
}

function scrollToRange(range) {
  const rect = range.getBoundingClientRect(), box = view.getBoundingClientRect();
  if (rect.top < box.top || rect.bottom > box.top + view.clientHeight) {
    view.scrollTop += rect.top - box.top - view.clientHeight / 2;
  }
  if (rect.left < box.left || rect.right > box.left + view.clientWidth) {
    view.scrollLeft += rect.left - box.left - view.clientWidth / 2;
  }
}

export function revealFindHit(hit) {
  if (!cur) return;
  cur.find.reveal = hit;
  if (hit) {
    const slot = cur.slots[hit.page].getBoundingClientRect(), box = view.getBoundingClientRect();
    if (slot.bottom <= box.top || slot.top >= box.bottom) { goto(hit.page); update(); }
  }
  refreshFind();
}

/** Sizes the page slots for the current zoom; no pixels are drawn here. */
function sizeSlots(t) {
  t.slots.forEach((s, i) => { s.style.width = t.lay.widths[i] + 'px'; s.style.height = t.lay.heights[i] + 'px'; });
}

/** Draws what is in view + 1 each side, frees the rest, updates the page box. */
function update(defer = false) {
  const t = cur;
  if (!t) return;
  const now = performance.now();
  if (defer) {
    t.changedAt = now;
    clearTimeout(t.repaintTimer);
    t.repaintTimer = null;
  }
  const { delay, scale } = zoomPaint(t.zoom, dpr(), t.changedAt, now);
  if (delay && t.repaintTimer === null) t.repaintTimer = setTimeout(() => {
    t.repaintTimer = null;
    if (cur === t) update();
  }, delay);

  const { scrollTop, clientHeight } = view;
  const [first, last] = visibleRange(t.lay, scrollTop, clientHeight);
  let dropped = false;
  for (const i of t.live.keys()) {
    if (i >= first && i <= last) continue;
    drop(t.live, i, t.slots[i]);
    dropped = true;
  }
  for (let i = first; i <= last; i++) {
    const { w, h } = t.doc.pages[i], target = canvasScale(w, h, scale), rec = t.live.get(i);
    if (rec?.pending && rec.pending.scale !== target) cancelPending(rec);
    if (!delay && rec?.scale !== target && rec?.pending?.scale !== target) paint(t, t.live, i, t.slots[i], target);
  }
  const n = currentPage(t.lay, scrollTop, clientHeight);
  if (document.activeElement !== pageBox && pageBox.value !== String(n + 1)) pageBox.value = n + 1;
  if (t.sel !== n) {
    t.thumbEls[t.sel]?.classList.remove('sel');
    t.thumbEls[n].classList.add('sel');
    if (side) t.thumbEls[n].scrollIntoView({ block: 'nearest' });
    t.sel = n;
  }
  if (dropped) refreshFind();
}

/** Zoom to z keeping the view point (cx, cy) (px in the view) on the same spot of the same page. */
function setZoom(z, cx = view.clientWidth / 2, cy = view.clientHeight / 2) {
  const t = cur, a = anchorAt(t.lay, view.scrollTop + cy);
  const slot = t.slots[a.i], before = slot.getBoundingClientRect();
  const x = view.getBoundingClientRect().left + cx, fraction = (x - before.left) / before.width;
  t.zoom = z;
  t.lay = layout(t.doc, z);
  sizeSlots(t);
  pages.style.setProperty('--scale-factor', z * PX_PER_PT);
  const after = slot.getBoundingClientRect();
  view.scrollTop = yOfAnchor(t.lay, a) - cy;
  view.scrollLeft += after.left + after.width * fraction - x;
  $('zoom').textContent = Math.round(z * 100) + '%';
  update(true);
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

/** The toolbar of a document (on) or of the empty state (off). */
function setControls(on) {
  for (const id of ['side', 'zout', 'zin', 'fitw', 'fitp', 'page']) $(id).disabled = !on;
  for (const id of ['pagebox', 'zoom']) $(id).classList.toggle('off', !on);
  $('count').textContent = on ? cur.doc.pages.length : '–';
  if (!on) { $('zoom').textContent = '–'; pageBox.value = ''; }
  thumbs.hidden = !on || !side;
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
const scrollWheel = horizontalWheel(view);
view.addEventListener('wheel', (e) => {
  const before = view.scrollLeft;
  const path = !cur || e.ctrlKey || e.defaultPrevented ? 'none' : scrollWheel(e);
  const log = wheelLog;
  if (log) requestAnimationFrame(() => log(wheelLine(e, path, before, view.scrollLeft)));
}, { passive: false });

/** The ⚙ "Log wheel events" toggle: `write(line)` gets one line per wheel event on the view, null stops it. */
export function setWheelLog(write) { wheelLog = write; }
view.addEventListener('scroll', () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; update(); });
});
new ResizeObserver(() => { if (cur) cur.fit ? applyFit() : update(true); }).observe(view);

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_PDF_PART } from './web/ai-file.js';

// Minimal fake DOM: every element is a recording object; enough for viewer.js to import and merge-ui.js to build its dialog.
const made = [];
function fakeEl(tag) {
  const e = {
    tag, textContent: '', children: [], style: { setProperty() {} }, dataset: {}, get firstChild() { return this.children[0]; },
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    setAttribute() {}, focus() {}, contains: () => false, close() { this.open = false; },
    showModal() { this.open = true; }, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
  };
  made.push(e);
  return e;
}
globalThis.document = {
  createElement: fakeEl, createElementNS: (_, tag) => fakeEl(tag),createTextNode: (t) => ({ textContent: t }), getElementById: () => fakeEl('x'),
  addEventListener() {}, head: fakeEl('head'), body: fakeEl('body'),
};
globalThis.addEventListener = globalThis.removeEventListener = () => {}; // window listeners viewer.js adds at load (T17)
globalThis.IntersectionObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} };

const { openPdf } = await import('./web/viewer.js');
const { createMergeWindow, saveFilters, filters } = await import('./web/merge-ui.js');
const { pressAction } = await import('./web/text-select.js');
const { makeTiff } = await import('./tools/tiff-fixture.mjs');

const noPdf = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator');

test('Merge Save dialog offers .pdf only', () => {
  assert.deepEqual(saveFilters, [{ name: 'PDF', extensions: ['pdf'] }]);
});

test('Merge Add files picker offers .pdf and .ai, no .tif / .tiff', () => {
  assert.deepEqual(filters, [{ name: 'PDF or AI', extensions: ['pdf', 'ai'] }]);
});

test('viewer openPdf: an .ai with no %PDF gives the NO_PDF_PART message', async () => {
  await assert.rejects(openPdf('logo.ai', noPdf), { message: `logo.ai: ${NO_PDF_PART}` });
});

test('Merge load: an .ai with no %PDF shows the NO_PDF_PART message on its card', async () => {
  const win = createMergeWindow({ tauri: null, fromPath: (p) => p, fromFile: (f) => f, openResult() {} });
  const drop = () => win.drop({ dataTransfer: { files: [{ name: 'logo.ai', read: async () => noPdf }] } });
  assert.equal(drop(), false, 'a drop while the Merge tab is not shown is not taken');
  win.start();
  win.show(true);
  assert.equal(win.hasFiles(), false, 'the tab starts empty');
  assert.equal(drop(), true);
  await new Promise((r) => setTimeout(r, 20));
  const errors = made.filter((e) => e.textContent.includes(NO_PDF_PART));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].textContent, `logo.ai: ${NO_PDF_PART}`);
});

// Last: its page lists add elements with number textContent to `made`.
test('viewer openPdf: a .tif opens as a tab of its pages with no text layer, so a drag on a page pans', async () => {
  const t = await openPdf('scan.TIF', makeTiff([{ w: 96, h: 96, gray: 0 }, { w: 192, h: 96, gray: 0 }]));
  assert.equal(t.pdf.numPages, 2);
  assert.deepEqual(t.doc.pages.map(({ w, h }) => [w, h]), [[72, 72], [72, 72]]); // page 1 first; page 2's own size follows
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(t.doc.pages.map(({ w, h }) => [w, h]), [[72, 72], [144, 72]]);
  assert.equal(t.TextLayer, null);
  assert.equal(pressAction(10, 10, []), 'pan'); // no text spans on a TIFF page
  await assert.rejects(openPdf('junk.tiff', noPdf), { message: "junk.tiff: this TIFF can't be read (not a TIFF file)." });
});

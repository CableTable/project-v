import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NO_PDF_PART } from './web/ai-file.js';

// Minimal fake DOM: every element is a recording object; enough for viewer.js to import and merge-ui.js to build its dialog.
const made = [];
function fakeEl(tag) {
  const e = {
    tag, textContent: '', children: [], style: { setProperty() {} }, dataset: {},
    append(...c) { this.children.push(...c); }, replaceChildren(...c) { this.children = c; },
    setAttribute() {}, focus() {}, contains: () => false, close() { this.open = false; },
    showModal() { this.open = true; }, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} },
  };
  made.push(e);
  return e;
}
globalThis.document = {
  createElement: fakeEl, createTextNode: (t) => ({ textContent: t }), getElementById: () => fakeEl('x'),
  addEventListener() {}, head: fakeEl('head'), body: fakeEl('body'),
};
globalThis.IntersectionObserver = globalThis.ResizeObserver = class { observe() {} unobserve() {} };

const { openPdf } = await import('./web/viewer.js');
const { createMergeWindow, saveFilters } = await import('./web/merge-ui.js');

const noPdf = new TextEncoder().encode('%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator');

test('Merge Save dialog offers .pdf only', () => {
  assert.deepEqual(saveFilters, [{ name: 'PDF', extensions: ['pdf'] }]);
});

test('viewer openPdf: an .ai with no %PDF gives the NO_PDF_PART message', async () => {
  await assert.rejects(openPdf('logo.ai', noPdf), { message: `logo.ai: ${NO_PDF_PART}` });
});

test('Merge load: an .ai with no %PDF shows the NO_PDF_PART message on its card', async () => {
  const win = createMergeWindow({ tauri: null, fromPath: (p) => p, fromFile: (f) => f, openResult() {} });
  win.open({ name: 'logo.ai', read: async () => noPdf });
  await new Promise((r) => setTimeout(r, 20));
  const errors = made.filter((e) => e.textContent.includes(NO_PDF_PART));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].textContent, `logo.ai: ${NO_PDF_PART}`);
});

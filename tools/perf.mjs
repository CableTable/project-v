import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { makeDoc, layout } from '../web/doc.js';
import { buildPageLists } from '../web/page-lists.js';

const dir = await mkdtemp(join(tmpdir(), 'project-v-perf-'));
try {
  const file = join(dir, '1000-pages.pdf');
  const source = await PDFDocument.create();
  for (let i = 0; i < 1000; i++) source.addPage();
  await writeFile(file, await source.save());

  let start = performance.now();
  const pdf = await PDFDocument.load(await readFile(file));
  const loadMs = performance.now() - start;
  console.log(`${pdf.getPageCount()}-page PDF load: ${loadMs.toFixed(2)} ms`);

  const sizes = pdf.getPages().map((page) => ({ w: page.getWidth(), h: page.getHeight() }));
  // Node supplies element records for the viewer's list builder without layout or painting.
  const dom = { createElement: () => ({ dataset: {}, style: {}, append(...children) { this.children = children; } }) };
  const noop = () => {};
  start = performance.now();
  const doc = makeDoc('1000-pages.pdf', sizes);
  layout(doc, 1);
  const { slots, thumbEls } = buildPageLists(doc, noop, noop, dom);
  const buildMs = performance.now() - start;
  console.log(`${slots.length} page slots and ${thumbEls.length} thumbnails: ${buildMs.toFixed(2)} ms`);
} finally {
  await rm(dir, { recursive: true, force: true });
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDoc, layout, pageAt, visibleRange, currentPage, scrollTopFor, anchorAt, yOfAnchor, fitWidthZoom, fitPageZoom, zoomBy, clampZoom, PX_PER_PT, MIN_ZOOM, MAX_ZOOM, GAP, PAD } from './web/doc.js';

const letter = { w: 612, h: 792 };
const doc = (n, size = letter) => makeDoc('t.pdf', Array.from({ length: n }, () => size));

test('makeDoc: a list of pages; rejects no pages and non-positive / non-finite sizes', () => {
  assert.equal(doc(3).pages.length, 3);
  assert.throws(() => makeDoc('x', []), /no pages/);
  for (const bad of [{ w: 0, h: 10 }, { w: 10, h: -1 }, { w: NaN, h: 10 }, { w: 10, h: Infinity }, { w: undefined, h: 5 }])
    assert.throws(() => makeDoc('x', [letter, bad]), /bad page size/);
  const sizes = [{ w: 1, h: 2 }];
  makeDoc('x', sizes).pages[0].w = 9;
  assert.equal(sizes[0].w, 1, 'the model owns its pages');
});

test('layout: pages stack with PAD around and GAP between; 100% is 96 dpi', () => {
  const lay = layout(doc(3), 1), h = 792 * PX_PER_PT;
  assert.deepEqual(lay.tops, [PAD, PAD + h + GAP, PAD + 2 * (h + GAP)]);
  assert.equal(lay.heights[0], h);
  assert.equal(lay.total, 3 * h + 2 * GAP + 2 * PAD);
  assert.equal(lay.width, 612 * PX_PER_PT + 2 * PAD);
  assert.equal(layout(doc(1), 2).heights[0], 2 * h);
  const mixed = layout(makeDoc('m', [letter, { w: 1000, h: 100 }]), 1);
  assert.equal(mixed.width, 1000 * PX_PER_PT + 2 * PAD, 'width is the widest page');
});

test('zoom: clamped to MIN..MAX, multiplicative', () => {
  assert.equal(zoomBy(1, 1.25), 1.25);
  assert.equal(zoomBy(MAX_ZOOM, 1.25), MAX_ZOOM);
  assert.equal(zoomBy(MIN_ZOOM, 0.5), MIN_ZOOM);
  assert.equal(clampZoom(-3), MIN_ZOOM);
  assert.equal(clampZoom(99), MAX_ZOOM);
});

test('Fit width / Fit page: the page fills the view inside the padding', () => {
  const z = fitWidthZoom(letter, 1000);
  assert.ok(Math.abs(letter.w * PX_PER_PT * z - (1000 - 2 * PAD)) < 1e-9);
  // a wide, short view: width is the limit for Fit width, height for Fit page
  assert.ok(fitPageZoom(letter, 1000, 500) < fitWidthZoom(letter, 1000));
  assert.ok(Math.abs(letter.h * PX_PER_PT * fitPageZoom(letter, 1000, 500) - (500 - 2 * PAD)) < 1e-9);
  // a tall, narrow view: Fit page equals Fit width
  assert.equal(fitPageZoom(letter, 300, 5000), fitWidthZoom(letter, 300));
  assert.equal(fitWidthZoom(letter, 10), MIN_ZOOM, 'a view narrower than the padding clamps, never negative');
  assert.equal(fitWidthZoom({ w: 1, h: 1 }, 5000), MAX_ZOOM);
});

test('pageAt: binary search over tops; above the first page is page 0, the gap belongs to the page above', () => {
  const lay = layout(doc(1000), 1);
  assert.equal(pageAt(lay, -50), 0);
  assert.equal(pageAt(lay, 0), 0);
  for (const i of [0, 1, 7, 500, 999]) {
    assert.equal(pageAt(lay, lay.tops[i]), i);
    assert.equal(pageAt(lay, lay.tops[i] + lay.heights[i] + GAP / 2), i);
  }
  assert.equal(pageAt(lay, lay.total + 1e6), 999);
  assert.equal(pageAt(layout(doc(1), 1), 5000), 0);
});

test('visibleRange: the pages in view plus one each side (Q4), clamped to the document', () => {
  const lay = layout(doc(1000), 1), h = lay.heights[0];
  assert.deepEqual(visibleRange(lay, 0, 100), [0, 1]);
  const y = lay.tops[500] + h / 2; // a view inside page 500 only
  assert.deepEqual(visibleRange(lay, y, 100), [499, 501]);
  assert.deepEqual(visibleRange(lay, y, 100, 0), [500, 500]);
  const both = lay.tops[500] + h - 10; // a view spanning pages 500 and 501
  assert.deepEqual(visibleRange(lay, both, 100), [499, 502]);
  assert.deepEqual(visibleRange(lay, lay.total - 100, 100), [998, 999]);
  assert.deepEqual(visibleRange(layout(doc(2), 1), 0, 99999), [0, 1]);
  assert.ok(visibleRange(lay, y, 600)[1] - visibleRange(lay, y, 600)[0] < 5, 'a 1000-page file renders a handful of pages');
});

test('currentPage: the page with most of the view; the last page at the end of the scroll', () => {
  const lay = layout(doc(5), 1), h = lay.heights[0];
  assert.equal(currentPage(lay, 0, 400), 0);
  assert.equal(currentPage(lay, lay.tops[1] - PAD, 400), 1, 'goto puts the page on top');
  assert.equal(currentPage(lay, lay.tops[2] - 100, 400), 2, 'page 2 fills 300 of 400 px');
  assert.equal(currentPage(lay, lay.tops[2] + h - 100, 400), 3, 'only 100 px of page 2 left');
  assert.equal(currentPage(lay, lay.total - 400, 400), 4, 'scrolled to the end');
  assert.equal(currentPage(layout(doc(2), 0.1), 0, 5000), 0, 'nothing to scroll: page 1');
});

test('scrollTopFor + currentPage round trip for every page of a long file', () => {
  const lay = layout(doc(300), 1);
  for (let i = 0; i < 300; i += 7) assert.equal(currentPage(lay, scrollTopFor(lay, i), 700), i);
  assert.equal(scrollTopFor(lay, 0), 0);
});

test('anchor: the same spot on the same page after a zoom change', () => {
  const d = makeDoc('m', [letter, { w: 300, h: 300 }, letter]);
  const a = layout(d, 1), b = layout(d, 2.5);
  for (const y of [a.tops[1] + 100, a.tops[2] + 5, a.tops[0] + 700]) {
    const an = anchorAt(a, y);
    assert.ok(Math.abs(yOfAnchor(a, an) - y) < 1e-9);
    const y2 = yOfAnchor(b, an);
    assert.equal(pageAt(b, y2), an.i, 'still on the same page');
    assert.ok(Math.abs((y2 - b.tops[an.i]) / b.heights[an.i] - (y - a.tops[an.i]) / a.heights[an.i]) < 1e-9);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCss, dpiFor, printScale, MAX_SIDE, MAX_PIXELS } from './web/print.js';

const canvas = (w, h, s) => [Math.ceil(w * s), Math.ceil(h * s)];

test('pageCss: the scale-1 viewport in pt, portrait and landscape kept as they are, rounded to 0.01', () => {
  assert.deepEqual(pageCss({ width: 288, height: 360 }), { w: 288, h: 360 });
  assert.deepEqual(pageCss({ width: 360, height: 288 }), { w: 360, h: 288 });
  assert.deepEqual(pageCss({ width: 595.2756, height: 841.8898 }), { w: 595.28, h: 841.89 });
});

test('dpiFor: 300 up to 100 pages, 150 over', () => {
  assert.equal(dpiFor(1), 300);
  assert.equal(dpiFor(100), 300);
  assert.equal(dpiFor(101), 150);
});

test('printScale: 300 dpi is 300/72 when the canvas fits (letter, A0), 150 dpi is half', () => {
  assert.equal(printScale(612, 792), 300 / 72);
  assert.equal(printScale(612, 792, 150), 150 / 72);
  const a0 = printScale(2384, 3370); // 9933 x 14042 px
  assert.equal(a0, 300 / 72);
  assert(canvas(2384, 3370, a0)[1] <= MAX_SIDE);
});

test('printScale: a big page is capped by side, then by area, and the canvas stays inside both', () => {
  const side = printScale(200, 10000); // 300 dpi would be 41667 px tall
  assert(side < 300 / 72);
  let [cw, ch] = canvas(200, 10000, side);
  assert(ch <= MAX_SIDE && ch > MAX_SIDE - 100, `height ${ch}`);
  const area = printScale(14000, 14000); // 300 dpi: 58333 px a side; the side cap alone leaves 16384^2 = 268.4M px
  [cw, ch] = canvas(14000, 14000, area);
  assert(cw * ch <= MAX_PIXELS && cw * ch > MAX_PIXELS * 0.99, `${cw} x ${ch}`);
  const wide = printScale(14400, 9000); // both limits bite; the smaller wins
  [cw, ch] = canvas(14400, 9000, wide);
  assert(cw <= MAX_SIDE && cw * ch <= MAX_PIXELS);
});

test('printScale: a non-positive or non-finite page size throws', () => {
  for (const [w, h] of [[0, 10], [10, -1], [NaN, 10], [10, undefined]]) assert.throws(() => printScale(w, h), RangeError);
});

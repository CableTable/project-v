import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openTiff } from './web/tiff-doc.js';
import UTIF from './web/vendor/utif/UTIF.js';
import { makeTiff } from './tools/tiff-fixture.mjs';

// Browser image APIs the doc draws with: a bitmap is the ImageData it was made from.
globalThis.ImageData = class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } };
globalThis.createImageBitmap = async (img) => ({ img, close() { this.closed = true; } });
const fakeContext = () => ({ draws: [], texts: [], drawImage(bmp, x, y, w, h) { this.draws.push({ bmp, x, y, w, h }); }, fillRect() {}, fillText(text) { this.texts.push(text); } });

let decodes = 0;
const decodeImage = UTIF.decodeImage;
UTIF.decodeImage = (...args) => { decodes++; return decodeImage(...args); };

const scan = () => makeTiff([
  { w: 400, h: 200, rgb: [200, 30, 10], dpi: [200, 200] }, // 2 x 1 in
  { w: 96, h: 48, gray: 40, packBits: true }, // no dpi tag: 96 dpi
]);

test('TIFF doc: page count and sizes in points from the dpi tags (none: 96 dpi, cm units)', async () => {
  const doc = openTiff('scan.tif', scan());
  assert.equal(doc.numPages, 2);
  const size = async (d, n) => { const v = (await d.getPage(n)).getViewport({ scale: 1 }); return [v.width, v.height]; };
  assert.deepEqual(await size(doc, 1), [144, 72]);
  assert.deepEqual(await size(doc, 2), [72, 36]);
  const cm = openTiff('cm.TIFF', makeTiff([{ w: 254, h: 127, gray: 0, dpi: [100, 100], unit: 3 }])); // 100 px/cm = 254 dpi
  assert.deepEqual(await size(cm, 1), [72, 36]);
  assert.equal((await cm.getPage(1)).getViewport({ scale: 2 }).width, 144);
  assert.deepEqual((await (await doc.getPage(1)).getTextContent()).items, []);
});

test('TIFF doc: render draws the decoded RGBA scaled to the viewport; a drawn page is decoded once until freed', async () => {
  const doc = openTiff('scan.tif', scan());
  const draw = async (n, scale = 1) => {
    const page = await doc.getPage(n), ctx = fakeContext(), viewport = page.getViewport({ scale });
    await page.render({ canvasContext: ctx, viewport }).promise;
    return ctx.draws[0];
  };
  decodes = 0;
  const one = await draw(1, 2);
  assert.deepEqual([one.x, one.y, one.w, one.h], [0, 0, 288, 144]);
  assert.deepEqual([one.bmp.img.width, one.bmp.img.height], [400, 200]);
  assert.deepEqual([...one.bmp.img.data.subarray(0, 4)], [200, 30, 10, 255]);
  assert.equal(one.bmp.closed, true, 'the bitmap is closed after drawing');
  const two = await draw(2); // PackBits, 8-bit gray
  assert.deepEqual([...two.bmp.img.data.subarray(0, 4)], [40, 40, 40, 255]);
  assert.equal(decodes, 2);
  await draw(1, 3);
  assert.equal(decodes, 2, 'a drawn page is cached');
  doc.freePixels();
  await draw(1);
  assert.equal(decodes, 3, 'freePixels drops the cache');
  doc.destroy();
  await draw(2);
  assert.equal(decodes, 4, 'destroy drops the cache');
});

test('TIFF doc: Deflate (8) and Adobe Deflate (32946) pages give the same pixels as uncompressed', async () => {
  const pixelsOf = async (bytes, n) => {
    const page = await openTiff('z.tif', bytes).getPage(n), ctx = fakeContext();
    await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise;
    return ctx.draws[0].bmp.img.data;
  };
  const spec = [{ w: 40, h: 30, rgb: [200, 30, 10] }, { w: 16, h: 8, gray: 77 }];
  const plain = makeTiff(spec);
  for (const code of [8, 32946]) {
    const z = makeTiff(spec.map((p) => ({ ...p, deflate: code })));
    assert.ok(z.length < plain.length);
    for (const n of [1, 2]) assert.deepEqual(await pixelsOf(z, n), await pixelsOf(plain, n));
  }
  const bad = makeTiff([{ w: 8, h: 8, gray: 5, deflate: 8 }]); // corrupt zlib data: the page text, not a crash
  bad.fill(0xff, bad.length - 8);
  const ctx = fakeContext(), warn = console.warn;
  console.warn = () => {};
  try { const page = await openTiff('bad.tif', bad).getPage(1); await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise; } finally { console.warn = warn; }
  assert.match(ctx.texts[0], /^bad\.tif page 1: this TIFF page can't be read/);
});

test('TIFF doc: two renders of one Deflate page at once decode it once; UTIF.inflated is emptied after', async () => {
  const doc = openTiff('z.tif', makeTiff([{ w: 40, h: 30, rgb: [200, 30, 10], deflate: 8 }])), page = await doc.getPage(1);
  const draw = () => page.render({ canvasContext: fakeContext(), viewport: page.getViewport({ scale: 1 }) }).promise;
  decodes = 0;
  await Promise.all([draw(), draw()]);
  assert.equal(decodes, 1);
  assert.equal(UTIF.inflated.size, 0);
  await draw();
  assert.equal(decodes, 1, 'then cached');
});

test('TIFF doc: a cancelled render rejects like pdf.js and draws nothing; destroy does not throw', async () => {
  const doc = openTiff('scan.tif', scan()), page = await doc.getPage(1), ctx = fakeContext();
  const task = page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) });
  task.cancel();
  await assert.rejects(task.promise, { name: 'RenderingCancelledException' });
  assert.equal(ctx.draws.length, 0);
  doc.destroy();
  doc.destroy();
});

test('TIFF doc: an unreadable file gives "<name>: this TIFF can\'t be read (<reason>)."', () => {
  const cant = (name, why) => ({ message: `${name}: this TIFF can't be read (${why}).` });
  assert.throws(() => openTiff('a.tif', new TextEncoder().encode('not a tiff at all')), cant('a.tif', 'not a TIFF file'));
  assert.throws(() => openTiff('b.tif', new Uint8Array([0x49, 0x49, 42, 0, 0, 0, 0, 0])), cant('b.tif', 'no pages'));
  assert.throws(() => openTiff('c.tif', makeTiff([{ w: 4, h: 4, gray: 0, compression: 34712 }])), cant('c.tif', 'compression 34712 not supported'));
  const looped = openTiff('d.tif', makeTiff([{ w: 4, h: 4, gray: 0 }, { w: 4, h: 4, gray: 9 }], { loop: true })); // corrupt: no hang
  assert.equal(looped.numPages, 2);
});

test('TIFF doc: a page that fails to decode shows "<name> page <n>: this TIFF page can\'t be read (<reason>)", logged once', async () => {
  const bytes = makeTiff([{ w: 8, h: 8, gray: 1 }]), dv = new DataView(bytes.buffer);
  dv.setUint32(18, 0xffffffff, true); // width and height (the first two IFD entries) claim 2^32 px: no buffer that big
  dv.setUint32(30, 0xffffffff, true);
  const doc = openTiff('bad.tif', bytes);
  const warn = console.warn, warned = [];
  console.warn = (...a) => warned.push(a);
  try {
    for (let k = 0; k < 2; k++) {
      const page = await doc.getPage(1), ctx = fakeContext();
      await page.render({ canvasContext: ctx, viewport: page.getViewport({ scale: 1 }) }).promise;
      assert.equal(ctx.draws.length, 0);
      assert.equal(ctx.texts.length, 1);
      assert.equal(ctx.texts[0], "bad.tif page 1: this TIFF page can't be read (over 268 million pixels)");
    }
  } finally { console.warn = warn; }
  assert.equal(warned.length, 1);
});

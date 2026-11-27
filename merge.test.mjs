import assert from 'node:assert/strict';
import { test } from 'node:test';
import { degrees, PDFDocument, PDFHexString, PDFName } from './web/vendor/pdf-lib/pdf-lib.esm.min.mjs';
import * as merge from './web/merge.js';

const {
  addFiles, clearFiles, displacedFiles, expandPages, loadMergePdf, mergePdfs, moveDown, moveFile,
  moveUp, pageRange, removeFile, replacePageRange, rotatePage, sortFiles,
} = merge;

async function pdf(widths) {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 200]);
  return doc.save();
}

test('merge list adds, removes, clears, moves and sorts files without mutating the input', () => {
  const z = { name: 'z.pdf' }, a = { name: 'A.pdf' }, b = { name: 'b.pdf' };
  const list = addFiles([z], [a, b, a]);
  assert.deepEqual(list, [z, a, b, a]);
  assert.deepEqual(removeFile(list, 1), [z, b, a]);
  assert.deepEqual(clearFiles(), []);
  assert.deepEqual(moveUp(list, 1), [a, z, b, a]);
  assert.deepEqual(moveDown(list, 1), [z, b, a, a]);
  assert.deepEqual(moveFile(list, 0, 3), [a, b, a, z]);
  assert.strictEqual(moveUp(list, 0), list);
  assert.strictEqual(moveDown(list, 3), list);
  assert.deepEqual(sortFiles(list), [a, a, b, z]);
  assert.deepEqual(sortFiles(list, true), [z, b, a, a]);
  assert.deepEqual(list, [z, a, b, a]);
});

test('merge keeps all pages in file and page order, including repeated files', async () => {
  const first = { name: 'z.pdf', pageCount: 2, bytes: await pdf([100, 200]) };
  const second = { name: 'a.pdf', pageCount: 2, bytes: await pdf([300, 400]) };
  const bytes = await mergePdfs(expandPages([first, second, { ...first }]));
  assert.ok(bytes instanceof Uint8Array);
  const merged = await PDFDocument.load(bytes);
  assert.deepEqual(merged.getPages().map((page) => page.getWidth()), [100, 200, 300, 400, 100, 200]);
});

test('merge Reset: files back in the order added, every page in again and unrotated, a loading file has none yet', () => {
  const a = { name: 'a.pdf', added: 0, pageCount: 2 }, b = { name: 'b.pdf', added: 1 }, c = { name: 'c.pdf', added: 2, pageCount: 1 };
  const list = [c, a, b];
  const { files, pages } = merge.resetFiles(list);
  assert.deepEqual(files, [a, b, c]);
  assert.deepEqual(pages.map(({ file, pageIndex, rotate }) => [file.name, pageIndex, rotate]),
    [['a.pdf', 0, 0], ['a.pdf', 1, 0], ['c.pdf', 0, 0]]);
  assert.deepEqual(list, [c, a, b]);
});

test('merge rejects an empty list', async () => {
  await assert.rejects(mergePdfs([]), /add at least one PDF/i);
});

test('merge names and identifies the broken PDF', async () => {
  const good = { name: 'good.pdf', pageCount: 1, bytes: await pdf([100]) };
  const broken = { name: 'broken.pdf', pageCount: 1, bytes: new Uint8Array([0]) };
  await assert.rejects(mergePdfs(expandPages([good, broken])), (error) => {
    assert.equal(error.message, 'broken.pdf: invalid or damaged PDF.');
    assert.equal(error.file, broken);
    return true;
  });
});

test('merge names the password-protected PDF', async () => {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.addPage();
  // Standard security revision 2, with user password "secret" and owner password "owner".
  const id = PDFHexString.of('657ea4057ba742c11bb178b214812a1b');
  doc.context.trailerInfo.ID = doc.context.obj([id, id]);
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({
    Filter: 'Standard', V: 1, R: 2, P: -4,
    O: PDFHexString.of('92fe0f4454ad4c9644693f33c07cb54f587dce1e2682fe9ecea6107a1ef630dd'),
    U: PDFHexString.of('1f4a9e64c899777006ea4c39208dbc376d26a5226740c50f8f0e1dde6c26c0e5'),
  }));
  const bytes = await doc.save({ useObjectStreams: false });
  await assert.rejects(mergePdfs(expandPages([{ name: 'locked.pdf', pageCount: 1, bytes }])), /locked\.pdf: password-protected PDF/);
});

test('page edits are immutable and a range replaces its own file block', () => {
  const a = { pageCount: 4 }, b = { pageCount: 2 }, c = { pageCount: 1 };
  const files = [a, b, c];
  const original = expandPages(files);
  const rotated = rotatePage(original, 2);
  const reordered = moveFile(removeFile(rotated, 1), 1, 0);
  assert.deepEqual(reordered.slice(0, 3), [
    { file: a, pageIndex: 2, rotate: 90 },
    { file: a, pageIndex: 0, rotate: 0 },
    { file: a, pageIndex: 3, rotate: 0 },
  ]);
  assert.equal(original.length, 7);
  assert.equal(original[2].rotate, 0);
  assert.strictEqual(rotatePage(original, -1), original);
  assert.equal(rotatePage([{ rotate: 270 }], 0)[0].rotate, 0);
  assert.equal(pageRange(reordered.slice(0, 3)), '3, 1, 4');
  const replaced = replacePageRange(files, reordered, a, '2-3, 1');
  assert.deepEqual(replaced.slice(0, 3).map(({ pageIndex, rotate }) => [pageIndex, rotate]), [[1, 0], [2, 90], [0, 0]]);
  assert.equal(pageRange(replaced.slice(0, 3)), '2-3, 1');
  assert.deepEqual(replaced.slice(3), original.slice(4));
  assert.deepEqual(replacePageRange(files, replaced, b, ''), [...replaced.slice(0, 3), original[6]]);
  assert.deepEqual(replacePageRange(files, replacePageRange(files, replaced, b, ''), b, '1-2'), replaced);
  for (const bad of ['0', '1,1', '4-5', '4-2', '1,', '1.5']) {
    assert.throws(() => replacePageRange(files, reordered, a, bad), /page/i);
  }
  const custom = moveFile(replaced, 3, 1);
  assert.deepEqual(displacedFiles(files, custom), new Set([a, b]));
  assert.strictEqual(replacePageRange(files, custom, a, '1'), custom);
  assert.deepEqual(replacePageRange(files, custom, c, '1'), custom);
  assert.equal(displacedFiles(files, replaced).size, 0);
});

test('merge writes remapped outlines for kept pages and promotes kept children', async () => {
  const source = await PDFDocument.create();
  const first = source.addPage([101, 200]);
  const deleted = source.addPage([102, 200]);
  const rotated = source.addPage([103, 200]);
  rotated.setRotation(degrees(180));
  const { context } = source;
  const root = context.obj({ Type: 'Outlines', Count: 4 });
  const rootRef = context.register(root);
  const named = context.obj({ Title: PDFHexString.fromText('章 📄'), Parent: rootRef, Dest: 'chapter' });
  const namedRef = context.register(named);
  const removed = context.obj({
    Title: PDFHexString.fromText('Deleted parent'), Parent: rootRef, Prev: namedRef, Dest: [deleted.ref, 'Fit'], Count: 1,
  });
  const removedRef = context.register(removed);
  const child = context.register(context.obj({
    Title: PDFHexString.fromText('Kept child'), Parent: removedRef, Dest: [rotated.ref, 'Fit'],
  }));
  const link = context.register(context.obj({
    Title: PDFHexString.fromText('External URL'), Parent: rootRef, Prev: removedRef,
    A: { S: 'URI', URI: PDFHexString.fromText('https://example.org/') },
  }));
  for (const [dict, key, ref] of [
    [root, 'First', namedRef], [root, 'Last', link], [named, 'Next', removedRef],
    [removed, 'First', child], [removed, 'Last', child], [removed, 'Next', link],
  ]) dict.set(PDFName.of(key), ref);
  source.catalog.set(PDFName.of('Outlines'), rootRef);
  source.catalog.set(PDFName.of('Dests'), context.obj({ chapter: [first.ref, 'Fit'] }));

  const a = { name: '同じ.PDF', bytes: await source.save() };
  const b = { name: '同じ.pdf', bytes: await pdf([201]) };
  const pages = [
    { file: a, pageIndex: 2, rotate: 90 },
    { file: b, pageIndex: 0, rotate: 0 },
    { file: a, pageIndex: 0, rotate: 0 },
  ];
  const bytes = await mergePdfs(pages);
  const merged = await PDFDocument.load(bytes);
  assert.deepEqual(merged.getPages().map((page) => [page.getWidth(), page.getRotation().angle]), [[103, 270], [201, 0], [101, 0]]);

  async function outlines(bytes) {
    const task = await loadMergePdf(bytes);
    try {
      const doc = await task.promise;
      const read = (items) => Promise.all(items.map(async ({ title, dest, items: children }) => {
        assert.equal(dest[1].name, 'Fit');
        return [title, await doc.getPageIndex(dest[0]), await read(children)];
      }));
      return await read(await doc.getOutline() ?? []);
    } finally {
      await task.destroy();
    }
  }
  const children = [['章 📄', 2, []], ['Kept child', 0, []]];
  assert.deepEqual(await outlines(bytes), [['同じ', 0, children], ['同じ', 1, []]]);
  assert.deepEqual(await outlines(await mergePdfs(pages, { bookmarkPerFile: false })), children);
  assert.deepEqual(await outlines(await mergePdfs(pages, { keepBookmarks: false })), [['同じ', 0, []], ['同じ', 1, []]]);
  assert.deepEqual(await outlines(await mergePdfs(pages, { bookmarkPerFile: false, keepBookmarks: false })), []);
});

test('an .ai input is merged like a PDF and its bookmark name loses the .ai', async () => {
  const ai = { name: 'logo.AI', bytes: await pdf([120]) };
  const bytes = await mergePdfs([{ file: ai, pageIndex: 0, rotate: 0 }]);
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
  const task = await loadMergePdf(bytes);
  try { assert.deepEqual((await (await task.promise).getOutline()).map(({ title }) => title), ['logo']); }
  finally { await task.destroy(); }
});

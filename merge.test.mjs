import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PDFDocument, PDFHexString } from './web/vendor/pdf-lib/pdf-lib.esm.min.mjs';
import { addFiles, clearFiles, mergePdfs, moveDown, moveFile, moveUp, removeFile, sortFiles } from './web/merge.js';

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
  const first = { name: 'z.pdf', bytes: await pdf([100, 200]) };
  const second = { name: 'a.pdf', bytes: await pdf([300, 400]) };
  const bytes = await mergePdfs([first, second, first]);
  assert.ok(bytes instanceof Uint8Array);
  const merged = await PDFDocument.load(bytes);
  assert.deepEqual(merged.getPages().map((page) => page.getWidth()), [100, 200, 300, 400, 100, 200]);
});

test('merge rejects an empty list', async () => {
  await assert.rejects(mergePdfs([]), /add at least one PDF/i);
});

test('merge names the broken PDF and identifies its position', async () => {
  await assert.rejects(mergePdfs([
    { name: 'good.pdf', bytes: await pdf([100]) },
    { name: 'broken.pdf', bytes: new Uint8Array([0]) },
  ]), { message: 'broken.pdf: invalid or damaged PDF.', fileIndex: 1 });
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
  await assert.rejects(mergePdfs([{ name: 'locked.pdf', bytes }]), /locked\.pdf: password-protected PDF/);
});

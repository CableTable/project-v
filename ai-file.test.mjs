import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OPEN_EXTS, NO_PDF_PART, isAi, isTiff, hasPdfHeader } from './web/ai-file.js';

const bytes = (text) => new TextEncoder().encode(text);

test('open dialog accepts pdf, ai, tif and tiff', () => {
  assert.deepEqual(OPEN_EXTS, ['pdf', 'ai', 'tif', 'tiff']);
  assert.equal(isAi('Logo.AI'), true);
  assert.equal(isAi('logo.ai.pdf'), false);
  assert.equal(isAi('ai'), false);
  assert.deepEqual(['a.tif', 'B.TIFF', 'c.Tif', 'd.tif.pdf', 'e.tiffx', 'tif'].map(isTiff), [true, true, true, false, false, false]);
});

test('the installer associates .pdf only (an ai / tif / tiff entry would make V their default app)', () => {
  const conf = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  assert.deepEqual(conf.bundle.fileAssociations.flatMap((a) => a.ext), ['pdf']);
});

test('%PDF must be in the first 1024 bytes', () => {
  assert.equal(hasPdfHeader(bytes('%PDF-1.6\n%âãÏÓ')), true);
  assert.equal(hasPdfHeader(bytes('junk\r\n%PDF-1.5')), true);
  assert.equal(hasPdfHeader(bytes('%!PS-Adobe-3.0 EPSF-3.0\n%%Creator: Adobe Illustrator')), false);
  assert.equal(hasPdfHeader(bytes('')), false);
  assert.equal(hasPdfHeader(bytes('x'.repeat(1020) + '%PDF')), true);
  assert.equal(hasPdfHeader(bytes('x'.repeat(1021) + '%PDF')), false);
});

test('the message tells the user what to switch on in Illustrator', () => {
  assert.equal(NO_PDF_PART, "This .ai file has no PDF part. In Illustrator, save it again with 'Create PDF Compatible File' on.");
});

test('no web module contains the PDF magic text', () => {
  // Tauri sniffs content: a module with this text is served as application/pdf and fails to load (T12).
  const hits = readdirSync('web', { recursive: true })
    .filter((f) => !/^vendor[\\/]/.test(f) && /\.(m?js|html|css)$/.test(f))
    .filter((f) => readFileSync(join('web', f), 'latin1').includes('%' + 'PDF'));
  assert.deepEqual(hits, []);
});

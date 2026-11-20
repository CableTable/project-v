import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OPEN_EXTS, NO_PDF_PART, isAi, hasPdfHeader } from './web/ai-file.js';

const bytes = (text) => new TextEncoder().encode(text);

test('open dialog and merge accept pdf and ai', () => {
  assert.deepEqual(OPEN_EXTS, ['pdf', 'ai']);
  assert.equal(isAi('Logo.AI'), true);
  assert.equal(isAi('logo.ai.pdf'), false);
  assert.equal(isAi('ai'), false);
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

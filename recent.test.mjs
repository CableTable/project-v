import test from 'node:test';
import assert from 'node:assert/strict';
import { addRecent, removeRecent } from './web/recent.js';

test('recent puts the opened path first without mutating the list', () => {
  const list = ['C:/one.pdf'];
  assert.deepEqual(addRecent(list, 'C:/two.pdf'), ['C:/two.pdf', 'C:/one.pdf']);
  assert.deepEqual(list, ['C:/one.pdf']);
});

test('recent deduplicates and promotes Windows paths', () => {
  assert.deepEqual(addRecent(['C:/two.pdf', 'C:/one.pdf'], 'c:\\ONE.pdf'), ['c:\\ONE.pdf', 'C:/two.pdf']);
});

test('recent drops the oldest path after ten entries', () => {
  const paths = Array.from({ length: 11 }, (_, i) => `C:/${i}.pdf`);
  assert.deepEqual(paths.reduce(addRecent, []), paths.slice(1).reverse());
});

test('recent removes the requested path only', () => {
  assert.deepEqual(removeRecent(['C:/two.pdf', 'C:/one.pdf'], 'c:\\TWO.pdf'), ['C:/one.pdf']);
});

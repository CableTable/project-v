import test from 'node:test';
import assert from 'node:assert/strict';
import { findHits, pageText } from './web/find.js';

test('find returns all hits in page and text order', () => {
  assert.deepEqual(findHits(['one one', 'none here', 'one'], 'one'), [
    { page: 0, index: 0, length: 3 }, { page: 0, index: 4, length: 3 },
    { page: 1, index: 1, length: 3 }, { page: 2, index: 0, length: 3 },
  ]);
});

test('find spans text items and uses spaces at line breaks', () => {
  const page = pageText([{ str: 'ab' }, { str: 'cd', hasEOL: true }, { str: 'ef' }]);
  assert.deepEqual(findHits([page], 'cd ef'), [{ page: 0, index: 2, length: 5 }]);
  assert.deepEqual(findHits([page], 'bc'), [{ page: 0, index: 1, length: 2 }]);
});

test('find ignores case and treats regex characters literally', () => {
  assert.deepEqual(findHits(['İ Ab.C axxc AB.C'], 'ab.c'), [
    { page: 0, index: 2, length: 4 }, { page: 0, index: 12, length: 4 },
  ]);
});

test('find has no hits on pages without text', () => {
  assert.deepEqual(findHits(['', ' \n '], 'one'), []);
});

test('find has no hits for an empty query', () => {
  assert.deepEqual(findHits(['one'], ''), []);
});

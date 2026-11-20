import test from 'node:test';
import assert from 'node:assert/strict';
import { keepList } from './web/keep.js';

const [a, b, c, d, e, f, g] = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => ({ name }));

test('keepList: the shown handle goes first, nothing is freed under 5', () => {
  assert.deepEqual(keepList([], a), { order: [a], free: [] });
  assert.deepEqual(keepList([a], b), { order: [b, a], free: [] });
  assert.deepEqual(keepList([c, b, a], a), { order: [a, c, b], free: [] }); // no duplicate
});

test('keepList: the 6th handle frees the oldest (5 = the shown one + 4 others)', () => {
  assert.deepEqual(keepList([e, d, c, b, a], f), { order: [f, e, d, c, b], free: [a] });
  assert.deepEqual(keepList([e, d, c, b, a], a), { order: [a, e, d, c, b], free: [] });
  assert.deepEqual(keepList([g, f, e, d, c, b, a], g, 5), { order: [g, f, e, d, c], free: [b, a] });
});

test('keepList: n is a parameter, the input list is not changed', () => {
  const order = [c, b, a];
  assert.deepEqual(keepList(order, d, 2), { order: [d, c], free: [b, a] });
  assert.deepEqual(order, [c, b, a]);
});

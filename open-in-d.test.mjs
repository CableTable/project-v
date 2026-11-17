import test from 'node:test';
import assert from 'node:assert/strict';
import { canOpenInD, isOpenInDShortcut } from './web/open-in-d.js';

test('Open in Project D requires an active tab with a disk path', () => {
  assert.equal(canOpenInD({ path: 'C:\\PDFs\\plan.pdf' }), true);
  assert.equal(canOpenInD(undefined), false);
  assert.equal(canOpenInD({ name: 'dropped.pdf', doc: {} }), false);
});

test('Open in Project D shortcut matches Ctrl+Shift+D only', () => {
  const shortcut = { key: 'D', ctrlKey: true, shiftKey: true };
  assert.equal(isOpenInDShortcut(shortcut), true);
  assert.equal(isOpenInDShortcut({ ...shortcut, key: 'd' }), true);
  for (const extra of [{ key: 'x' }, { ctrlKey: false }, { shiftKey: false }, { altKey: true }, { metaKey: true }]) {
    assert.equal(isOpenInDShortcut({ ...shortcut, ...extra }), false);
  }
});

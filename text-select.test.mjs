import test from 'node:test';
import assert from 'node:assert/strict';
import { pressAction, selectedText } from './web/text-select.js';

// two spans on one line (x 10-50 and 70-120, y 0-10), one on the next line
const rects = [{ left: 10, right: 50, top: 0, bottom: 10 }, { left: 70, right: 120, top: 0, bottom: 10 }, { left: 10, right: 40, top: 20, bottom: 30 }];

test('press on a span selects', () => {
  assert.equal(pressAction(30, 5, rects), 'select');
  assert.equal(pressAction(20, 25, rects), 'select');
});

test('press in the gap between two spans of one line selects', () => {
  assert.equal(pressAction(60, 5, rects), 'select');
});

test('press on empty page, past a line end or with no text pans', () => {
  assert.equal(pressAction(130, 5, rects), 'pan'); // right of the last span
  assert.equal(pressAction(5, 5, rects), 'pan'); // left of the first span
  assert.equal(pressAction(60, 15, rects), 'pan'); // between lines
  assert.equal(pressAction(60, 25, rects), 'pan'); // right of a one-span line
  assert.equal(pressAction(30, 5, []), 'pan'); // scanned page / grey area
});

const line = (str, hasEOL, sel) => ({ str, hasEOL, sel });

test('copy: hasEOL is a line break, page end is a line break', () => {
  const page1 = [line('Hello', false, [0, 5]), line(' world', true, [0, 6]), line('next', false, [0, 4]), line('', true, null)];
  const page2 = [line('Page two', true, [0, 4])];
  assert.equal(selectedText([page1, page2]), 'Hello world\nnext\nPage');
});

test('copy: an empty EOL item counts only inside the selection', () => {
  const items = [line('ab', false, [1, 2]), line('', true, null), line('cd', false, [0, 1]), line('', true, null), line('ef', false, null), line('', true, null)];
  assert.equal(selectedText([items]), 'b\nc');
});

test('copy: a selection ending at a line end has no trailing break; no text = nothing', () => {
  assert.equal(selectedText([[line('one', true, [0, 3]), line('two', false, null)]]), 'one');
  assert.equal(selectedText([[], [line('x', true, null)]]), '');
});

test('copy: a page with no selected text adds no blank line', () => {
  assert.equal(selectedText([[line('a', true, [0, 1])], [], [line('b', false, [0, 1])]]), 'a\nb');
});

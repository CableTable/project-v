import test from 'node:test';
import assert from 'node:assert/strict';
import { filePaths } from './web/launch.js';

test('argv -> file paths: skips exe and flags, joins relative to cwd, keeps absolute and UNC', () => {
  const argv = ['ProjectV.exe', '--debug', '-x', '', 'a b.pdf', 'D:\\jobs\\c.pdf', '\\\\server\\share\\d.pdf'];
  assert.deepEqual(filePaths(argv, 'C:\\work\\'), ['C:\\work\\a b.pdf', 'D:\\jobs\\c.pdf', '\\\\server\\share\\d.pdf']);
  assert.deepEqual(filePaths(['ProjectV.exe'], 'C:\\work'), []);
});

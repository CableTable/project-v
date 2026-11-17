import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('perf script finishes and reports load and list build for 1000 pages', async () => {
  const script = fileURLToPath(new URL('./tools/perf.mjs', import.meta.url));
  const { stdout } = await promisify(execFile)(process.execPath, [script]);
  assert.match(stdout, /1000-page PDF load: \d+\.\d+ ms/);
  assert.match(stdout, /1000 page slots and 1000 thumbnails: \d+\.\d+ ms/);
});

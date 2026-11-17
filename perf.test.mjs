import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('perf script finishes and reports load and list build for 1000 pages', async () => {
  const script = fileURLToPath(new URL('./tools/perf.mjs', import.meta.url));
  // The runner's colour, test-context and git hook variables must not leak into the child.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== 'FORCE_COLOR' && k !== 'NODE_TEST_CONTEXT' && !k.startsWith('GIT_')),
  );
  const { stdout } = await promisify(execFile)(process.execPath, [script], { env });
  assert.match(stdout, /1000-page PDF load: \d+\.\d+ ms/);
  assert.match(stdout, /1000 page slots and 1000 thumbnails: \d+\.\d+ ms/);
});

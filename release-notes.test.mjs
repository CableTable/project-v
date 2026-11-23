import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addedLines, releaseTag } from './tools/release-notes.mjs';

const TODO = [
  '| T18 | Bigger tab close `×`: 16px glyph (ticket T119; `web/app.css:56-59`) | done d9de46d (King) |',
  '| T19 | Toolbar redesign: icons with tooltips (name + shortcut), page centred | done 86461f0 |',
  '| T20 | GitHub release job for Project V | open |',
  '| T21 | Plain row no brackets | open |',
].join('\r\n');

test('addedLines: ids from T<n> subjects, title from the row, oldest first, once each, TODO ticks skipped', () => {
  const log = [
    'TODO: T19 done (86461f0)', // tick commit: not an exe change
    'T20 fix: second round',
    'T19: toolbar redesign (variant C)',
    'V-free2: a decode overtaken by free()', // no T id: not listed
    'T18: bigger tab close',
    'T99: no row for this one',
  ];
  assert.deepEqual(addedLines(log, TODO), [
    'T99 no row for this one',
    'T18 Bigger tab close `×`: 16px glyph',
    'T19 Toolbar redesign: icons with tooltips',
    'T20 GitHub release job for Project V',
  ]);
});

test('addedLines: a T20 subject maps to its TODO row; a row with no bracket keeps the whole title', () => {
  assert.deepEqual(addedLines(['T20: release job: push to main publishes ProjectV.exe'], TODO), ['T20 GitHub release job for Project V']);
  assert.deepEqual(addedLines(['T21: plain'], TODO), ['T21 Plain row no brackets']);
  assert.deepEqual(addedLines(['TODO: T20 done (abc1234)', 'lowsV54d: x'], TODO), []);
});

test('releaseTag: the IST date, .2 and .3 when that day has a tag', () => {
  const now = new Date('2026-11-15T20:00:00Z'); // 01:30 IST on the 16th
  assert.equal(releaseTag(['v0.1.360'], now), 'v2026.11.16');
  assert.equal(releaseTag(['v2026.11.16', 'v2026.11.15'], now), 'v2026.11.16.2');
  assert.equal(releaseTag(['v2026.11.16', 'v2026.11.16.2'], now), 'v2026.11.16.3');
  assert.equal(releaseTag([], new Date('2026-11-16T18:00:00Z')), 'v2026.11.16'); // 23:30 IST, still the 16th
});

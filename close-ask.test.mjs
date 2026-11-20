import test from 'node:test';
import assert from 'node:assert/strict';
import { closeRequest, choose } from './web/close-ask.js';

test('a window close asks only with 2+ tabs and the setting on; a second request while asking is ignored', () => {
  assert.equal(closeRequest({ asking: false, tabs: 0, ask: true }), 'close');
  assert.equal(closeRequest({ asking: false, tabs: 1, ask: true }), 'close');
  assert.equal(closeRequest({ asking: false, tabs: 2, ask: true }), 'ask');
  assert.equal(closeRequest({ asking: false, tabs: 7, ask: true }), 'ask');
  assert.equal(closeRequest({ asking: false, tabs: 2, ask: false }), 'close');
  assert.equal(closeRequest({ asking: true, tabs: 2, ask: true }), 'ignore');
});

test('the three answers, with a fake close API; Don\'t ask again is saved only with Close all / Close this tab', () => {
  const run = (choice, dontAsk) => {
    const calls = [];
    choose(choice, dontAsk, { exit: () => calls.push('exit'), closeTab: () => calls.push('closeTab'), stopAsking: () => calls.push('stopAsking') });
    return calls;
  };
  assert.deepEqual(run('all', false), ['exit']);
  assert.deepEqual(run('tab', false), ['closeTab']);
  assert.deepEqual(run('cancel', false), []);
  assert.deepEqual(run('all', true), ['stopAsking', 'exit']);
  assert.deepEqual(run('tab', true), ['stopAsking', 'closeTab']);
  assert.deepEqual(run('cancel', true), []);
});

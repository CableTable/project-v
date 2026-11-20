import test from 'node:test';
import assert from 'node:assert/strict';
import { horizontalWheel, wheelDistance, wheelLine } from './web/wheel.js';

// A fake view: scrollLeft snaps to device pixels and stops at the edges, like Chromium's. Frames are 16 ms of simulated time
// (no real waiting). The browser's own scroll of an event nobody prevented lands `nativeAfter` frames later (Infinity: never,
// as the MX thumb wheel did in WebView2 before T7); synthetic events never scroll natively, so this models it.
function rig({ dpr = 1, max = 5000, nativeAfter = 3 } = {}) {
  let left = 0, frames = [], native = [], frame = 0;
  const view = {
    clientWidth: 800,
    get scrollLeft() { return left; },
    set scrollLeft(v) { left = Math.min(max, Math.max(0, Math.round(v * dpr) / dpr)); },
  };
  globalThis.requestAnimationFrame = (cb) => frames.push(cb);
  const handler = horizontalWheel(view);
  const tick = () => {
    frame++;
    const due = frames;
    frames = [];
    due.forEach((cb) => cb(frame * 16));
    for (const n of native.filter((n) => n.at === frame)) view.scrollLeft += n.dx;
  };
  /** Dispatches one wheel event and runs `after` frames; returns how far scrollLeft moved and whether it was prevented in time. */
  const send = (init, after = 4) => {
    const before = left;
    let dispatching = true, prevented = false;
    const e = { deltaMode: 0, deltaX: 0, deltaY: 0, shiftKey: false, ctrlKey: false, cancelable: true, ...init,
      preventDefault() { if (dispatching && this.cancelable) prevented = true; } }; // after dispatch it does nothing
    handler(e);
    dispatching = false;
    const dx = (e.deltaX || (e.shiftKey ? e.deltaY : 0)) * (e.deltaMode === 1 ? 16 : 1); // Chromium scrolls Shift + wheel sideways
    if (!prevented && dx && !e.ctrlKey && nativeAfter !== Infinity) native.push({ at: frame + nativeAfter, dx });
    for (let i = 0; i < after; i++) tick();
    return { moved: left - before, prevented };
  };
  return { send, view };
}

test('deltaX bursts over a simulated 6 s: every event scrolls once, it never stops', () => {
  const { send, view } = rig();
  for (let i = 0; i < 375; i++) { // one event a frame, 6 s
    const { moved, prevented } = send({ deltaX: 4 }, 1);
    assert.equal(moved, 4, `event ${i}`);
    assert.ok(prevented, `event ${i} prevented while dispatched`);
  }
  for (let i = 0; i < 10; i++) send({ deltaX: 0 }, 1); // late native scrolls would land here
  assert.equal(view.scrollLeft, 1500);
});

test('Shift + wheel (lines, and Chromium-style deltaX): scrolled once, prevented while dispatched', () => {
  const { send } = rig();
  assert.deepEqual(send({ deltaY: 3, deltaMode: 1, shiftKey: true }), { moved: 48, prevented: true });
  assert.deepEqual(send({ deltaX: 40, shiftKey: true }), { moved: 40, prevented: true });
});

test('deltaX with deltaY != 0 (diagonal trackpad pan) is the browser\'s: it scrolls once', () => {
  const { send } = rig();
  assert.deepEqual(send({ deltaX: 30, deltaY: 5 }), { moved: 30, prevented: false });
});

test('deltaMode 1 is 16 px a line, deltaMode 2 a view width', () => {
  const { send } = rig();
  assert.equal(send({ deltaX: 2, deltaMode: 1 }).moved, 32);
  assert.equal(send({ deltaX: 1, deltaMode: 2 }).moved, 800);
});

test('a slow hi-res thumb wheel (sub-pixel deltaX) still moves, every event prevented', () => {
  const { send, view } = rig({ dpr: 1.25, nativeAfter: Infinity });
  for (let i = 0; i < 100; i++) assert.ok(send({ deltaX: 0.3 }, 1).prevented, `event ${i}`);
  assert.ok(Math.abs(view.scrollLeft - 30) < 1, `scrollLeft ${view.scrollLeft}, want ~30`);
});

test('at the right edge the event is still prevented, and coming back is not held by a carried rest', () => {
  const { send, view } = rig({ max: 100 });
  for (let i = 0; i < 5; i++) assert.ok(send({ deltaX: 40 }).prevented);
  assert.equal(view.scrollLeft, 100);
  assert.equal(send({ deltaX: -10 }).moved, -10);
});

test('plain vertical wheel and Ctrl + wheel are not touched', () => {
  const { send } = rig();
  assert.deepEqual(send({ deltaY: 100 }), { moved: 0, prevented: false });
  assert.deepEqual(send({ deltaX: 20, ctrlKey: true }), { moved: 0, prevented: false });
  assert.equal(wheelDistance({ deltaX: 0, deltaY: 100, deltaMode: 0 }, 800), 0);
});

test('wheelLine: one log line with every field', () => {
  const e = { deltaX: 4.5, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, cancelable: true, defaultPrevented: true };
  assert.equal(wheelLine(e, 'direct', 10, 14.5, new Date(Date.UTC(2026, 10, 20, 17, 30))),
    '2026-11-20T17:30:00.000Z dx=4.5 dy=0 mode=0 shift=0 ctrl=0 cancelable=1 path=direct left=10->14.5 prevented=1\n');
});

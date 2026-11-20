// wheel.js — horizontal wheel on the page view (T7, T10): deltaX, or Shift + wheel, scrolls view.scrollLeft. Pure, so wheel.test.mjs drives it.
// T10: every horizontal event is prevented while it is dispatched and scrolled here once, so the browser never also scrolls it, and an
// un-prevented event can not turn the rest of Chromium's wheel sequence non-cancelable. A diagonal trackpad pan (deltaX and deltaY, no
// Shift) stays the browser's, both axes.

/** CSS px the event scrolls sideways, 0 when it is not ours (Ctrl = zoom, plain vertical, diagonal pan). */
export function wheelDistance({ deltaMode, deltaX, deltaY, shiftKey, ctrlKey }, pageWidth) {
  if (ctrlKey || (deltaY && !shiftKey)) return 0;
  const dx = deltaX || (shiftKey ? deltaY : 0);
  return dx * (deltaMode === 1 ? 16 : deltaMode === 2 ? pageWidth : 1);
}

/** The wheel handler of `view`: returns 'direct' when it scrolled the event, else 'none'. */
export function horizontalWheel(view) {
  let carry = 0; // the sub-pixel rest the view rounded away, so a slow hi-res thumb wheel still moves
  return (e) => {
    const distance = wheelDistance(e, view.clientWidth);
    if (!distance) return 'none';
    e.preventDefault();
    const want = view.scrollLeft + carry + distance;
    view.scrollLeft = want;
    carry = want - view.scrollLeft;
    if (Math.abs(carry) >= 1) carry = 0; // stopped at an edge: no rest to carry
    return 'direct';
  };
}

/** One line of the opt-in wheel log (T10). */
export function wheelLine(e, path, before, after, time = new Date()) {
  const b = (v) => (v ? 1 : 0);
  return `${time.toISOString()} dx=${e.deltaX} dy=${e.deltaY} mode=${e.deltaMode} shift=${b(e.shiftKey)} ctrl=${b(e.ctrlKey)} ` +
    `cancelable=${b(e.cancelable)} path=${path} left=${before}->${after} prevented=${b(e.defaultPrevented)}\n`;
}

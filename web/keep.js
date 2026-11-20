// keep.js — which documents keep their drawn pages while in the background (T15): the n most recent, the shown one included.
/** `order` is most-recent-first; `handle` was just shown. Returns the new order and the handles to free (any values, compared with ===). */
export function keepList(order, handle, n = 5) {
  const next = [handle, ...order.filter((h) => h !== handle)];
  return { order: next.slice(0, n), free: next.slice(n) };
}

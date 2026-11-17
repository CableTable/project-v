// tabs.js — the open tabs (T2b): pure, no DOM, no pdf.js. A state is { list, active, next }; every function returns a new state.
// A tab is { id, key, name, title, doc, error }: `key` says which file it is (its path), `doc` is the viewer's handle (null for a file that failed to open),
// The viewer's document handle keeps the tab's scroll, zoom, page and find state.

// Windows paths: no case, either slash.
export const pathKey = (key) => key.replace(/\//g, '\\').toLowerCase();

export const emptyTabs = () => ({ list: [], active: null, next: 1 });
export const activeTab = (s) => s.list.find((t) => t.id === s.active);
export const findByKey = (s, key) => s.list.find((t) => pathKey(t.key) === pathKey(key));

/** Appends a tab ({ key, name, title, doc, error }) and makes it the active one. */
export function openTab(s, tab) {
  return { list: [...s.list, { ...tab, id: s.next }], active: s.next, next: s.next + 1 };
}

export const activate = (s, id) => (s.list.some((t) => t.id === id) ? { ...s, active: id } : s);

/** Removes a tab. Closing the active one activates its right neighbour, else the left one, else none. */
export function closeTab(s, id) {
  const i = s.list.findIndex((t) => t.id === id);
  if (i < 0) return s;
  const list = s.list.filter((t) => t.id !== id);
  return { ...s, list, active: id !== s.active ? s.active : (list[i] ?? list[i - 1])?.id ?? null };
}

/** Next (dir 1) or previous (dir -1) tab, wrapping round. */
export function cycle(s, dir) {
  const n = s.list.length, i = s.list.findIndex((t) => t.id === s.active);
  return n < 2 || i < 0 ? s : { ...s, active: s.list[(i + dir + n) % n].id };
}

export const patchTab = (s, id, patch) => ({ ...s, list: s.list.map((t) => (t.id === id ? { ...t, ...patch } : t)) });

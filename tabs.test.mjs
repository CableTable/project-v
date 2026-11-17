import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTabs, activeTab, findByKey, openTab, activate, closeTab, cycle, patchTab } from './web/tabs.js';

const tab = (key, extra = {}) => ({ key, name: key.split(/[\\/]/).pop(), title: key, doc: { key }, error: null, ...extra });
/** A state with tabs a, b, c open (c active) and their ids. */
function three() {
  let s = emptyTabs();
  for (const k of ['C:\\a.pdf', 'C:\\b.pdf', 'C:\\c.pdf']) s = openTab(s, tab(k));
  return { s, ids: s.list.map((t) => t.id) };
}
const names = (s) => s.list.map((t) => t.name);

test('openTab: appends, activates the new tab, ids are never reused', () => {
  let s = emptyTabs();
  assert.equal(activeTab(s), undefined);
  s = openTab(s, tab('C:\\a.pdf'));
  s = openTab(s, tab('C:\\b.pdf'));
  assert.deepEqual(names(s), ['a.pdf', 'b.pdf']);
  assert.equal(activeTab(s).name, 'b.pdf');
  const id = s.list[1].id;
  s = closeTab(s, id);
  s = openTab(s, tab('C:\\c.pdf'));
  assert.notEqual(s.list[1].id, id);
  assert.equal(s.list[1].doc.key, 'C:\\c.pdf', 'the viewer handle is kept as given');
});

test('findByKey: same path = same tab, case-insensitive, either slash; other paths and no tabs do not match', () => {
  const { s } = three();
  assert.equal(findByKey(s, 'c:\\A.PDF').name, 'a.pdf');
  assert.equal(findByKey(s, 'C:/b.pdf').name, 'b.pdf');
  assert.equal(findByKey(s, 'C:\\d.pdf'), undefined);
  assert.equal(findByKey(s, 'C:\\sub\\a.pdf'), undefined);
  assert.equal(findByKey(emptyTabs(), 'C:\\a.pdf'), undefined);
});

test('activate: switches; an unknown id changes nothing', () => {
  const { s, ids } = three();
  assert.equal(activate(s, ids[0]).active, ids[0]);
  assert.equal(activate(s, 999), s);
});

test('closeTab: the active tab hands over to its right neighbour, else the left, else none', () => {
  const { s, ids } = three();
  assert.equal(activeTab(closeTab(activate(s, ids[0]), ids[0])).name, 'b.pdf', 'first: right neighbour');
  assert.equal(activeTab(closeTab(activate(s, ids[1]), ids[1])).name, 'c.pdf', 'middle: right neighbour');
  assert.equal(activeTab(closeTab(s, ids[2])).name, 'b.pdf', 'last: left neighbour');
  let one = closeTab(closeTab(s, ids[2]), ids[1]);
  assert.equal(activeTab(one).name, 'a.pdf');
  one = closeTab(one, ids[0]);
  assert.deepEqual(one.list, []);
  assert.equal(one.active, null, 'closing the last tab leaves none active');
  assert.equal(activeTab(one), undefined);
});

test('closeTab: a background tab closes without changing the active one; an unknown id changes nothing', () => {
  const { s, ids } = three();
  const t = closeTab(activate(s, ids[0]), ids[2]);
  assert.deepEqual(names(t), ['a.pdf', 'b.pdf']);
  assert.equal(activeTab(t).name, 'a.pdf');
  assert.equal(closeTab(s, 999), s);
});

test('cycle: next / previous wrap round; one tab or none stays put', () => {
  const { s, ids } = three();
  assert.equal(cycle(s, 1).active, ids[0], 'c -> a');
  assert.equal(cycle(activate(s, ids[0]), -1).active, ids[2], 'a -> c');
  assert.equal(cycle(activate(s, ids[0]), 1).active, ids[1]);
  const one = openTab(emptyTabs(), tab('C:\\a.pdf'));
  assert.equal(cycle(one, 1), one);
  assert.equal(cycle(emptyTabs(), -1).active, null);
});

test('patchTab: changes one tab only; the old state is not touched', () => {
  const { s, ids } = three();
  const p = patchTab(s, ids[1], { error: 'b.pdf: not a valid PDF', doc: null });
  assert.equal(p.list[1].error, 'b.pdf: not a valid PDF');
  assert.equal(p.list[1].doc, null);
  assert.equal(p.list[0].error, null);
  assert.equal(s.list[1].error, null);
  assert.equal(p.active, s.active);
});

test('a failed open is a tab of its own: it keeps its message and its path', () => {
  let { s } = three();
  s = openTab(s, tab('C:\\bad.pdf', { doc: null, error: 'bad.pdf: not a valid PDF' }));
  assert.equal(activeTab(s).error, 'bad.pdf: not a valid PDF');
  assert.equal(findByKey(s, 'c:\\BAD.pdf').doc, null);
  s = activate(s, s.list[0].id);
  assert.equal(activeTab(s).error, null, 'the message belongs to its tab, not to the window');
});

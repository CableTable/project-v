// Opening: Ctrl+O dialog, drag-drop, launch / second-launch paths (T1). Tabs (T2b): one tab per open file, tabs.js holds the list, the page view is viewer.js.
import { openPdf, show, closeDoc } from './viewer.js';
import { emptyTabs, activeTab, findByKey, openTab, activate, closeTab, cycle, patchTab } from './tabs.js';
import { createMergeWindow } from './merge-ui.js';
import { createRecentFiles } from './recent-ui.js';
import { showFind } from './find-ui.js';

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);
const baseName = (path) => path.split(/[\\/]/).pop();
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? '' });

let tabs = emptyTabs(), notes = []; // notes: lines that belong to no tab; a failed file's message is its tab's `error`

/** Shows the active tab (the empty state for none, or for a file that failed to open), the strip and the message lines. */
function render() {
  const now = activeTab(tabs);
  showFind(now?.doc ?? null);
  show(now?.doc ?? null);
  const strip = $('tabs');
  strip.hidden = !tabs.list.length;
  strip.replaceChildren(...tabs.list.map((t) => {
    const tab = el('div', t.id === tabs.active ? 'tab on' : 'tab'), name = el('button', 'tl', t.name), x = el('button', 'tx', '×');
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', t.id === tabs.active);
    name.title = t.title; // the full path
    x.title = 'Close (Ctrl+W)';
    x.setAttribute('aria-label', `Close ${t.name}`);
    name.onclick = () => { tabs = activate(tabs, t.id); render(); };
    x.onclick = () => close(t.id);
    tab.onmousedown = (e) => { if (e.button === 1) e.preventDefault(); }; // no autoscroll on a middle click
    tab.onauxclick = (e) => { if (e.button === 1) close(t.id); };
    tab.append(name, x);
    return tab;
  }));
  strip.querySelector('.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const lines = [...notes.map((text) => ({ text })), ...(now?.error ? [{ text: now.error, tab: now.id }] : [])];
  $('msgs').replaceChildren(...lines.map(({ text, tab }) => {
    const row = document.createElement('div'), x = el('button', '', 'Dismiss');
    x.onclick = () => { if (tab) tabs = patchTab(tabs, tab, { error: null }); else notes = notes.filter((n) => n !== text); render(); };
    row.append(el('span', '', text), x); // text comes from files and the OS: textContent only
    return row;
  }));
}

function close(id) {
  const t = tabs.list.find((x) => x.id === id);
  if (!t) return;
  tabs = closeTab(tabs, id);
  if (t.doc) closeDoc(t.doc); // frees its pdf.js document
  render();
}

const say = (text) => { notes.push(text); render(); };

// Items are { key, name, title, read() -> bytes }: `key` is the path (a dropped file has none: name, size and date stand in). They open in order,
// one after the other, each in its own tab. The file already open is switched to; a failure is said in its own tab and the rest still open.
let queue = Promise.resolve();
function openAll(items, replaceExisting = false) {
  queue = queue.then(async () => {
    notes = [];
    for (const item of items) {
      const { key, name, read } = item;
      const have = findByKey(tabs, key);
      if (have && !have.error && !replaceExisting) tabs = activate(tabs, have.id);
      else {
        if (have) {
          tabs = closeTab(tabs, have.id);
          if (have.doc) closeDoc(have.doc);
        }
        let doc = null, error = null;
        try { doc = await openPdf(name, await read()); }
        catch (e) { error = e instanceof Error ? e.message : String(e); }
        tabs = openTab(tabs, { ...item, doc, error });
      }
      if (item.path && activeTab(tabs)?.doc) remember(item.path);
      render();
    }
  });
}

/** A file on disk, read through the fs plugin (the dialog and the Rust launch code grant exactly that path). */
const fromPath = (path) => {
  const name = baseName(path);
  return {
    key: path, name, title: path, path,
    read: async () => {
      try { return await tauri.fs.readFile(path); }
      catch (e) { throw new Error(`${name}: ${/os error [23]\b|not found/i.test(e) ? 'file not found' : e}`); }
    },
  };
};
/** A dropped file: the browser hands over the bytes, no path and no fs scope. */
const fromFile = (file) => ({
  key: `drop:${file.name}|${file.size}|${file.lastModified}`, name: file.name, title: file.name,
  read: async () => new Uint8Array(await file.arrayBuffer()),
});

const remember = createRecentFiles({ tauri, open: (path) => openAll([fromPath(path)]), say });

const merge = createMergeWindow({ tauri, fromPath, fromFile, openResult: (path) => openAll([fromPath(path)], true) });
const openMerge = () => merge.open(activeTab(tabs));
$('merge').onclick = openMerge;

async function pickFile() {
  if (!tauri) return;
  const path = await tauri.dialog.open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] }); // null when cancelled
  if (path) openAll([fromPath(path)]);
}
$('open').onclick = $('open2').onclick = pickFile;
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase(), now = activeTab(tabs);
  if (k === 'o' && !e.shiftKey) { e.preventDefault(); pickFile(); }
  else if (k === 'm' && e.shiftKey) { e.preventDefault(); openMerge(); }
  else if (k === 'tab') { e.preventDefault(); tabs = cycle(tabs, e.shiftKey ? -1 : 1); render(); }
  else if (k === 'w' && !e.shiftKey) { e.preventDefault(); if (now) close(now.id); }
});
document.addEventListener('dragover', (e) => e.preventDefault()); // without this the drop is refused
document.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!merge.drop(e)) openAll([...e.dataTransfer.files].map(fromFile));
});

// Launch / second-launch paths arrive from Rust (single-instance).
if (tauri) {
  const take = () => tauri.core.invoke('take_launch_files').then(
    (paths) => { if (paths.length) openAll(paths.map(fromPath)); },
    (e) => say(`Could not read the launch files: ${e}`));
  tauri.event.listen('open-launch-files', take);
  take();
}

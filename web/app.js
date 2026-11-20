// Opening: Ctrl+O dialog, drag-drop, launch / second-launch paths (T1). Tabs (T2b): one tab per open file, tabs.js holds the list, the page view is viewer.js.
import { openPdf, show, closeDoc, setInstantTabs, setWheelLog } from './viewer.js';
import { createSettings } from './settings-ui.js';
import { emptyTabs, activeTab, findByKey, openTab, activate, closeTab, cycle, patchTab } from './tabs.js';
import { createMergeWindow } from './merge-ui.js';
import { createRecentFiles } from './recent-ui.js';
import { showFind } from './find-ui.js';
import { canOpenInD, isOpenInDShortcut } from './open-in-d.js';
import { OPEN_EXTS } from './ai-file.js';
import { createPrint } from './print-ui.js';
import { createCloseAsk } from './close-ask.js';

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);
const baseName = (path) => path.split(/[\\/]/).pop();
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? '' });

let tabs = emptyTabs(), notes = []; // notes: lines that belong to no tab; a failed file's message is its tab's `error`
const printRow = el('div', ''); // "Preparing print i / n": kept across render() so each page only sets its text
printRow.hidden = true;
const print = createPrint({ status: (text) => { printRow.textContent = text ?? ''; printRow.hidden = !text; }, say: (text) => say(text) });

/** Shows the active tab (the empty state for none, or for a file that failed to open), the strip and the message lines. */
function render() {
  const now = activeTab(tabs);
  print.cancel((doc) => doc !== now?.doc); // switching tabs stops a print that is still being prepared
  $('open-in-d').disabled = !canOpenInD(now);
  $('print').disabled = !now?.doc;
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
  }), printRow);
}

function close(id) {
  const t = tabs.list.find((x) => x.id === id);
  if (!t) return;
  tabs = closeTab(tabs, id);
  if (t.doc) {
    print.cancel((doc) => doc === t.doc); // before the pdf.js document is destroyed
    closeDoc(t.doc); // frees its pdf.js document
  }
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
          if (have.doc) {
            print.cancel((doc) => doc === have.doc);
            closeDoc(have.doc);
          }
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

/** ⚙ "Log wheel events" (T10): Rust appends each line to wheel-log.txt in the app data folder (stops at 1 MB); the panel shows the path. */
function wheelLog(on) {
  const shown = $('wheel-log-path');
  shown.textContent = '';
  setWheelLog(null);
  if (!on || !tauri) return;
  const write = (line) => tauri.core.invoke('wheel_log', { line });
  write('').then((path) => {
    if (!$('wheel-log').checked) return; // switched off while the file was being made
    shown.textContent = path;
    setWheelLog((line) => write(line).catch((e) => console.warn('Wheel log', e)));
  }, (e) => { shown.textContent = `Could not write the wheel log: ${e}`; });
}
let askClose = true; // ⚙ "Ask before closing several tabs" (T16)
createSettings({ instantTabs: setInstantTabs, wheelLog, askClose: (on) => { askClose = on; } });
const remember = createRecentFiles({ tauri, open: (path) => openAll([fromPath(path)]), say });

const merge = createMergeWindow({ tauri, fromPath, fromFile, openResult: (path) => openAll([fromPath(path)], true) });
const openMerge = () => merge.open(activeTab(tabs));
$('merge').onclick = openMerge;

let openingInD = false;
async function openInD() {
  const tab = activeTab(tabs);
  if (!tauri || !canOpenInD(tab) || openingInD) return;
  openingInD = true;
  try {
    const open = () => tauri.core.invoke('open_in_d', { pdf: tab.path });
    if (await open() !== 'pick') return;
    if (await tauri.core.invoke('test_dir') !== null) {
      document.body.dataset.vPick = '1';
      return;
    }
    const path = await tauri.dialog.open({ title: 'Select ProjectD.exe', filters: [{ name: 'ProjectD.exe', extensions: ['exe'] }] });
    if (!path) return;
    await tauri.core.invoke('set_d_path', { path });
    if (await open() === 'pick') say('Could not find ProjectD.exe at the selected path.');
  } catch (e) {
    say(`Could not open in Project D: ${e instanceof Error ? e.message : e}`);
  } finally {
    openingInD = false;
  }
}
$('open-in-d').onclick = openInD;
$('print').onclick = () => print.start(activeTab(tabs)?.doc);

async function pickFile() {
  if (!tauri) return;
  const path = await tauri.dialog.open({ filters: [{ name: 'PDF or AI', extensions: OPEN_EXTS }] }); // null when cancelled
  if (path) openAll([fromPath(path)]);
}
$('open').onclick = $('open2').onclick = pickFile;
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase(), now = activeTab(tabs);
  if (k === 'o' && !e.shiftKey) { e.preventDefault(); pickFile(); }
  else if (k === 'm' && e.shiftKey) { e.preventDefault(); openMerge(); }
  else if (isOpenInDShortcut(e)) { e.preventDefault(); openInD(); }
  else if (k === 'tab') { e.preventDefault(); tabs = cycle(tabs, e.shiftKey ? -1 : 1); render(); }
  else if (k === 'w' && !e.shiftKey) { e.preventDefault(); if (now) close(now.id); }
  else if (k === 'p') { e.preventDefault(); print.start(now?.doc); } // always: else WebView2 prints the app UI
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

  // Title-bar X, Alt+F4, taskbar Close window (T16): with 2+ tabs the box asks first.
  const win = tauri.window.getCurrentWindow();
  win.onCloseRequested(createCloseAsk({
    ask: () => askClose,
    count: () => tabs.list.length,
    api: {
      exit: () => win.destroy().catch((e) => say(`Could not close the window: ${e}`)),
      closeTab: () => { const now = activeTab(tabs); if (now) close(now.id); },
      stopAsking: () => { const box = $('ask-close'); box.checked = false; box.dispatchEvent(new Event('change')); }, // saved by the ⚙ toggle
    },
  }));
}

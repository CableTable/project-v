// Opening: Ctrl+O dialog, drag-drop, launch / second-launch paths (T1). The page view is viewer.js; tabs (T2b) will keep one viewer state each.
import { openPdf } from './viewer.js';

const tauri = window.__TAURI__;
const $ = (id) => document.getElementById(id);
const baseName = (path) => path.split(/[\\/]/).pop();

/** One dismissable line under the toolbar. The text comes from files and the OS: textContent only. */
function say(text) {
  const row = document.createElement('div'), msg = document.createElement('span'), x = document.createElement('button');
  msg.textContent = text;
  x.textContent = 'Dismiss';
  x.onclick = () => row.remove();
  row.append(msg, x);
  $('msgs').append(row);
}

// Items are { name, read() -> bytes }. They open in order, one after the other; a failure is said and the rest still open.
// One document is shown at a time (T2a): the last one opened stays on screen.
let queue = Promise.resolve();
function openAll(items) {
  queue = queue.then(async () => {
    $('msgs').replaceChildren();
    for (const { read } of items) {
      try { await openPdf(...(await read())); }
      catch (e) { say(e instanceof Error ? e.message : String(e)); }
    }
  });
}

/** A file on disk, read through the fs plugin (the dialog and the Rust launch code grant exactly that path). */
const fromPath = (path) => ({
  read: async () => {
    const name = baseName(path);
    try { return [name, await tauri.fs.readFile(path)]; }
    catch (e) { throw new Error(`${name}: ${/os error [23]\b|not found/i.test(e) ? 'file not found' : e}`); }
  },
});
/** A dropped file: the browser hands over the bytes, no path and no fs scope. */
const fromFile = (file) => ({ read: async () => [file.name, new Uint8Array(await file.arrayBuffer())] });

async function pickFile() {
  if (!tauri) return;
  const path = await tauri.dialog.open({ filters: [{ name: 'PDF', extensions: ['pdf'] }] }); // null when cancelled
  if (path) openAll([fromPath(path)]);
}
$('open').onclick = $('open2').onclick = pickFile;
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'o') { e.preventDefault(); pickFile(); }
});
document.addEventListener('dragover', (e) => e.preventDefault()); // without this the drop is refused
document.addEventListener('drop', (e) => {
  e.preventDefault();
  openAll([...e.dataTransfer.files].map(fromFile));
});

// Launch / second-launch paths arrive from Rust (single-instance).
if (tauri) {
  const take = () => tauri.core.invoke('take_launch_files').then(
    (paths) => { if (paths.length) openAll(paths.map(fromPath)); },
    (e) => say(`Could not read the launch files: ${e}`));
  tauri.event.listen('open-launch-files', take);
  take();
}

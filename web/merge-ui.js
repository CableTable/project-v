import { addFiles, clearFiles, mergePdfs, moveDown, moveFile, moveUp, removeFile, sortFiles } from './merge.js';

const filters = [{ name: 'PDF', extensions: ['pdf'] }];
const el = (tag, text = '') => Object.assign(document.createElement(tag), { textContent: text });
const button = (text, run) => Object.assign(el('button', text), { type: 'button', onclick: run });

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

async function read(file) {
  try { return await file.read(); }
  catch (cause) {
    const message = `${file.name}: could not read file.`;
    file.error.textContent = message;
    throw new Error(message, { cause });
  }
}

async function preview(file, isListed) {
  let task;
  try {
    const bytes = await read(file);
    if (!isListed()) return;
    file.info.textContent = sizeLabel(bytes.byteLength);
    const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
    if (!isListed()) return;
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
    task = pdfjs.getDocument({ data: bytes, stopAtErrors: true });
    const pdf = await task.promise;
    if (!isListed()) return;
    file.info.textContent += ` · ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
    const page = await pdf.getPage(1);
    const { width, height } = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(72 / width, 88 / height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    file.thumb.replaceChildren(canvas);
  } catch (error) {
    if (!task) {
      file.info.textContent = '';
      file.error.textContent ||= `${file.name}: ${error?.message || error}`;
    } else {
      const reason = error?.name === 'PasswordException' ? 'password-protected PDF' : 'invalid or damaged PDF';
      file.error.textContent = `${file.name}: ${reason}.`;
    }
  } finally {
    await task?.destroy().catch(console.warn);
  }
}

export function createMergeWindow({ tauri, fromPath, fromFile, openResult }) {
  const style = Object.assign(el('link'), { rel: 'stylesheet', href: new URL('./merge.css', import.meta.url).href });
  document.head.append(style);

  let list = clearFiles(), busy = false, dragged = null, previews = Promise.resolve();
  const dialog = el('dialog');
  dialog.id = 'merge-dialog';
  dialog.setAttribute('aria-labelledby', 'merge-title');
  const title = el('h2', 'Merge PDFs');
  title.id = 'merge-title';
  const header = el('header');
  const closeButton = button('Close', close);
  header.append(title, closeButton);

  const toolbar = el('div');
  toolbar.className = 'merge-toolbar';
  const pickButton = button('Add files', pick);
  pickButton.autofocus = true;
  const clearButton = button('Clear all', () => { setList(clearFiles()); pickButton.focus(); });
  const az = button('Sort A–Z', () => setList(sortFiles(list)));
  const za = button('Sort Z–A', () => setList(sortFiles(list, true)));
  toolbar.append(pickButton, clearButton, az, za);

  const hint = el('p', 'Drop PDF files here');
  hint.className = 'merge-hint';
  const cards = el('ol');
  cards.setAttribute('aria-label', 'PDFs in merge order');
  const status = el('p');
  status.setAttribute('role', 'status');
  const mergeButton = button('Merge', save);
  mergeButton.className = 'acc';
  const footer = el('footer');
  footer.append(status, mergeButton);
  dialog.append(header, toolbar, hint, cards, footer);
  document.body.append(dialog);

  function updateControls() {
    closeButton.disabled = busy;
    pickButton.disabled = busy || !tauri;
    clearButton.disabled = busy || !list.length;
    az.disabled = za.disabled = busy || list.length < 2;
    mergeButton.disabled = busy || !tauri || list.length < 2;
    hint.hidden = Boolean(list.length);
    for (const [i, file] of list.entries()) {
      file.up.disabled = busy || i === 0;
      file.down.disabled = busy || i === list.length - 1;
      file.remove.disabled = busy;
      file.card.draggable = !busy;
    }
  }

  function setList(next) {
    list = next;
    const scrollTop = cards.scrollTop;
    cards.replaceChildren(...list.map((file) => file.card));
    cards.scrollTop = scrollTop;
    status.textContent = '';
    updateControls();
  }

  function makeCard(item) {
    const file = { ...item, card: el('li'), thumb: el('div'), info: el('div', 'Reading…'), error: el('div') };
    file.thumb.className = 'merge-thumb';
    file.thumb.setAttribute('aria-hidden', 'true');
    file.info.className = 'merge-info';
    file.error.className = 'merge-error';
    const name = el('strong', file.name), description = el('div'), actions = el('div');
    description.className = 'merge-description';
    description.append(name, file.info, file.error);
    actions.className = 'merge-actions';
    file.up = button('↑', () => {
      setList(moveUp(list, list.indexOf(file)));
      (file.up.disabled ? file.down : file.up).focus();
    });
    file.down = button('↓', () => {
      setList(moveDown(list, list.indexOf(file)));
      (file.down.disabled ? file.up : file.down).focus();
    });
    file.remove = button('×', () => {
      const index = list.indexOf(file);
      setList(removeFile(list, index));
      (list[index]?.remove ?? list.at(-1)?.remove ?? pickButton).focus();
    });
    for (const [control, label] of [[file.up, 'Move up'], [file.down, 'Move down'], [file.remove, 'Remove']]) {
      control.title = label;
      control.setAttribute('aria-label', `${label} ${file.name}`);
    }
    actions.append(file.up, file.down, file.remove);
    file.card.append(file.thumb, description, actions);
    file.card.ondragstart = (event) => {
      dragged = file;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', file.name);
    };
    file.card.ondragend = () => { dragged = null; };
    previews = previews.then(() => list.includes(file) && preview(file, () => list.includes(file)));
    return file;
  }

  function add(items) {
    const pdfs = items.filter(({ name }) => /\.pdf$/i.test(name));
    if (pdfs.length) setList(addFiles(list, pdfs.map(makeCard)));
    if (pdfs.length !== items.length) status.textContent = 'Only .pdf files can be added.';
  }

  function open(active) {
    if (dialog.open) return;
    setList(clearFiles());
    if (active) add([active]);
    dialog.showModal();
  }

  function close() {
    dialog.close();
    dragged = null;
    setList(clearFiles());
  }

  function drop(event) {
    if (!dialog.open) return false;
    if (!busy && event.dataTransfer.files.length) add([...event.dataTransfer.files].map(fromFile));
    else if (!busy && dragged) {
      const to = list.findIndex(({ card }) => card.contains(event.target));
      const next = moveFile(list, list.indexOf(dragged), to);
      if (next !== list) setList(next);
    }
    dragged = null;
    return true;
  }

  dialog.ondragover = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : dragged ? 'move' : 'copy';
  };
  dialog.oncancel = (event) => { event.preventDefault(); if (!busy) close(); };
  dialog.onkeydown = (event) => event.stopPropagation();
  dialog.addEventListener('wheel', (event) => {
    if (event.ctrlKey) { event.preventDefault(); event.stopPropagation(); }
  }, { passive: false });

  async function pick() {
    busy = true;
    updateControls();
    try {
      const paths = await tauri.core.invoke('test_merge_inputs') ?? await tauri.dialog.open({ multiple: true, filters });
      if (paths) add(paths.map(fromPath));
    } catch (error) {
      status.textContent = `Could not select PDFs: ${error?.message || error}`;
    } finally {
      busy = false;
      updateControls();
      pickButton.focus();
    }
  }

  async function save() {
    busy = true;
    updateControls();
    status.textContent = 'Merging PDFs…';
    try {
      const inputs = [];
      for (const file of list) {
        if (file.error.textContent) throw new Error(file.error.textContent);
        inputs.push({ name: file.name, bytes: await read(file) });
      }
      const bytes = await mergePdfs(inputs);
      let target = await tauri.core.invoke('test_merge_target');
      if (target === null) {
        const first = list[0].path;
        const defaultPath = first ? await tauri.path.join(await tauri.path.dirname(first), 'merged.pdf') : 'merged.pdf';
        target = await tauri.dialog.save({ defaultPath, filters });
      }
      status.textContent = '';
      if (!target) return;
      // shortcut: compare known paths, use filesystem identity if alias detection is needed.
      const pathKey = async (path) => (await tauri.path.normalize(path)).replaceAll('/', '\\').toLowerCase();
      const targetKey = await pathKey(target);
      for (const file of list) {
        if (file.path && await pathKey(file.path) === targetKey) {
          throw new Error(`Choose a different save location. ${file.name} is an input PDF.`);
        }
      }
      await tauri.fs.writeFile(target, bytes);
      close();
      openResult(target);
    } catch (error) {
      status.textContent = error?.message || String(error);
      if (error?.fileIndex !== undefined) list[error.fileIndex].error.textContent = error.message;
    } finally {
      busy = false;
      updateControls();
      if (dialog.open) mergeButton.focus();
    }
  }

  return { open, drop };
}

import {
  addFiles, clearFiles, displacedFiles, expandPages, loadMergePdf, mergePdfs, moveDown, moveFile,
  moveUp, pageRange, pagesByFile, removeFile, replacePageRange, rotatePage, setFilePages, sortFiles,
} from './merge.js';

import { OPEN_EXTS, NO_PDF_PART, isAi, hasPdfHeader } from './ai-file.js';

const filters = [{ name: 'PDF or AI', extensions: OPEN_EXTS }];
export const saveFilters = [{ name: 'PDF', extensions: ['pdf'] }]; // the merged file is always a .pdf
const el = (tag, text = '') => Object.assign(document.createElement(tag), { textContent: text });
const button = (text, run) => Object.assign(el('button', text), { type: 'button', onclick: run });

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function clearThumb(thumb) {
  const { job } = thumb;
  if (!job) return;
  thumb.job = null;
  job.render?.cancel();
  if (job.canvas) job.canvas.width = job.canvas.height = 0;
  thumb.box.replaceChildren();
}

async function paintThumb(thumb) {
  const { file, pageIndex, rotate, box } = thumb;
  const job = {};
  thumb.job = job;
  try {
    const page = await file.pdf.getPage(pageIndex + 1);
    if (thumb.job !== job) return;
    const rotation = (page.rotate + rotate) % 360;
    const { width, height } = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: Math.min(72 / width, 88 / height), rotation });
    const canvas = job.canvas = el('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    job.render = page.render({ canvasContext: canvas.getContext('2d'), viewport });
    await job.render.promise;
    job.render = null;
    if (thumb.job === job) box.replaceChildren(canvas);
  } catch {
    if (thumb.job === job) box.textContent = 'Preview unavailable';
  } finally {
    if (thumb.job !== job && job.canvas) job.canvas.width = job.canvas.height = 0;
  }
}

function checkbox(text) {
  const label = el('label');
  const input = Object.assign(el('input'), { type: 'checkbox', checked: true });
  label.append(input, document.createTextNode(text));
  return { label, input };
}

export function createMergeWindow({ tauri, fromPath, fromFile, openResult }) {
  const style = Object.assign(el('link'), { rel: 'stylesheet', href: new URL('./merge.css', import.meta.url).href });
  document.head.append(style);

  let list = clearFiles(), pages = [], pageMode = false, busy = false, dragged = null, color = 0;
  let displaced = new Set();
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
  const views = el('div');
  views.className = 'merge-views';
  views.setAttribute('role', 'group');
  views.setAttribute('aria-label', 'Merge view');
  const filesView = button('Files', () => setView(false));
  const pagesView = button('Pages', () => setView(true));
  views.append(filesView, pagesView);
  toolbar.append(pickButton, clearButton, az, za, views);

  const customOrder = el('div', 'Custom page order (set in Pages)');
  customOrder.className = 'merge-order';
  const reset = button('Reset page order', () => setPages(inFileOrder()));
  customOrder.append(reset);

  const hint = el('p', 'Drop PDF or AI files here');
  hint.className = 'merge-hint';
  const cards = el('ol');
  cards.setAttribute('aria-label', 'PDFs in merge order');
  const grid = el('ol');
  grid.className = 'merge-pages';
  grid.setAttribute('aria-label', 'Pages in merge order');
  const options = el('div');
  options.className = 'merge-options';
  const perFile = checkbox('Bookmark per file');
  const keep = checkbox("Keep files' bookmarks");
  options.append(perFile.label, keep.label);
  const status = el('p');
  status.setAttribute('role', 'status');
  const mergeButton = button('Merge', save);
  mergeButton.className = 'acc';
  const footer = el('footer');
  footer.append(status, mergeButton);
  dialog.append(header, toolbar, customOrder, hint, cards, grid, options, footer);
  document.body.append(dialog);

  const tiles = new Map(), thumbs = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const thumb = thumbs.get(target);
      if (!thumb) continue;
      if (!isIntersecting) clearThumb(thumb);
      else if (!thumb.job) paintThumb(thumb);
    }
  }, { root: dialog });

  function observeThumb(thumb) {
    thumbs.set(thumb.box, thumb);
    observer.observe(thumb.box);
  }

  function releaseThumb(box) {
    const thumb = thumbs.get(box);
    if (thumb) clearThumb(thumb);
    observer.unobserve(box);
    thumbs.delete(box);
  }

  function updateControls() {
    closeButton.disabled = busy;
    pickButton.disabled = busy || !tauri;
    clearButton.disabled = busy || !list.length;
    az.disabled = za.disabled = busy || pageMode || displaced.size > 0 || list.length < 2;
    az.hidden = za.hidden = pageMode;
    mergeButton.disabled = busy || !tauri || list.length < 2 || list.some((file) => file.loading) || !pages.length;
    filesView.disabled = pagesView.disabled = perFile.input.disabled = keep.input.disabled = busy;
    filesView.setAttribute('aria-pressed', String(!pageMode));
    pagesView.setAttribute('aria-pressed', String(pageMode));
    cards.hidden = pageMode;
    grid.hidden = !pageMode;
    customOrder.hidden = pageMode || !displaced.size;
    reset.disabled = busy;
    hint.hidden = Boolean(list.length);
    for (const [i, file] of list.entries()) {
      file.up.disabled = busy || displaced.size > 0 || i === 0;
      file.down.disabled = busy || displaced.size > 0 || i === list.length - 1;
      file.range.disabled = busy || !file.pdf || displaced.has(file);
      file.remove.disabled = busy;
      file.card.draggable = !busy && !displaced.size;
    }
    for (const { card, rotate, remove } of tiles.values()) {
      card.draggable = !busy;
      rotate.disabled = remove.disabled = busy;
    }
  }

  function inFileOrder() {
    const groups = pagesByFile(pages);
    return list.flatMap((file) => groups.get(file) ?? []);
  }

  function setPages(next) {
    pages = next;
    displaced = displacedFiles(list, pages);
    const groups = pagesByFile(pages);
    for (const file of list) {
      const range = pageRange(groups.get(file) ?? []);
      if (file.range.defaultValue !== range) {
        file.range.defaultValue = range;
        file.range.value = range;
      }
    }
    const shown = pageMode ? pages : [];
    const visible = new Set(shown);
    for (const [page, { box }] of tiles) {
      if (visible.has(page)) continue;
      releaseThumb(box);
      tiles.delete(page);
    }
    const scrollTop = grid.scrollTop;
    grid.replaceChildren(...shown.map((page) => tiles.get(page)?.card ?? makeTile(page)));
    grid.scrollTop = scrollTop;
    status.textContent = '';
    updateControls();
  }

  function setView(next) {
    if (next === pageMode) return;
    pageMode = next;
    setPages(pages);
  }

  function setList(next) {
    const kept = new Set(next);
    for (const file of list) {
      if (kept.has(file)) continue;
      releaseThumb(file.thumb);
      file.task?.destroy().catch(console.warn);
    }
    list = next;
    const scrollTop = cards.scrollTop;
    cards.replaceChildren(...list.map((file) => file.card));
    cards.scrollTop = scrollTop;
    setPages(displaced.size ? pages.filter(({ file }) => kept.has(file)) : inFileOrder());
  }

  function startDrag(event, item, label) {
    dragged = item;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', label);
  }

  function makeTile(page) {
    const label = `${page.file.name} p${page.pageIndex + 1}`;
    const card = el('li'), box = el('div'), caption = el('span', label), actions = el('div');
    card.tabIndex = 0;
    card.setAttribute('aria-label', label);
    card.style.borderTopColor = page.file.color;
    box.className = 'merge-thumb';
    box.setAttribute('aria-hidden', 'true');
    caption.className = 'merge-page-label';
    caption.title = label;
    actions.className = 'merge-actions';
    const remove = button('×', () => edit('Delete'));
    const rotate = button('↻', () => edit('r'));
    for (const [control, action] of [[remove, 'Remove'], [rotate, 'Rotate 90°']]) {
      control.title = action;
      control.setAttribute('aria-label', `${action} ${label}`);
    }
    function edit(key) {
      if (busy) return;
      const i = pages.indexOf(page);
      if (key === 'Delete') setPages(removeFile(pages, i));
      else if (key === 'r') setPages(rotatePage(pages, i));
      else {
        const to = i + (key === 'ArrowLeft' ? -1 : 1);
        const next = moveFile(pages, i, to);
        if (next === pages) return;
        setPages(next);
        grid.children[to].focus();
        return;
      }
      (grid.children[Math.min(i, pages.length - 1)] ?? pagesView).focus();
    }
    card.onkeydown = (event) => {
      const key = event.key.toLowerCase() === 'r' ? 'r' : event.key;
      if (event.ctrlKey ? key !== 'ArrowLeft' && key !== 'ArrowRight' : key !== 'Delete' && key !== 'r') return;
      event.preventDefault();
      edit(key);
    };
    card.ondragstart = (event) => startDrag(event, page, label);
    card.ondragend = () => { dragged = null; };
    actions.append(rotate, remove);
    card.append(box, caption, actions);
    tiles.set(page, { card, box, rotate, remove });
    observeThumb({ ...page, box });
    return card;
  }

  async function load(file) {
    try {
      const bytes = await file.read();
      if (!list.includes(file)) return;
      if (isAi(file.name) && !hasPdfHeader(bytes)) { // no task: the merge refuses the file with this text
        file.error.textContent = `${file.name}: ${NO_PDF_PART}`;
        file.info.textContent = '';
        return;
      }
      file.info.textContent = sizeLabel(bytes.byteLength);
      const task = file.task = await loadMergePdf(bytes);
      if (!list.includes(file)) {
        task.promise.catch(() => {});
        await task.destroy();
        return;
      }
      const pdf = await task.promise;
      if (!list.includes(file)) return;
      file.pdf = pdf;
      file.pageCount = pdf.numPages;
      file.info.textContent += ` · ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
      observeThumb({ file, pageIndex: 0, rotate: 0, box: file.thumb });
      setPages(setFilePages(list, pages, file, expandPages([file])));
    } catch (error) {
      if (!list.includes(file)) return;
      const reason = !file.task ? 'could not read file'
        : error?.name === 'PasswordException' ? 'password-protected PDF' : 'invalid or damaged PDF';
      file.error.textContent = `${file.name}: ${reason}.`;
      if (!file.task) file.info.textContent = '';
    } finally {
      file.loading = false;
      updateControls();
    }
  }

  function makeCard(item) {
    const file = {
      ...item, card: el('li'), thumb: el('div'), info: el('div', 'Reading…'), error: el('div'),
      range: el('input'), loading: true, color: `hsl(${(color++ * 137.5) % 360} 62% 53%)`,
    };
    file.thumb.className = 'merge-thumb';
    file.thumb.setAttribute('aria-hidden', 'true');
    file.info.className = 'merge-info';
    file.error.className = 'merge-error';
    const name = el('strong', file.name), description = el('div'), actions = el('div');
    description.className = 'merge-description';
    const rangeLabel = el('label', 'Pages');
    rangeLabel.className = 'merge-range';
    file.range.placeholder = 'None';
    file.range.setAttribute('aria-label', `Page range for ${file.name}`);
    file.range.onkeydown = (event) => {
      if (event.key === 'Enter') file.range.blur();
    };
    file.range.onchange = () => {
      const range = file.range.value;
      try {
        if (!file.range.disabled) setPages(replacePageRange(list, pages, file, range));
      } catch (error) {
        status.textContent = error.message;
      }
      file.range.value = file.range.defaultValue;
    };
    rangeLabel.append(file.range);
    description.append(name, file.info, rangeLabel, file.error);
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
    file.card.ondragstart = (event) => startDrag(event, file, file.name);
    file.card.ondragend = () => { dragged = null; };
    return file;
  }

  function add(items) {
    const pdfs = items.filter(({ name }) => /\.(pdf|ai)$/i.test(name));
    if (pdfs.length) {
      const added = pdfs.map(makeCard);
      setList(addFiles(list, added));
      for (const file of added) load(file);
    }
    if (pdfs.length !== items.length) status.textContent = 'Only .pdf or .ai files can be added.';
  }

  function open(active) {
    if (dialog.open) return;
    pageMode = false;
    perFile.input.checked = keep.input.checked = true;
    color = 0;
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
    else if (!busy && pageMode && dragged) {
      const to = [...grid.children].indexOf(event.target.closest?.('.merge-pages > li'));
      const next = moveFile(pages, pages.indexOf(dragged), to);
      if (next !== pages) setPages(next);
    } else if (!busy && !displaced.size && dragged) {
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
  dialog.onkeydown = (event) => {
    event.stopPropagation();
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'p') event.preventDefault(); // no print from here, and not the app UI either
  };
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
      for (const file of list) {
        if (!file.pdf) throw new Error(file.error.textContent);
      }
      const bytes = await mergePdfs(pages, {
        bookmarkPerFile: perFile.input.checked, keepBookmarks: keep.input.checked,
      });
      let target = await tauri.core.invoke('test_merge_target');
      if (target === null) {
        const first = list[0].path;
        const defaultPath = first ? await tauri.path.join(await tauri.path.dirname(first), 'merged.pdf') : 'merged.pdf';
        target = await tauri.dialog.save({ defaultPath, filters: saveFilters });
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
      if (error?.file) error.file.error.textContent = error.message;
    } finally {
      busy = false;
      updateControls();
      if (dialog.open) mergeButton.focus();
    }
  }

  return { open, drop };
}

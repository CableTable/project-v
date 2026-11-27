import {
  addFiles, clearFiles, expandPages, keepPicks, loadMergePdf, mergePdfs, moveFile, pageRange, pagesByFile, pagesToMerge,
  removeFile, replacePageRange, resetFiles, rotatePage, selectPicks, setFilePages, sortFiles, togglePick,
} from './merge.js';

import { NO_PDF_PART, isAi, hasPdfHeader } from './ai-file.js';

export const filters = [{ name: 'PDF or AI', extensions: ['pdf', 'ai'] }]; // not OPEN_EXTS: a TIFF cannot be merged (T13)
export const saveFilters = [{ name: 'PDF', extensions: ['pdf'] }]; // the merged file is always a .pdf
const el = (tag, text = '') => Object.assign(document.createElement(tag), { textContent: text });
const button = (text, run) => Object.assign(el('button', text), { type: 'button', onclick: run });
const ZOOM_ICON = 'M11 5a6 6 0 1 0 0 12a6 6 0 0 0 0-12z M20 20l-4.2-4.2 M8.5 11h5 M11 8.5v5';
const TRASH_ICON = 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v5 M14 11v5';
const MIN_ZOOM = 0.25, MAX_ZOOM = 4, BUTTON_ZOOM = 1.25, WHEEL_ZOOM = 1.1; // magnifier: 1 = the page fits the window
function iconButton(d, run) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  for (const [key, value] of [['class', 'ic'], ['viewBox', '0 0 24 24'], ['aria-hidden', 'true']]) svg.setAttribute(key, value);
  path.setAttribute('d', d);
  svg.append(path);
  const control = button('', run);
  control.append(svg);
  return control;
}

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
  const { file, pageIndex, rotate, box, size: [maxWidth, maxHeight] = [72, 88], dpr = 1 } = thumb;
  const job = {};
  thumb.job = job;
  try {
    const page = await file.pdf.getPage(pageIndex + 1);
    if (thumb.job !== job) return;
    const rotation = (page.rotate + rotate) % 360;
    const { width, height } = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: Math.min(maxWidth / width, maxHeight / height) * dpr, rotation });
    const canvas = job.canvas = el('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    if (dpr !== 1) Object.assign(canvas.style, { width: `${canvas.width / dpr}px`, height: `${canvas.height / dpr}px` });
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
  const input = Object.assign(el('input'), { type: 'checkbox', checked: false });
  label.append(input, document.createTextNode(text));
  return { label, input };
}

/** The Merge tab's page (vmerge-a): it lives as long as the app, `start()` empties it, `show()` follows the active tab. */
export function createMergeWindow({ tauri, fromPath, fromFile, openResult, askUser, host = document.body }) {
  const style = Object.assign(el('link'), { rel: 'stylesheet', href: new URL('./merge.css', import.meta.url).href });
  document.head.append(style);

  // `pages`: what whole files / range boxes give; `picks`: what page mode has picked, in pick order.
  let list = clearFiles(), pages = [], picks = [], pageMode = false, busy = false, dragged = null, count = 0, orderBefore = null;
  const view = el('section');
  view.id = 'merge-tab';
  view.hidden = true;
  view.setAttribute('aria-labelledby', 'merge-title');
  const title = el('h2', 'Merge PDFs');
  title.id = 'merge-title';

  const toolbar = el('div');
  toolbar.className = 'merge-toolbar';
  const pickButton = button('Add files', pick);
  const resetButton = button('Reset', () => {
    const next = resetFiles(list);
    ({ pages, picks } = next);
    setList(next.files);
  });
  resetButton.title = 'Keep the files: added order, all pages';
  const restartButton = button('Restart', async () => {
    if (list.length && !await askUser('Remove all files?', 'Remove all')) return;
    start();
    pickButton.focus();
  });
  restartButton.title = 'Remove all files';
  const az = button('Sort A–Z', () => setList(sortFiles(list)));
  const za = button('Sort Z–A', () => setList(sortFiles(list, true)));
  const mode = checkbox('Page mode');
  mode.label.className = 'merge-mode';
  mode.input.setAttribute('role', 'switch');
  mode.input.onchange = () => {
    pageMode = mode.input.checked;
    setPages(pages);
  };
  toolbar.append(pickButton, az, za, resetButton, restartButton, mode.label);

  const hint = el('p', 'Drop PDF or AI files here');
  hint.className = 'merge-hint';
  const cards = el('ol');
  cards.className = 'merge-files';
  cards.setAttribute('aria-label', 'PDFs in merge order');
  // The other cards shift while a card is dragged over them.
  cards.ondragover = (event) => {
    if (busy || !list.includes(dragged)) return;
    const to = list.findIndex(({ card }) => card.contains(event.target));
    const next = moveFile(list, list.indexOf(dragged), to);
    if (next !== list) setList(next);
  };
  const rows = el('div');
  rows.className = 'merge-rows';
  const order = el('div'), strip = el('ol');
  order.className = 'merge-order';
  strip.setAttribute('aria-label', 'Picked pages in merge order');
  order.append(el('h3', 'Correct the order of the pages if necessary'), strip);
  // As with the file cards: the other pages shift while one is dragged over them.
  strip.ondragover = (event) => {
    if (busy || !picks.includes(dragged)) return;
    const to = picks.findIndex((page) => stripItems.get(page).item.contains(event.target));
    const next = moveFile(picks, picks.indexOf(dragged), to);
    if (next !== picks) setPicks(next);
  };
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
  view.append(title, toolbar, hint, cards, rows, order, options, footer);
  host.append(view);

  const preview = el('dialog'), previewBox = el('div'), magnifierTools = el('span');
  preview.id = 'merge-preview';
  previewBox.className = 'merge-preview-page';
  const previewThumb = { box: previewBox };
  // The magnifier (page mode) is this dialog too: full window, zoom and rotate before Close.
  let zoom = 1, fit;
  for (const [text, label, run] of [
    ['−', 'Zoom out', () => zoomBy(1 / BUTTON_ZOOM)], ['+', 'Zoom in', () => zoomBy(BUTTON_ZOOM)],
    ['↺', 'Rotate left', () => turnMagnified(-1)], ['↻', 'Rotate right', () => turnMagnified(1)],
  ]) {
    const control = button(text, run);
    control.title = label;
    control.setAttribute('aria-label', label);
    magnifierTools.append(control);
  }
  const previewBar = el('div');
  previewBar.append(magnifierTools, button('Close', () => preview.close()));
  preview.append(previewBar, previewBox);
  preview.onclose = () => clearThumb(previewThumb);
  preview.onclick = (event) => { if (event.target === preview && magnifierTools.hidden) preview.close(); }; // not the full-window magnifier
  preview.addEventListener('wheel', (event) => {
    if (!event.ctrlKey) return;
    event.preventDefault(); // no page zoom of the whole window
    event.stopPropagation();
    if (!magnifierTools.hidden && event.deltaY) zoomBy(event.deltaY < 0 ? WHEEL_ZOOM : 1 / WHEEL_ZOOM);
  }, { passive: false });
  preview.onkeydown = (event) => {
    event.stopPropagation(); // no Ctrl+W / Ctrl+Tab under the box
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'p') event.preventDefault(); // else WebView2 prints the app UI
  };
  document.body.append(preview);

  function openDialog(label, magnifier) {
    clearThumb(previewThumb);
    preview.setAttribute('aria-label', label);
    preview.classList.toggle('merge-magnifier', magnifier);
    magnifierTools.hidden = !magnifier;
    preview.showModal();
  }

  function showPreview(file) {
    if (!file.pdf) return;
    openDialog(`Preview ${file.name}`, false);
    Object.assign(previewThumb, { file, pageIndex: 0, rotate: 0, size: [innerWidth - 96, innerHeight - 130], dpr: 1 });
    paintThumb(previewThumb);
  }

  function magnify(file, pageIndex) {
    openDialog(`Magnified ${file.name} p${pageIndex + 1}`, true);
    zoom = 1;
    fit = [previewBox.clientWidth - 8, previewBox.clientHeight - 8];
    Object.assign(previewThumb, { file, pageIndex, rotate: file.sheets[pageIndex].rotate, dpr: devicePixelRatio });
    paintMagnifier();
  }

  function paintMagnifier() {
    previewThumb.job?.render?.cancel(); // the old picture stays until the new one is drawn
    previewThumb.size = fit.map((side) => side * zoom);
    paintThumb(previewThumb);
  }

  function zoomBy(factor) {
    // shortcut: the whole page is drawn, so 4x the window at most (canvas memory); draw only the visible part for more
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * factor));
    if (next === zoom) return;
    zoom = next;
    paintMagnifier();
  }

  function turnMagnified(direction) {
    const { file, pageIndex } = previewThumb;
    turnPage(file, pageIndex, direction);
    previewThumb.rotate = file.sheets[pageIndex].rotate;
    paintMagnifier();
  }

  /** One rotation per page (`file.sheets`): its tile, strip tile, magnifier and the merged file. */
  function turnPage(file, pageIndex, direction) {
    if (busy) return;
    file.sheets = rotatePage(file.sheets, pageIndex, direction);
    status.textContent = '';
    updateControls();
  }

  function magnifyButton(file, pageIndex) {
    const control = iconButton(ZOOM_ICON, () => magnify(file, pageIndex));
    control.title = 'Magnify';
    control.setAttribute('aria-label', `Magnify ${file.name} p${pageIndex + 1}`);
    return control;
  }

  const thumbs = new Map();
  const observer = new IntersectionObserver((entries) => {
    for (const { target, isIntersecting } of entries) {
      const thumb = thumbs.get(target);
      if (!thumb) continue;
      if (!isIntersecting) clearThumb(thumb);
      else if (!thumb.job) paintThumb(thumb);
    }
  }, { root: view });

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
    pickButton.disabled = busy || !tauri;
    resetButton.disabled = busy || !list.length;
    restartButton.disabled = busy;
    az.disabled = za.disabled = busy || list.length < 2;
    mergeButton.textContent = !pageMode ? 'Merge' : !picks.length ? 'Choose pages'
      : `Merge PDF ${picks.length} ${picks.length === 1 ? 'page' : 'pages'}`;
    mergeButton.disabled = busy || !tauri || list.length < 2 || list.some((file) => file.loading)
      || !(pageMode ? picks : pages).length;
    mode.input.disabled = perFile.input.disabled = keep.input.disabled = busy;
    mode.input.checked = pageMode;
    view.classList.toggle('page-mode', pageMode);
    rows.hidden = !pageMode;
    hint.hidden = Boolean(list.length);
    const picked = pagesByFile(picks);
    for (const file of list) {
      file.zoom.disabled = !file.pdf;
      file.range.disabled = busy || !file.pdf;
      file.rangeLabel.hidden = pageMode;
      file.remove.disabled = busy;
      file.card.draggable = !busy;
      if (!file.row) continue;
      for (const control of file.tools) control.disabled = busy;
      const on = new Set(picked.get(file)?.map(({ pageIndex }) => pageIndex));
      for (const [i, { pick, rotate, magnifier, thumb }] of file.tiles.entries()) {
        pick.setAttribute('aria-pressed', String(on.has(i)));
        pick.disabled = rotate.disabled = magnifier.disabled = busy;
        if (thumb.rotate === file.sheets[i].rotate) continue; // turned by the button, or back by Reset
        thumb.rotate = file.sheets[i].rotate;
        repaint(thumb);
      }
    }
    showOrder();
  }

  const stripItems = new Map(); // pick -> its tile in the order strip

  function makeStripItem(page) {
    const { file, pageIndex } = page;
    const label = `${file.name} p${pageIndex + 1}`;
    const item = el('li'), box = el('div');
    item.tabIndex = 0;
    item.title = `${label}: drag, or Ctrl+Left / Ctrl+Right, to reorder`;
    item.setAttribute('aria-label', label);
    box.className = 'merge-thumb';
    box.setAttribute('aria-hidden', 'true');
    const remove = button('×', () => {
      const index = picks.indexOf(page);
      setPicks(togglePick(picks, file, pageIndex));
      (stripItems.get(picks[index] ?? picks.at(-1))?.remove ?? file.tiles[pageIndex].pick).focus();
    });
    remove.title = 'Un-pick';
    remove.setAttribute('aria-label', `Un-pick ${label}`);
    item.onkeydown = (event) => {
      if (event.target !== item || !event.ctrlKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      if (busy) return;
      const from = picks.indexOf(page);
      const next = moveFile(picks, from, from + (event.key === 'ArrowLeft' ? -1 : 1));
      if (next === picks) return;
      setPicks(next);
      item.focus();
    };
    item.ondragstart = (event) => {
      startDrag(event, page, label);
      orderBefore = picks;
    };
    item.ondragend = (event) => {
      if (event.dataTransfer.dropEffect === 'none' && orderBefore) setPicks(orderBefore); // a cancelled drag changes nothing
      dragged = orderBefore = null;
    };
    const magnifier = magnifyButton(file, pageIndex);
    item.append(remove, box, el('span', String(pageIndex + 1)), magnifier);
    const thumb = { file, pageIndex, rotate: file.sheets[pageIndex].rotate, box, size: [112, 112] };
    observeThumb(thumb);
    return { item, remove, magnifier, thumb };
  }

  /** The "correct the order" strip: the picked pages only, in pick order. */
  function showOrder() {
    const kept = new Set(picks);
    for (const [page, { item, thumb }] of stripItems) {
      if (kept.has(page)) continue;
      releaseThumb(thumb.box);
      item.remove();
      stripItems.delete(page);
    }
    const items = picks.map((page) => {
      if (!stripItems.has(page)) stripItems.set(page, makeStripItem(page));
      const { item, remove, magnifier, thumb } = stripItems.get(page);
      item.draggable = !busy;
      remove.disabled = magnifier.disabled = busy;
      if (thumb.rotate !== page.file.sheets[page.pageIndex].rotate) {
        thumb.rotate = page.file.sheets[page.pageIndex].rotate;
        repaint(thumb);
      }
      return item;
    });
    // only on a new order: re-inserting the tiles would drop the focus
    if (items.some((item, i) => strip.children[i] !== item)) strip.replaceChildren(...items);
    order.hidden = !pageMode || !picks.length;
  }

  function inFileOrder() {
    const groups = pagesByFile(pages);
    return list.flatMap((file) => groups.get(file) ?? []);
  }

  function setPages(next) {
    pages = next;
    const groups = pagesByFile(pages);
    for (const file of list) {
      const range = pageRange(groups.get(file) ?? []);
      if (file.range.defaultValue !== range) {
        file.range.defaultValue = range;
        file.range.value = range;
      }
    }
    if (pageMode) {
      const scrollTop = view.scrollTop;
      rows.replaceChildren(...list.filter((file) => file.pdf).map((file) => file.row ?? makeRow(file)));
      view.scrollTop = scrollTop;
    }
    status.textContent = '';
    updateControls();
  }

  function setPicks(next) {
    picks = next;
    status.textContent = '';
    updateControls();
  }

  function setList(next) {
    const kept = new Set(next);
    for (const file of list) {
      if (kept.has(file)) continue;
      releaseThumb(file.thumb);
      for (const { thumb } of file.tiles ?? []) releaseThumb(thumb.box);
      file.row?.remove();
      file.task?.destroy().catch(console.warn);
    }
    list = next;
    picks = keepPicks(picks, next);
    const scrollTop = cards.scrollTop;
    cards.replaceChildren(...list.map((file) => file.card));
    cards.scrollTop = scrollTop;
    setPages(inFileOrder());
  }

  function startDrag(event, item, label) {
    dragged = item;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', label);
  }

  function repaint(thumb) {
    clearThumb(thumb);
    observer.unobserve(thumb.box);
    observer.observe(thumb.box); // reports again: only a tile in view is painted
  }

  /** Page mode: one file's tools and its pages. */
  function makeRow(file) {
    const row = el('div'), bar = el('div'), strip = el('ol'), zoom = el('input');
    row.className = 'merge-row';
    row.setAttribute('role', 'group');
    row.setAttribute('aria-label', `Pages of ${file.name}`);
    row.style.setProperty('--thumb', '112px');
    bar.className = 'merge-row-bar';
    const name = el('span', file.name);
    name.title = file.name;
    file.tools = ['All', 'None', 'Invert', 'Odd', 'Even'].map((text) =>
      button(text, () => setPicks(selectPicks(picks, file, text.toLowerCase()))));
    Object.assign(zoom, { type: 'range', min: '64', max: '320', step: '16', value: '112' });
    zoom.setAttribute('aria-label', `Thumbnail zoom for ${file.name}`);
    zoom.oninput = () => row.style.setProperty('--thumb', `${zoom.value}px`);
    zoom.onchange = () => {
      for (const { thumb } of file.tiles) {
        thumb.size = [Number(zoom.value), Number(zoom.value)];
        repaint(thumb);
      }
    };
    file.tiles = file.sheets.map(({ pageIndex }) => {
      const label = `${file.name} p${pageIndex + 1}`;
      const item = el('li'), box = el('div');
      item.setAttribute('aria-label', label);
      box.className = 'merge-thumb';
      box.setAttribute('aria-hidden', 'true');
      const pick = button('', () => setPicks(togglePick(picks, file, pageIndex)));
      pick.className = 'merge-pick';
      pick.setAttribute('aria-label', `Pick ${label}`);
      pick.append(box, el('span', String(pageIndex + 1)));
      const turn = () => turnPage(file, pageIndex, 1);
      const rotate = button('↻', turn);
      rotate.title = 'Rotate 90° (R)';
      rotate.setAttribute('aria-label', `Rotate 90° ${label}`);
      item.onkeydown = (event) => {
        if (event.ctrlKey || event.altKey || event.metaKey || event.key.toLowerCase() !== 'r') return;
        event.preventDefault();
        turn();
      };
      const magnifier = magnifyButton(file, pageIndex), actions = el('div');
      actions.className = 'merge-actions';
      actions.append(rotate, magnifier);
      item.append(pick, actions);
      strip.append(item);
      const thumb = { file, pageIndex, rotate: file.sheets[pageIndex].rotate, box, size: [112, 112] };
      observeThumb(thumb);
      return { pick, rotate, magnifier, thumb };
    });
    bar.append(name, ...file.tools, zoom);
    file.tools.push(zoom); // disabled with them while busy
    row.append(bar, strip);
    return file.row = row;
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
      file.sheets = expandPages([file]); // each page's rotation
      file.info.textContent += ` · ${pdf.numPages} ${pdf.numPages === 1 ? 'page' : 'pages'}`;
      observeThumb({ file, pageIndex: 0, rotate: 0, box: file.thumb, size: [144, 168] });
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
    const added = count++;
    const file = {
      ...item, added, card: el('li'), thumb: el('div'), info: el('div', 'Reading…'), error: el('div'),
      range: el('input'), loading: true, color: `hsl(${(added * 137.5) % 360} 62% 53%)`,
    };
    file.thumb.className = 'merge-thumb';
    file.thumb.setAttribute('aria-hidden', 'true');
    file.info.className = 'merge-info';
    file.error.className = 'merge-error';
    const name = el('strong', file.name), actions = el('div');
    name.title = file.name;
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
    file.rangeLabel = rangeLabel;
    actions.className = 'merge-actions';
    file.zoom = iconButton(ZOOM_ICON, () => showPreview(file));
    file.remove = iconButton(TRASH_ICON, () => {
      const index = list.indexOf(file);
      setList(removeFile(list, index));
      (list[index]?.remove ?? list.at(-1)?.remove ?? pickButton).focus();
    });
    for (const [control, label] of [[file.zoom, 'Preview'], [file.remove, 'Remove']]) {
      control.title = label;
      control.setAttribute('aria-label', `${label} ${file.name}`);
    }
    actions.append(file.zoom, file.remove);
    file.card.tabIndex = 0;
    file.card.title = 'Drag, or Ctrl+Left / Ctrl+Right, to reorder';
    file.card.setAttribute('aria-label', file.name);
    file.card.append(actions, file.thumb, name, file.info, rangeLabel, file.error);
    file.card.onkeydown = (event) => {
      // only on the card itself: Ctrl+arrows in the range box move by words
      if (event.target !== file.card || !event.ctrlKey || (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')) return;
      event.preventDefault();
      if (busy) return;
      const from = list.indexOf(file);
      const next = moveFile(list, from, from + (event.key === 'ArrowLeft' ? -1 : 1));
      if (next === list) return;
      setList(next);
      file.card.focus();
    };
    file.card.ondragstart = (event) => {
      startDrag(event, file, file.name);
      orderBefore = list;
    };
    file.card.ondragend = (event) => {
      if (event.dataTransfer.dropEffect === 'none' && orderBefore) setList(orderBefore); // a cancelled drag changes nothing
      dragged = orderBefore = null;
    };
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

  /** Empty, file view, bookmarks off: a new Merge tab, Restart, and a closed tab (frees its files). */
  function start() {
    preview.close();
    pageMode = false;
    perFile.input.checked = keep.input.checked = false;
    count = 0;
    dragged = orderBefore = null;
    setList(clearFiles());
  }

  function drop(event) {
    if (view.hidden) return false;
    if (!busy && event.dataTransfer.files.length) add([...event.dataTransfer.files].map(fromFile));
    dragged = null; // a file card has already moved (cards.ondragover)
    return true;
  }

  view.ondragover = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : dragged ? 'move' : 'copy';
  };
  view.addEventListener('wheel', (event) => {
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
      const bytes = await mergePdfs(pagesToMerge(pageMode, pages, picks), {
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
      openResult(target); // the Merge tab stays as it is
    } catch (error) {
      status.textContent = error?.message || String(error);
      if (error?.file) error.file.error.textContent = error.message;
    } finally {
      busy = false;
      updateControls();
      if (!view.hidden) mergeButton.focus();
    }
  }

  return {
    start, drop,
    show: (on) => {
      view.hidden = !on;
      if (!on) preview.close(); // a file opened from outside switches the tab: no box left over it
    },
    focus: () => pickButton.focus(),
    hasFiles: () => list.length > 0,
    busy: () => busy,
  };
}

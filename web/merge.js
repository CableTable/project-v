export const clearFiles = () => [];
export const addFiles = (list, files) => [...list, ...files];
export const removeFile = (list, index) => list.filter((_, i) => i !== index);

const hasIndex = (list, index) => Number.isInteger(index) && index >= 0 && index < list.length;

export function moveFile(list, from, to) {
  if (from === to || !hasIndex(list, from) || !hasIndex(list, to)) return list;
  const next = [...list];
  const [file] = next.splice(from, 1);
  next.splice(to, 0, file);
  return next;
}

export const moveUp = (list, index) => moveFile(list, index, index - 1);
export const moveDown = (list, index) => moveFile(list, index, index + 1);

export function sortFiles(list, descending = false) {
  const direction = descending ? -1 : 1;
  return [...list].sort((a, b) => direction * a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

export const expandPages = (files) => files.flatMap((file) =>
  Array.from({ length: file.pageCount }, (_, pageIndex) => ({ file, pageIndex, rotate: 0 })));

/** Reset: the files back in the order they were added (`added`), every page in again, unrotated, nothing picked. */
export function resetFiles(list) {
  const files = [...list].sort((a, b) => a.added - b.added);
  return { files, pages: expandPages(files), picks: [] };
}

// Page mode picks: { file, pageIndex } in the order they were picked.
export function togglePick(picks, file, pageIndex) {
  const next = picks.filter((page) => page.file !== file || page.pageIndex !== pageIndex);
  return next.length < picks.length ? next : [...picks, { file, pageIndex }];
}

/** A removed file's pages leave the order strip. */
export const keepPicks = (picks, files) => picks.filter(({ file }) => files.includes(file));

const PICK_TOOLS = {
  all: () => true, none: () => false, invert: (i, on) => !on, odd: (i) => i % 2 === 0, even: (i) => i % 2 === 1,
};

/** One file's row tool: a page that stays picked keeps its place, a new one goes to the end in page order. */
export function selectPicks(picks, file, tool) {
  const on = new Set(picks.filter((page) => page.file === file).map((page) => page.pageIndex));
  const want = new Set(Array.from({ length: file.pageCount }, (_, i) => i).filter((i) => PICK_TOOLS[tool](i, on.has(i))));
  return [
    ...picks.filter((page) => page.file !== file || want.has(page.pageIndex)),
    ...[...want].filter((i) => !on.has(i)).map((pageIndex) => ({ file, pageIndex })),
  ];
}

/** What Merge writes: the picks in page mode, else the files' pages; a page's rotation (`file.sheets`) holds in both. */
export const pagesToMerge = (pageMode, pages, picks) => (pageMode ? picks : pages)
  .map(({ file, pageIndex }) => ({ file, pageIndex, rotate: file.sheets?.[pageIndex]?.rotate ?? 0 }));

export const rotatePage = (pages, index) => hasIndex(pages, index)
  ? pages.map((page, i) => i === index ? { ...page, rotate: (page.rotate + 90) % 360 } : page)
  : pages;

export function pagesByFile(pages) {
  const groups = new Map();
  for (const page of pages) {
    if (!groups.has(page.file)) groups.set(page.file, []);
    groups.get(page.file).push(page);
  }
  return groups;
}

export function pageRange(pages) {
  const ranges = [];
  for (const { pageIndex } of pages) {
    const last = ranges.at(-1);
    if (last && last[1] + 1 === pageIndex) last[1] = pageIndex;
    else ranges.push([pageIndex, pageIndex]);
  }
  return ranges.map(([start, end]) => start === end ? start + 1 : `${start + 1}-${end + 1}`).join(', ');
}

export function setFilePages(files, pages, file, replacement) {
  const later = new Set(files.slice(files.indexOf(file) + 1));
  const count = pages.filter((page) => page.file === file).length;
  let start = pages.findIndex((page) => page.file === file);
  if (start < 0) start = pages.findIndex((page) => later.has(page.file));
  if (start < 0) start = pages.length;
  return [...pages.slice(0, start), ...replacement, ...pages.slice(start + count)];
}

export function replacePageRange(files, pages, file, range) {
  const indices = new Set();
  for (const part of range.trim() ? range.split(',') : []) {
    const match = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part.trim());
    const first = Number(match?.[1]), last = Number(match?.[2] ?? first);
    if (!match || first < 1 || last < first || last > file.pageCount) {
      throw new Error(`Use page numbers from 1 to ${file.pageCount}, e.g. 1, 3-5.`);
    }
    for (let n = first; n <= last; n++) {
      if (indices.has(n - 1)) throw new Error('Enter each page only once.');
      indices.add(n - 1);
    }
  }
  const old = new Map(pages.filter((page) => page.file === file).map((page) => [page.pageIndex, page]));
  const replacement = [...indices].map((pageIndex) => old.get(pageIndex) ?? { file, pageIndex, rotate: 0 });
  return setFilePages(files, pages, file, replacement);
}

export async function loadMergePdf(data) {
  const pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs.getDocument({ data, stopAtErrors: true });
}

async function sourceBookmarks(file, targets) {
  const task = file.pdf ? null : await loadMergePdf(file.bytes.slice());
  try {
    const pdf = file.pdf ?? await task.promise;
    async function resolve(items) {
      const bookmarks = [];
      for (const { title, dest, items: children } of items) {
        const kept = await resolve(children);
        let target;
        // shortcut: omit non-page actions, support them if action preservation is requested.
        try {
          const destination = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
          const ref = destination?.[0];
          if (ref != null) target = targets.get(Number.isInteger(ref) ? ref : await pdf.getPageIndex(ref));
        } catch { /* A broken destination has no kept page. */ }
        if (target) bookmarks.push({ title, target, children: kept });
        else bookmarks.push(...kept);
      }
      return bookmarks;
    }
    return await resolve(await pdf.getOutline() ?? []);
  } finally {
    await task?.destroy();
  }
}

function writeOutlines(merged, bookmarks, { PDFName, PDFHexString }) {
  if (!bookmarks.length) return;
  const { context } = merged;
  const root = context.obj({ Type: 'Outlines' });
  const rootRef = context.register(root);
  function writeChildren(parent, parentRef, items) {
    const nodes = items.map(({ title, target }) => {
      const dict = context.obj({ Title: PDFHexString.fromText(title), Parent: parentRef, Dest: [target, 'Fit'] });
      return { dict, ref: context.register(dict) };
    });
    parent.set(PDFName.of('First'), nodes[0].ref);
    parent.set(PDFName.of('Last'), nodes.at(-1).ref);
    let count = nodes.length;
    for (const [i, { dict, ref }] of nodes.entries()) {
      if (i > 0) dict.set(PDFName.of('Prev'), nodes[i - 1].ref);
      if (i + 1 < nodes.length) dict.set(PDFName.of('Next'), nodes[i + 1].ref);
      if (items[i].children.length) count += writeChildren(dict, ref, items[i].children);
    }
    parent.set(PDFName.of('Count'), context.obj(count));
    return count;
  }
  writeChildren(root, rootRef, bookmarks);
  merged.catalog.set(PDFName.of('Outlines'), rootRef);
}

/** Pages are in output order; each file provides its name and bytes or an open pdf.js document. */
export async function mergePdfs(pages, { bookmarkPerFile = true, keepBookmarks = true } = {}) {
  if (!pages.length) throw new Error('Add at least one PDF page to merge.');
  const pdfLib = await import('./vendor/pdf-lib/pdf-lib.esm.min.mjs');
  const { PDFDocument, degrees } = pdfLib;
  const merged = await PDFDocument.create();
  const copies = new Map(), bookmarks = [];
  for (const [file, group] of pagesByFile(pages)) {
    try {
      const bytes = file.bytes ?? await file.pdf.getData();
      const source = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
      const copied = await merged.copyPages(source, group.map(({ pageIndex }) => pageIndex));
      const targets = new Map();
      for (const [i, page] of group.entries()) {
        const copy = copied[i];
        if (page.rotate) copy.setRotation(degrees((copy.getRotation().angle + page.rotate) % 360));
        copies.set(page, copy);
        if (!targets.has(page.pageIndex)) targets.set(page.pageIndex, copy.ref);
      }
      const children = keepBookmarks ? await sourceBookmarks(file, targets) : [];
      if (bookmarkPerFile) bookmarks.push({ title: file.name.replace(/\.(pdf|ai)$/i, ''), target: copied[0].ref, children });
      else bookmarks.push(...children);
    } catch (cause) {
      // pdf-lib 1.17.1 emits a plain Error for encrypted documents.
      const encrypted = cause?.message?.startsWith('Input document to `PDFDocument.load` is encrypted.');
      const message = encrypted ? 'password-protected PDF' : 'invalid or damaged PDF';
      throw Object.assign(new Error(`${file.name}: ${message}.`, { cause }), { file });
    }
  }
  for (const page of pages) merged.addPage(copies.get(page));
  writeOutlines(merged, bookmarks, pdfLib);
  return merged.save();
}

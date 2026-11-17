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

/** Each input is { name, bytes }, in the order its pages should appear. */
export async function mergePdfs(list) {
  if (!list.length) throw new Error('Add at least one PDF to merge.');
  const { PDFDocument } = await import('./vendor/pdf-lib/pdf-lib.esm.min.mjs');
  const merged = await PDFDocument.create();
  for (const [fileIndex, { name, bytes }] of list.entries()) {
    try {
      const source = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
      const indices = source.getPageIndices();
      if (!indices.length) throw new Error('The PDF has no pages.');
      const pages = await merged.copyPages(source, indices);
      for (const page of pages) merged.addPage(page);
    } catch (cause) {
      // pdf-lib 1.17.1 emits a plain Error for encrypted documents.
      const encrypted = cause?.message?.startsWith('Input document to `PDFDocument.load` is encrypted.');
      const message = encrypted ? 'password-protected PDF' : 'invalid or damaged PDF';
      throw Object.assign(new Error(`${name}: ${message}.`, { cause }), { fileIndex });
    }
  }
  return merged.save();
}

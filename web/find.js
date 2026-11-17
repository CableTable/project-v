export const itemText = ({ str, hasEOL }) => str + (hasEOL ? ' ' : '');
export const pageText = (items) => items.filter((item) => typeof item.str === 'string').map(itemText).join('');

/** Literal, case-insensitive matches. Indices are UTF-16 offsets into the original page strings. */
export function findHits(pages, query) {
  if (!query) return [];
  const pattern = new RegExp(query.replace(/[.*+?^\${}()|[\]\\]/g, '\\$&'), 'giu');
  return pages.flatMap((text, page) => Array.from(text.matchAll(pattern),
    (match) => ({ page, index: match.index, length: match[0].length })));
}

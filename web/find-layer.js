import { itemText } from './find.js';

/** Match the offsets in pageText to text nodes positioned by pdf.js. */
export function textNodes(items, divs) {
  let offset = 0, i = 0;
  const nodes = [];
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const node = divs[i++]?.firstChild;
    if (node) nodes.push({ node, start: offset, end: offset + item.str.length });
    offset += itemText(item).length;
  }
  return nodes;
}

export function rangesForHits(nodes, hits) {
  let i = 0;
  return hits.map((hit) => {
    const ranges = [], end = hit.index + hit.length;
    while (i < nodes.length && nodes[i].end <= hit.index) i++;
    for (let j = i; j < nodes.length && nodes[j].start < end; j++) {
      const { node, start, end: nodeEnd } = nodes[j], range = document.createRange();
      range.setStart(node, Math.max(0, hit.index - start));
      range.setEnd(node, Math.min(end, nodeEnd) - start);
      ranges.push(range);
    }
    return ranges;
  });
}

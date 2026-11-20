// text-select.js — T17: what a press on the page view does, and the plain text Ctrl+C copies.

/** A left press at (x, y): 'select' on a text span or in the gap between two spans of one line, else 'pan'. rects: the pressed page's span boxes. */
export function pressAction(x, y, rects) {
  let left = false, right = false;
  for (const r of rects) {
    if (y < r.top || y > r.bottom) continue;
    if (x >= r.left && x <= r.right) return 'select';
    if (r.right < x) left = true; else right = true;
  }
  return left && right ? 'select' : 'pan';
}

/** pages: per page in order, its pdf.js string items with sel = [start, end] of the selected part or null.
 *  A line end (hasEOL) is "\n" when the selection runs through it, a page end is "\n" (Find's pageText uses a space: not this). */
export function selectedText(pages) {
  return pages.map((items) => {
    let text = '', open = false;
    for (const { str, hasEOL, sel } of items) {
      if (str) {
        open = !!sel && sel[1] === str.length;
        if (sel) text += str.slice(sel[0], sel[1]);
      }
      if (hasEOL && open) text += '\n';
    }
    return text.replace(/\n$/, '');
  }).filter(Boolean).join('\n');
}

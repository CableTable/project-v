export const THUMB_W = 96;

export function buildPageLists(doc, goTo, observe, dom = document) {
  const el = (tag, cls) => Object.assign(dom.createElement(tag), { className: cls });
  const slots = doc.pages.map((_, i) => { const d = el('div', 'pg'); d.dataset.i = i; return d; });
  const thumbEls = doc.pages.map((p, i) => {
    const b = el('button', 'th'), box = el('span', 'tp'), n = el('span', 'tn');
    box.dataset.i = i;
    box.style.height = (THUMB_W * p.h) / p.w + 'px';
    n.textContent = i + 1;
    b.append(box, n);
    b.onclick = () => goTo(i);
    observe(box);
    return b;
  });
  return { slots, thumbEls };
}

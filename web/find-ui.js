import { findHits, pageText } from './find.js';
import { revealFindHit } from './viewer.js';

const $ = (id) => document.getElementById(id);
const input = $('find-query'), bar = $('find-bar'), toggle = $('find');
const prev = $('find-prev'), next = $('find-next');
let active = null;

export function showFind(doc) {
  if (active !== doc) {
    active = doc;
    input.value = active?.find.query ?? '';
  }
  toggle.disabled = !active;
  render();
}

function render() {
  const find = active?.find, result = find?.result;
  bar.hidden = !find?.open;
  toggle.setAttribute('aria-expanded', !bar.hidden);
  prev.disabled = next.disabled = !result?.hits.length;
  $('find-status').textContent = result?.hits.length
    ? result.index + 1 + ' of ' + result.hits.length
    : result?.message ?? '';
}

async function readPages(doc) {
  const texts = [];
  for (let n = 1; n <= doc.pdf.numPages && !doc.closed; n++) {
    const page = await doc.pdf.getPage(n);
    texts.push(pageText((await page.getTextContent()).items));
  }
  return texts;
}

async function search(doc) {
  const { find } = doc, query = find.query;
  const result = find.result = { hits: [], byPage: new Map(), index: -1, message: 'Searching…' };
  render();
  revealFindHit(null);
  try {
    const texts = await (find.texts ??= readPages(doc));
    if (doc.closed || find.result !== result) return;
    result.hits = findHits(texts, query);
    for (const hit of result.hits) {
      if (!result.byPage.has(hit.page)) result.byPage.set(hit.page, []);
      result.byPage.get(hit.page).push(hit);
    }
    result.index = result.hits.length ? 0 : -1;
    result.message = texts.some((text) => text.trim())
      ? (query ? '0 of 0' : '')
      : 'No text in this PDF (scanned?)';
  } catch (error) {
    if (doc.closed || find.result !== result) return;
    console.warn('Search PDF', error);
    result.message = 'Could not read text in this PDF';
  }
  const hit = result.hits[result.index] ?? null;
  if (active === doc) {
    render();
    revealFindHit(find.open ? hit : null);
  } else if (find.open) find.reveal = hit;
}

function open() {
  if (!active) return;
  active.find.open = true;
  render();
  input.focus();
  input.select();
  const result = active.find.result;
  if (result) revealFindHit(result.hits[result.index] ?? null);
  else search(active);
}

function close() {
  active.find.open = false;
  render();
  revealFindHit(null);
  $('view').focus({ preventScroll: true });
}

function move(dir) {
  const result = active?.find.result;
  if (!result?.hits.length) return;
  result.index = (result.index + dir + result.hits.length) % result.hits.length;
  render();
  revealFindHit(result.hits[result.index]);
}

toggle.onclick = open;
$('find-close').onclick = close;
prev.onclick = () => move(-1);
next.onclick = () => move(1);
input.oninput = () => { active.find.query = input.value; search(active); };
input.onkeydown = (e) => {
  if (e.key === 'Enter' && !e.isComposing) {
    e.preventDefault();
    move(e.shiftKey ? -1 : 1);
  }
};
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey && !e.altKey && e.key.toLowerCase() === 'f') {
    e.preventDefault();
    if (!e.target.closest?.('dialog[open]')) open();
  }
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && active?.find.open && !e.isComposing) {
    e.preventDefault();
    close();
  }
});

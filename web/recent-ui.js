import { addRecent, removeRecent } from './recent.js';

const key = 'project-v.recent';

export function createRecentFiles({ tauri, open, say }) {
  const menu = document.getElementById('file-menu');
  const summary = menu.querySelector('summary');
  const lists = ['start-recent', 'menu-recent'].map((id) => document.getElementById(id));
  const nameOf = (path) => path.split(/[\\/]/).pop();
  const exists = (path) => tauri.core.invoke('reopen_path', { path });
  let paths = [];
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (Array.isArray(saved)) paths = saved.filter((p) => typeof p === 'string' && p).reduceRight(addRecent, []);
  } catch (error) { console.warn('Read recent files', error); }

  function save(next) {
    paths = next;
    try { localStorage.setItem(key, JSON.stringify(paths)); }
    catch (error) { console.warn('Save recent files', error); }
    render();
  }

  function render() {
    const checks = paths.map((path) => tauri
      ? exists(path).catch((error) => console.warn('Check recent file', error))
      : Promise.resolve());
    for (const list of lists) {
      if (paths.length) {
        list.replaceChildren(...paths.map((path, i) => makeRow(list, path, checks[i])));
        continue;
      }
      const empty = document.createElement('div');
      empty.className = 'rr';
      empty.textContent = 'No recent files yet';
      list.replaceChildren(empty);
    }
  }

  function makeRow(list, path, check) {
    const row = document.createElement('div');
    row.className = 'rr';
    const button = document.createElement('button'), remove = document.createElement('button');
    const name = nameOf(path);
    button.textContent = name;
    button.title = path;
    button.disabled = !tauri;
    remove.textContent = 'Remove';
    remove.setAttribute('aria-label', 'Remove ' + name);
    remove.hidden = true;
    const markMissing = () => {
      button.classList.add('missing');
      button.textContent = name + ' (missing)';
    };
    let checkedByClick = false;
    check.then((available) => { if (!checkedByClick && available === false) markMissing(); });
    button.onclick = async () => {
      checkedByClick = true;
      try {
        if (await exists(path)) {
          menu.open = false;
          open(path);
        } else {
          markMissing();
          remove.hidden = false;
          if (document.activeElement === button) remove.focus();
        }
      } catch (error) { say('Could not reopen ' + name + ': ' + error); }
    };
    remove.onclick = () => {
      const index = Array.from(list.children).indexOf(row);
      save(removeRecent(paths, path));
      const next = list.children[Math.min(index, list.children.length - 1)]?.querySelector('button');
      (next ?? (menu.contains(list) ? summary : document.getElementById('open2'))).focus();
    };
    row.append(button, remove);
    return row;
  }

  menu.ontoggle = () => { if (menu.open) render(); };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
  menu.onkeydown = (e) => {
    if (e.key !== 'Escape' || !menu.open) return;
    e.stopPropagation();
    menu.open = false;
    summary.focus();
  };
  render();
  return (path) => save(addRecent(paths, path));
}

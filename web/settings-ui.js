// settings-ui.js — the ⚙ menu: one checkbox, "Instant tab switching", remembered in localStorage (T15). On unless saved off.
const key = 'v.instantTabs';

export function createSettings({ instantTabs }) {
  const menu = document.getElementById('settings-menu'), box = document.getElementById('instant-tabs');
  let on = true;
  try { on = localStorage.getItem(key) !== '0'; } catch (error) { console.warn('Read settings', error); }
  box.checked = on;
  instantTabs(on);
  box.onchange = () => {
    try { localStorage.setItem(key, box.checked ? '1' : '0'); }
    catch (error) { console.warn('Save settings', error); }
    instantTabs(box.checked);
  };
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
  menu.onkeydown = (e) => {
    if (e.key !== 'Escape' || !menu.open) return;
    e.stopPropagation();
    menu.open = false;
    menu.querySelector('summary').focus();
  };
}

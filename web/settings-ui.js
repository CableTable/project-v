// settings-ui.js — the ⚙ menu: checkboxes remembered in localStorage. "Instant tab switching" (T15) is on unless saved off;
// "Log wheel events" (T10) is off unless saved on.

export function createSettings({ instantTabs, wheelLog }) {
  const menu = document.getElementById('settings-menu');
  toggle('instant-tabs', 'v.instantTabs', true, instantTabs);
  toggle('wheel-log', 'v.wheelLog', false, wheelLog);
  document.addEventListener('click', (e) => { if (!menu.contains(e.target)) menu.open = false; });
  menu.onkeydown = (e) => {
    if (e.key !== 'Escape' || !menu.open) return;
    e.stopPropagation();
    menu.open = false;
    menu.querySelector('summary').focus();
  };
}

/** One checkbox: `byDefault` until the user saves a choice ('1' / '0'); `apply(on)` at start and on each change. */
function toggle(id, key, byDefault, apply) {
  const box = document.getElementById(id);
  let on = byDefault;
  try {
    const saved = localStorage.getItem(key);
    on = byDefault ? saved !== '0' : saved === '1';
  } catch (error) { console.warn('Read settings', error); }
  box.checked = on;
  apply(on);
  box.onchange = () => {
    try { localStorage.setItem(key, box.checked ? '1' : '0'); }
    catch (error) { console.warn('Save settings', error); }
    apply(box.checked);
  };
}

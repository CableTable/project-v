// close-ask.js — closing the window with 2+ tabs asks "Close all N tabs?" (T16): Close all / Close this tab / Cancel, and a Don't ask again box.
// Ctrl+W, a tab's × and a middle click are one-tab closes and never come here.

/** A window close request: 'ignore' while the box is already up, 'ask' with 2+ tabs and the ⚙ setting on, else 'close' at once. */
export const closeRequest = ({ asking, tabs, ask }) => (asking ? 'ignore' : ask && tabs > 1 ? 'ask' : 'close');

/** An answer: 'all' exits, 'tab' closes the active tab (the window stays), 'cancel' does nothing; Don't ask again is saved only with the first two. */
export function choose(choice, dontAsk, { exit, closeTab, stopAsking }) {
  if (choice === 'cancel') return;
  if (dontAsk) stopAsking();
  if (choice === 'all') exit();
  else closeTab();
}

/** The modal. `ask()` -> the ⚙ setting; `count()` -> open tabs; `api` as in choose(). Returns onCloseRequested's handler. */
export function createCloseAsk({ ask, count, api }) {
  const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text ?? '' });
  const dialog = el('dialog'), box = el('div'), title = el('h2'), label = el('label'), dontAsk = el('input');
  const all = el('button', 'Close all'), tab = el('button', 'Close this tab'), cancel = el('button', 'Cancel');
  all.className = 'acc'; // the default answer
  dialog.id = 'close-ask';
  title.id = 'close-ask-title';
  dialog.setAttribute('aria-labelledby', title.id);
  dontAsk.type = 'checkbox';
  label.append(dontAsk, " Don't ask again");
  const buttons = el('div');
  buttons.append(all, tab, cancel);
  box.append(title, label, buttons); // clicks on the dialog itself (not this box) are on the backdrop
  dialog.append(box);
  document.body.append(dialog);

  const answer = (choice) => {
    dialog.close();
    choose(choice, dontAsk.checked, api);
  };
  all.onclick = () => answer('all');
  tab.onclick = () => answer('tab');
  cancel.onclick = () => answer('cancel');
  dialog.oncancel = (event) => { event.preventDefault(); answer('cancel'); }; // Esc
  dialog.onclick = (event) => { if (event.target === dialog) answer('cancel'); };
  dialog.onkeydown = (event) => {
    event.stopPropagation(); // no Ctrl+W / Ctrl+Tab under the box
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'p') event.preventDefault(); // else WebView2 prints the app UI
    if (event.key === 'Enter' && event.target === dontAsk) { event.preventDefault(); answer('all'); }
  };

  return (event) => {
    const what = closeRequest({ asking: dialog.open, tabs: count(), ask: ask() });
    if (what === 'close') return;
    event.preventDefault();
    if (what === 'ignore') return;
    title.textContent = `Close all ${count()} tabs?`;
    dontAsk.checked = false;
    dialog.showModal();
    all.focus();
  };
}

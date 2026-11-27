// close-ask.js — closing the window with 2+ tabs asks "Close all N tabs?" (T16): Close all / Close this tab / Cancel, and a Don't ask again box.
// Ctrl+W, a tab's × and a middle click are one-tab closes and never come here.

/** A window close request: 'ignore' while a box is already up, 'ask' with 2+ tabs and the ⚙ setting on, 'discard' when only a Merge tab
 *  with files is in the way (vmerge-a: `api.exit` asks), else 'close' at once. */
export const closeRequest = ({ asking, tabs, ask, dirty }) => (asking ? 'ignore' : ask && tabs > 1 ? 'ask' : dirty ? 'discard' : 'close');

/** "Discard merge?" and the like: the same box with a `yes` button and Cancel. ask(title, yes) resolves true / false; Esc, the backdrop and
 *  Cancel are false, and so is a second ask while it is up. Cancel has the focus: Enter loses nothing. */
export function createConfirm() {
  const el = (tag, text) => Object.assign(document.createElement(tag), { textContent: text ?? '' });
  const dialog = el('dialog'), box = el('div'), title = el('h2'), buttons = el('div'), ok = el('button'), cancel = el('button', 'Cancel');
  dialog.id = 'confirm-ask';
  title.id = 'confirm-ask-title';
  dialog.setAttribute('aria-labelledby', title.id);
  buttons.append(ok, cancel);
  box.append(title, buttons);
  dialog.append(box);
  document.body.append(dialog);

  let done = null;
  const answer = (yes) => {
    dialog.close();
    done?.(yes);
    done = null;
  };
  ok.onclick = () => answer(true);
  cancel.onclick = () => answer(false);
  dialog.oncancel = (event) => { event.preventDefault(); answer(false); }; // Esc
  dialog.onclick = (event) => { if (event.target === dialog) answer(false); };
  dialog.onkeydown = (event) => {
    event.stopPropagation(); // no Ctrl+W / Ctrl+Tab under the box
    if (event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'p') event.preventDefault();
  };

  const ask = (text, yes) => {
    if (dialog.open) return Promise.resolve(false);
    title.textContent = text;
    ok.textContent = yes;
    dialog.showModal();
    cancel.focus();
    return new Promise((resolve) => { done = resolve; });
  };
  ask.open = () => dialog.open;
  return ask;
}

/** An answer: 'all' exits, 'tab' closes the active tab (the window stays), 'cancel' does nothing; Don't ask again is saved only with the first two. */
export function choose(choice, dontAsk, { exit, closeTab, stopAsking }) {
  if (choice === 'cancel') return;
  if (dontAsk) stopAsking();
  if (choice === 'all') exit();
  else closeTab();
}

/** The modal. `ask()` -> the ⚙ setting; `count()` -> open tabs; `dirty()` -> a Merge tab has files; `asking()` -> another box is up;
 *  `api` as in choose(). Returns onCloseRequested's handler. */
export function createCloseAsk({ ask, count, api, dirty = () => false, asking = () => false }) {
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
    const what = closeRequest({ asking: dialog.open || asking(), tabs: count(), ask: ask(), dirty: dirty() });
    if (what === 'close') return;
    event.preventDefault();
    if (what === 'ignore') return;
    if (what === 'discard') { api.exit(); return; }
    title.textContent = `Close all ${count()} tabs?`;
    dontAsk.checked = false;
    dialog.showModal();
    all.focus();
  };
}

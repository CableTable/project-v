export const canOpenInD = (tab) => Boolean(tab?.path);
export const isOpenInDShortcut = (e) =>
  e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'd';

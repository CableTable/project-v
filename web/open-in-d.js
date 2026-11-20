import { isTiff } from './ai-file.js';

export const canOpenInD = (tab) => Boolean(tab?.path) && !isTiff(tab.path); // D cannot open a TIFF yet (D TODO 138)
export const isOpenInDShortcut = (e) =>
  e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === 'd';

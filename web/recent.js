import { pathKey } from './tabs.js';

export function removeRecent(paths, path) {
  const key = pathKey(path);
  return paths.filter((entry) => pathKey(entry) !== key);
}

export const addRecent = (paths, path) => [path, ...removeRecent(paths, path)].slice(0, 10);

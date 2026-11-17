// launch.js: launch argv -> file paths (pure; same rule as src-tauri/src/launch.rs).
const ABSOLUTE = /^([a-zA-Z]:[\\/]|\\\\)/;

/** Skips the exe and flags, keeps every other argument; a relative one is joined to cwd. */
export function filePaths(argv, cwd) {
  return argv.slice(1)
    .filter((arg) => arg !== '' && !arg.startsWith('-'))
    .map((arg) => (ABSOLUTE.test(arg) ? arg : cwd.replace(/[\\/]+$/, '') + '\\' + arg));
}

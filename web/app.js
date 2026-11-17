// T1: only wiring that loads. T2 renders; nothing here opens a PDF yet.
import './pdf-view.js';

// pdf.js is loaded on demand (T2), so cold start does not parse its 400 KB.
export const loadPdfjs = () => import('./vendor/pdfjs/pdf.min.mjs');

// Launch / second-launch paths arrive from Rust (single-instance); T2 opens them as tabs.
const tauri = window.__TAURI__;
if (tauri) {
  const take = () => tauri.core.invoke('take_launch_files').then((paths) => console.info('launch files', paths));
  tauri.event.listen('open-launch-files', take);
  take();
}

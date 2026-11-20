// print-ui.js — Print (T11): every page of the current tab is drawn one after another (one canvas reused) at 300 dpi into #print-root as one <img> (PNG blob URL)
// per page; app.css shows only #print-root when printing, one named @page per page size so each sheet is 1:1 and follows its page's orientation.
import { pageCss, dpiFor, printScale, PRINT_DPI } from './print.js';

/** `status(text | null)` is the line in #msgs, `say(text)` a dismissable note. start(handle) prints that handle's pages. */
export function createPrint({ status, say }) {
  const root = document.getElementById('print-root'), sheet = document.createElement('style');
  document.head.append(sheet); // the @page rules of the running job (numbers only, nothing from the file)
  let job = null; // { t, preparing, task, urls }

  function clear() {
    for (const url of job?.urls ?? []) URL.revokeObjectURL(url);
    root.replaceChildren();
    sheet.textContent = '';
    status(null);
    job = null;
  }

  /** Stops a job that is still preparing (not one waiting for its dialog) when `match(handle)`; no argument: any. */
  function cancel(match = () => true) {
    if (!job?.preparing || !match(job.t)) return;
    job.task?.cancel();
    job.preparing = false;
    clear();
    say('Print cancelled');
  }

  async function start(t) {
    if (!t || job?.preparing) return;
    if (job) clear(); // an earlier job whose afterprint never came
    const mine = job = { t, preparing: true, task: null, urls: [] }, n = t.pdf.numPages, dpi = dpiFor(n);
    const canvas = document.createElement('canvas'), classes = new Map(), rules = [];
    try {
      for (let i = 1; i <= n; i++) {
        status(`Preparing print ${i} / ${n}${dpi < PRINT_DPI ? `, ${dpi} dpi (over 100 pages)` : ''}`);
        const page = await t.pdf.getPage(i);
        if (job !== mine) return;
        const v1 = page.getViewport({ scale: 1 }), { w, h } = pageCss(v1), vp = page.getViewport({ scale: printScale(v1.width, v1.height, dpi) });
        canvas.width = Math.ceil(vp.width);
        canvas.height = Math.ceil(vp.height);
        mine.task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp });
        await mine.task.promise;
        const blob = await new Promise((done, fail) => canvas.toBlob((b) => b ? done(b) : fail(new Error('could not encode the page')), 'image/png'));
        if (job !== mine) return;
        const size = `${w}pt ${h}pt`;
        if (!classes.has(size)) {
          classes.set(size, `p${classes.size}`);
          rules.push(`@page ${classes.get(size)}{size:${size};margin:0}.${classes.get(size)}{page:${classes.get(size)}}`);
          sheet.textContent = rules.join('\n');
        }
        const sheetBox = document.createElement('div'), img = new Image();
        sheetBox.className = `pp ${classes.get(size)}`;
        mine.urls.push(img.src = URL.createObjectURL(blob));
        img.alt = '';
        img.style.width = `${w}pt`;
        img.style.height = `${h}pt`;
        sheetBox.append(img);
        root.append(sheetBox);
      }
      canvas.width = canvas.height = 0; // frees the big bitmap
      await Promise.all([...root.querySelectorAll('img')].map((img) => img.decode()));
      if (job !== mine) return;
      mine.preparing = false;
      status(null);
      window.print(); // afterprint (below) frees the images
    } catch (e) {
      if (job !== mine) return; // cancelled: the cancel cleaned up
      clear();
      say(`Could not print: ${e instanceof Error ? e.message : e}`);
    }
  }

  window.addEventListener('afterprint', () => { if (job && !job.preparing) clear(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !e.isComposing) cancel(); });
  return { start, cancel };
}

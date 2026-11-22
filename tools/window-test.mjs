import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';
import { makeTiff } from './tiff-fixture.mjs';

const port = 9243;
const endpoint = `http://127.0.0.1:${port}`;
const appUrl = 'http://tauri.localhost/';
// A cold hosted runner creates the WebView2 profile on first start: allow longer there.
const timeout = process.env.GITHUB_ACTIONS === 'true' ? 60_000 : 15_000;
const children = new Map();
const logs = new Map();
let root, browser;

async function step(name, run) {
  try {
    const result = await run();
    console.log(`PASS ${name}`);
    return result;
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

// UI state follows a click / key press after an async re-render: retry the check ~5 s instead of reading it once (T9).
async function until(what, check, ms = 5000) {
  const deadline = performance.now() + ms;
  let last;
  do {
    try {
      if (await check()) return;
    } catch (error) {
      last = error;
    }
    await delay(50);
  } while (performance.now() < deadline);
  throw new Error(`timed out after ${ms} ms waiting for ${what}${last ? `: ${last.message}` : ''}`);
}

function checkPort() {
  return new Promise((done, fail) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      fail(new Error(`port ${port} busy`));
    });
    socket.once('error', (error) => error.code === 'ECONNREFUSED' ? done() : fail(error));
    socket.setTimeout(1000, () => socket.destroy(new Error(`could not check port ${port}`)));
  });
}

// `landscape`: the page numbers (1-based) that are drawn 360 x 288 pt instead of 288 x 360.
async function fixture(path, pages, landscape = []) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const wide = landscape.includes(n), page = pdf.addPage(wide ? [360, 288] : [288, 360]);
    page.drawText(`lorem page ${n}`, { x: 30, y: wide ? 238 : 310, size: 20, font });
  }
  await writeFile(path, await pdf.save());
  return path;
}

// The exe's stdout / stderr go to a file per launch (no pipe to drain, none held open by WebView2 children).
async function launch(exe, pdf) {
  const log = join(root, `exe-${logs.size + 1}.log`);
  const fd = openSync(log, 'a');
  let child;
  try {
    child = spawn(exe, [pdf], {
      stdio: ['ignore', fd, fd],
      env: {
        ...process.env,
        WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
        WEBVIEW2_USER_DATA_FOLDER: root,
        PROJECTV_TEST_DIR: root,
      },
    });
  } finally {
    closeSync(fd);
  }
  logs.set(child, log);
  children.set(child, new Promise((done) => child.once('close', done)));
  await once(child, 'spawn');
  return child;
}

// WebView2 runtime version (documented EdgeUpdate "pv" value), or null when no runtime is installed.
function webview2Version() {
  const guid = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';
  for (const key of [`HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${guid}`,
    `HKLM\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${guid}`, `HKCU\\Software\\Microsoft\\EdgeUpdate\\Clients\\${guid}`]) {
    const out = spawnSync('reg.exe', ['query', key, '/v', 'pv'], { encoding: 'utf8', windowsHide: true });
    const version = out.status === 0 && /pv\s+REG_SZ\s+(\S+)/.exec(out.stdout)?.[1];
    if (version && version !== '0.0.0.0') return version;
  }
  return null;
}

// Why the window never came up, so the next red says it: exit code, exe output, runtime, port, WebView2 processes.
async function attachError(child, message) {
  const version = webview2Version();
  const listening = await checkPort().then(() => 'closed', (e) => /busy/.test(e.message) ? 'listening' : e.message);
  const tasks = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq msedgewebview2.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true });
  const webviews = (tasks.stdout ?? '').split(/\r?\n/).filter((line) => /^"msedgewebview2\.exe"/i.test(line)).length;
  const output = (await readFile(logs.get(child), 'utf8').catch(() => '')).split(/\r?\n/).filter(Boolean).slice(-20);
  const error = new Error([
    message,
    `ProjectV.exe exit code: ${child.exitCode}, signal: ${child.signalCode}`,
    `WebView2 runtime: ${version ?? 'NOT INSTALLED'}; msedgewebview2.exe processes: ${webviews}; port ${port}: ${listening}`,
    `ProjectV.exe output (last 20 lines):${output.length ? `\n${output.join('\n')}` : ' (none)'}`,
  ].join('\n'));
  error.webview2Missing = version === null;
  return error;
}

async function attach(child) {
  const deadline = performance.now() + timeout;
  let lastError;
  while (performance.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) throw await attachError(child, 'ProjectV.exe exited before CDP attached');
    try {
      return await chromium.connectOverCDP(endpoint, { timeout: 1000 });
    } catch (error) {
      lastError = error;
      await delay(100);
    }
  }
  throw await attachError(child, `CDP did not attach within ${timeout / 1000} s: ${lastError.message}`);
}

async function rendered(page, number) {
  await page.waitForFunction((number) => {
    const canvas = document.querySelector(`#pages .pg[data-i="${number - 1}"] canvas`);
    if (!canvas?.width || !canvas.height) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] && (pixels[i] < 200 || pixels[i + 1] < 200 || pixels[i + 2] < 200)) return true;
    }
    return false;
  }, number);
}

async function viewerTimings(page) {
  const samples = await page.locator('#view').evaluate(async (view) => {
    const frame = () => new Promise((done) => requestAnimationFrame(done));
    const settle = () => new Promise((done) => setTimeout(done, 650));
    const zoom = (deltaY) => {
      const { left, top } = view.getBoundingClientRect();
      view.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY, clientX: left + 500, clientY: top + 280,
      }));
    };
    const measure = async (count, action, after) => {
      const times = [];
      await frame();
      for (let i = 0; i < count; i++) {
        const start = performance.now();
        action(i);
        await frame();
        await frame();
        times.push(performance.now() - start);
        if (after) { await after(); await frame(); }
      }
      return times.sort((a, b) => a - b);
    };
    const pan = (dx, dy) => { view.scrollLeft += dx; view.scrollTop += dy; };
    await settle();
    const steps = await measure(12, (i) => zoom(i % 2 ? 100 : -100), settle);
    const mixed = await measure(36, (i) => {
      if (i % 6 === 0) zoom(i % 12 ? 100 : -100);
      pan(i % 2 ? -80 : 80, i % 2 ? -80 : 80);
    });
    for (let i = 0; i < 12; i++) zoom(-100);
    await settle();
    const scroll = await measure(36, (i) => pan(i % 18 < 9 ? 420 : -420, i % 18 < 9 ? 240 : -240));
    return [['Zoom step', steps], ['Pan between zoom steps', mixed], ['Pan at settled zoom', scroll]];
  });
  for (const [label, times] of samples) {
    console.log(`${label} (two frames, median/p95): ${times[Math.floor(times.length / 2)].toFixed(1)}/${times[Math.ceil(times.length * 0.95) - 1].toFixed(1)} ms`);
  }
}

async function checkMerged(path, pages) {
  if (process.env.GITHUB_ACTIONS !== 'true') {
    const where = spawnSync('where.exe', ['qpdf.exe'], { encoding: 'utf8', windowsHide: true });
    const candidates = [
      'E:/Softwares/qpdf/bin/qpdf.exe',
      'E:/Softwares/qpdf/qpdf-12.4.2-msvc64/bin/qpdf.exe',
      ...(where.status === 0 ? where.stdout.trim().split(/\r?\n/) : []),
    ];
    for (const qpdf of candidates) {
      if (!await access(qpdf).then(() => true, () => false)) continue;
      execFileSync(qpdf, ['--check', path], { stdio: 'inherit', windowsHide: true });
      return;
    }
  }
  const merged = await PDFDocument.load(await readFile(path));
  assert.equal(merged.getPageCount(), pages);
}

const timing = (name, start) => console.log(`${name}: ${Math.round(performance.now() - start)} ms`);

try {
  const { exe, timingPdf } = await step('preflight', async () => {
    const flags = process.argv.slice(3);
    assert(process.argv[2] && (!flags.length || (flags.length === 2 && flags[0] === '--pdf' && flags[1])),
      'usage: node tools/window-test.mjs <exe> [--pdf <path>]');
    const path = resolve(process.argv[2]);
    const timingPdf = flags.length ? resolve(flags[1]) : null;
    await access(path);
    if (timingPdf) {
      assert(process.env.GITHUB_ACTIONS !== 'true', '--pdf is for local timing runs');
      await access(timingPdf);
    }
    const running = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq ProjectV.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true,
    });
    assert(!/^"ProjectV\.exe",/im.test(running), 'close ProjectV.exe first');
    await checkPort();
    return { exe: path, timingPdf };
  });

  const [first, second, large, mixed] = await step('generate PDF fixtures', async () => {
    root = await mkdtemp(join(tmpdir(), 'project-v-window-'));
    const input = join(root, 'in');
    await mkdir(input);
    await writeFile(join(input, 'ignore.txt'), 'not a PDF');
    return [
      await fixture(join(input, 'first.pdf'), 1),
      await fixture(join(input, 'second.PDF'), 2),
      await fixture(join(root, '1000-pages.pdf'), 1000),
      await fixture(join(root, 'mixed.pdf'), 3, [2]),
    ];
  });

  const page = await step('launch from argv and render first page', async () => {
    const start = performance.now();
    browser = await attach(await launch(exe, first));
    const version = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(timeout) });
    assert(version.ok, `/json/version returned ${version.status}`);
    assert.match((await version.json()).Browser ?? '', /Edg/);
    const context = browser.contexts()[0];
    const pages = context.pages();
    const page = pages.find((page) => page.url() === appUrl) ?? pages[0]
      ?? await context.waitForEvent('page', { timeout });
    page.setDefaultTimeout(timeout);
    await page.waitForURL(appUrl, { timeout });
    assert.equal(await page.title(), 'Project V');
    await page.getByRole('tab').getByText(basename(first), { exact: true }).waitFor();
    await rendered(page, 1);
    timing('Cold start to first page', start);
    return page;
  });

  await step('Ctrl+F finds lorem', async () => {
    await page.keyboard.press('Control+f');
    const query = page.locator('#find-query');
    await query.waitFor();
    await until('#find-query focused', () => query.evaluate((input) => input === document.activeElement));
    await query.fill('lorem');
    await page.locator('#find-status').filter({ hasText: /^[1-9]\d* of [1-9]\d*$/ }).waitFor();
    await query.press('Escape');
  });

  await step('second launch opens a tab and both files are recent', async () => {
    await launch(exe, second);
    const tabs = page.getByRole('tab');
    await tabs.getByText(basename(second), { exact: true }).waitFor();
    assert.equal(await tabs.count(), 2);
    await page.locator('#file-menu summary').click();
    for (const pdf of [first, second]) {
      await page.locator('#menu-recent').getByRole('button', { name: basename(pdf), exact: true }).waitFor();
    }
    await page.locator('#file-menu summary').click();
  });

  await step('tab close x is 24x24 at 16px with a round hover (T18)', async () => {
    const tabs = page.locator('#tabs .tab'), closes = page.locator('#tabs .tx');
    assert.equal(await tabs.count(), 2);
    const tabHeight = () => tabs.first().evaluate((el) => el.getBoundingClientRect().height);
    console.log(`T18 tab height: ${await tabHeight()}px`);
    for (const [n, x] of (await closes.all()).entries()) {
      const box = await x.boundingBox(), size = await x.evaluate((el) => getComputedStyle(el).fontSize);
      assert(Math.abs(box.width - 24) < 0.01 && Math.abs(box.height - 24) < 0.01, `tab ${n + 1} close is ${box.width}x${box.height}, not 24x24`);
      assert.equal(size, '16px', `tab ${n + 1} close font-size`);
    }
    await mkdir('shots', { recursive: true });
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await closes.last().hover();
      assert.equal(await closes.last().evaluate((el) => getComputedStyle(el).borderRadius), '50%');
      await page.locator('#tabs').screenshot({ path: `shots/T18-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: null });
    await page.mouse.move(0, 300);
  });

  await step('merge Add files and validate the saved PDF', async () => {
    await page.locator('#merge').click();
    const dialog = page.getByRole('dialog', { name: 'Merge PDFs' });
    await dialog.getByRole('button', { name: 'Clear all' }).click();
    await dialog.getByRole('button', { name: 'Add files' }).click();
    await dialog.getByText(basename(second), { exact: true }).waitFor();
    await until('merge list is first, second', async () => {
      assert.deepEqual(await dialog.locator('ol li strong').allTextContents(), [basename(first), basename(second)]);
      return true;
    });
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await checkMerged(join(root, 'out', 'merged.pdf'), 1 + 2);
    await page.getByRole('tab', { selected: true }).getByText('merged.pdf', { exact: true }).waitFor();
  });

  await step('merge pages', async () => {
    await page.locator('#merge').click();
    const dialog = page.getByRole('dialog', { name: 'Merge PDFs' });
    await dialog.getByRole('button', { name: 'Clear all' }).click();
    await dialog.getByRole('button', { name: 'Add files' }).click();
    await dialog.getByRole('button', { name: 'Pages', exact: true }).click();
    const grid = dialog.getByRole('list', { name: 'Pages in merge order' });
    const removed = grid.getByRole('listitem', { name: `${basename(second)} p1` });
    await removed.press('Control+ArrowLeft');
    await dialog.getByRole('button', { name: 'Files', exact: true }).click();
    const range = dialog.getByRole('textbox', { name: `Page range for ${basename(second)}` });
    await until('page range disabled after removing a page', () => range.isDisabled());
    await dialog.getByRole('button', { name: 'Reset page order' }).click();
    await until('page range enabled after Reset page order', () => range.isEnabled());
    await dialog.getByRole('button', { name: 'Pages', exact: true }).click();
    await removed.press('Delete');
    const rotated = grid.getByRole('listitem', { name: `${basename(second)} p2` });
    await rotated.getByRole('button', { name: /Rotate/ }).click();
    await dialog.getByRole('button', { name: 'Files', exact: true }).click();
    await until("page range value '2'", async () => await range.inputValue() === '2');
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    const target = join(root, 'out', 'merged.pdf');
    const pdf = await PDFDocument.load(await readFile(target));
    assert.deepEqual(pdf.getPages().map((page) => page.getRotation().angle), [0, 90]);
    assert(pdf.catalog.has(PDFName.of('Outlines')));
    await checkMerged(target, 2);
  });

  await step('Ctrl+Shift+D requests a ProjectD.exe pick', async () => {
    assert.equal(await page.locator('body').getAttribute('data-v-pick'), null);
    await page.keyboard.press('Control+Shift+D');
    await page.locator('body[data-v-pick="1"]').waitFor();
  });

  await step('Ctrl+P prints one img per page, 1:1, portrait and landscape; afterprint frees them', async () => {
    await launch(exe, mixed);
    await page.getByRole('tab', { selected: true }).getByText(basename(mixed), { exact: true }).waitFor();
    await rendered(page, 1);
    await page.evaluate(() => { window.printCalls = 0; window.print = () => { window.printCalls++; }; });
    const imgCount = () => page.locator('#print-root img').count();

    await page.locator('#merge').click();
    const dialog = page.getByRole('dialog', { name: 'Merge PDFs' });
    await dialog.waitFor();
    assert(await dialog.evaluate((el) => {
      const event = new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event.defaultPrevented;
    }), 'Ctrl+P in the Merge dialog must be prevented');
    assert.equal(await imgCount(), 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });

    for (const press of [() => page.keyboard.press('Control+p'), () => page.locator('#print').click()]) {
      const before = await page.evaluate(() => window.printCalls);
      await press();
      await until('window.print called', () => page.evaluate((n) => window.printCalls === n + 1, before));
      const sheets = await page.locator('#print-root img').evaluateAll((imgs) => imgs.map((img) => {
        const style = getComputedStyle(img);
        return { w: Math.round(parseFloat(style.width) * 0.75), h: Math.round(parseFloat(style.height) * 0.75), px: [img.naturalWidth, img.naturalHeight], src: img.src };
      }));
      assert.deepEqual(sheets.map(({ w, h }) => [w, h]), [[288, 360], [360, 288], [288, 360]]);
      assert.deepEqual(sheets.map(({ px }) => px), [[1200, 1500], [1500, 1200], [1200, 1500]]); // 300 dpi
      const css = await page.evaluate(() => [...document.head.querySelectorAll('style')].map((s) => s.textContent).join('\n'));
      assert.match(css, /@page p0\{size:288pt 360pt;margin:0\}/);
      assert.match(css, /@page p1\{size:360pt 288pt;margin:0\}/);
      await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
      assert.equal(await imgCount(), 0);
      // the CSP allows img-src blob: but not fetch(blob:), so a revoked URL is told by an <img> that no longer loads
      assert.equal(await page.evaluate((src) => new Promise((done) => {
        const img = new Image();
        img.onload = () => done('open');
        img.onerror = () => done('revoked');
        img.src = src;
      }), sheets[0].src), 'revoked');
    }
  });

  await step('open a 1000-page PDF', async () => {
    const start = performance.now();
    await launch(exe, large);
    await page.getByRole('tab', { selected: true }).getByText(basename(large), { exact: true }).waitFor();
    await until("#count is '1000'", async () => await page.locator('#count').textContent() === '1000');
    await rendered(page, 1);
    timing('1000-page open', start);

    await page.locator('#merge').click();
    const dialog = page.getByRole('dialog', { name: 'Merge PDFs' });
    const pagesStart = performance.now();
    await dialog.getByRole('button', { name: 'Pages', exact: true }).click();
    const grid = dialog.getByRole('list', { name: 'Pages in merge order' });
    await grid.locator('canvas').first().waitFor();
    timing('1000-page Pages view to first thumbnail', pagesStart);
    await until('1000 page items', async () => await grid.getByRole('listitem').count() === 1000);
    assert(await grid.locator('canvas').count() < 1000);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  });

  await step('scroll to page 1000', async () => {
    const start = performance.now();
    const pageNumber = page.locator('#page');
    await pageNumber.fill('1000');
    await pageNumber.press('Enter');
    await rendered(page, 1000);
    await until("#page value '1000'", async () => await pageNumber.inputValue() === '1000');
    timing('Scroll to page 1000', start);
  });

  await step('horizontal wheel', async () => {
    const view = page.locator('#view');
    const max = await view.evaluate((el) => {
      for (let i = 0; i < 8; i++) document.querySelector('#zin').click();
      el.scrollLeft = 0;
      return el.scrollWidth - el.clientWidth;
    });
    assert(max >= 128, 'zoomed page must overflow horizontally');
    await view.dispatchEvent('wheel', { deltaX: 80, cancelable: true, bubbles: true });
    await page.waitForFunction(() => document.querySelector('#view').scrollLeft === 80);
    await view.dispatchEvent('wheel', { deltaY: 3, deltaMode: 1, shiftKey: true, cancelable: true, bubbles: true });
    await page.waitForFunction(() => document.querySelector('#view').scrollLeft === 128);
  });

  await step('print over 100 pages is 150 dpi; Esc and a tab switch cancel preparing', async () => {
    const msgs = page.locator('#msgs'), calls = () => page.evaluate(() => window.printCalls);
    const printsBefore = await calls();
    for (const cancel of [() => page.keyboard.press('Escape'), () => page.locator('#tabs .tab:not(.on) .tl').first().click()]) {
      await page.keyboard.press('Control+p');
      await msgs.getByText(/^Preparing print \d+ \/ 1000, 150 dpi \(over 100 pages\)$/).waitFor();
      await cancel();
      await msgs.getByText('Print cancelled').waitFor();
      assert.equal(await page.locator('#print-root img').count(), 0);
      assert.equal(await msgs.getByText(/^Preparing print/).count(), 0);
      await msgs.getByRole('button', { name: 'Dismiss' }).click();
      await page.getByRole('tab').getByText(basename(large), { exact: true }).click(); // back to the 1000 pages
    }
    assert.equal(await calls(), printsBefore);
  });

  await step('instant tab switching: last 5 tabs stay drawn; the ⚙ toggle frees them', async () => {
    const names = [1, 2, 3, 4, 5, 6].map((n) => `kept${n}.pdf`);
    const open = async (name) => {
      await launch(exe, await fixture(join(root, name), 2));
      await page.getByRole('tab', { selected: true }).getByText(name, { exact: true }).waitFor();
      await rendered(page, 1);
    };
    // The switch and the count happen in one task: nothing has had time to paint.
    const canvasesAfterSwitch = (name) => page.evaluate((name) => {
      [...document.querySelectorAll('#tabs .tl')].find((b) => b.textContent === name).click();
      return document.querySelectorAll('#pages .pg canvas').length;
    }, name);
    const closeTabByName = (name) => page.evaluate((name) => {
      [...document.querySelectorAll('#tabs .tab')].find((t) => t.querySelector('.tl').textContent === name).querySelector('.tx').click();
    }, name);
    const setting = async (on) => {
      const menu = page.locator('#settings-menu');
      await menu.locator('summary').click();
      await page.locator('#instant-tabs').setChecked(on);
      await page.keyboard.press('Escape');
      assert.equal(await menu.evaluate((el) => el.open), false, 'Esc closes the ⚙ menu');
    };

    await open(names[0]);
    await open(names[1]);
    assert.equal(await canvasesAfterSwitch(names[0]), 2, 'A -> B -> A: A is drawn the moment it is shown');
    await rendered(page, 1);
    for (const name of names.slice(2)) await open(name); // kept: 6, 5, 4, 3, 1 (the 1st is the 5th); the 2nd is the oldest, freed by the 6th
    assert.equal(await canvasesAfterSwitch(names[0]), 2, 'the 5th most recent tab is kept');
    await rendered(page, 1);
    assert.equal(await canvasesAfterSwitch(names[1]), 0, 'the oldest tab was freed when the 6th came');
    await rendered(page, 1);

    // kept now: 2, 1, 6, 5, 4. Closing 1 takes it off the list, so showing 3 frees nothing.
    await closeTabByName(names[0]);
    await canvasesAfterSwitch(names[2]);
    await rendered(page, 1);
    assert.equal(await canvasesAfterSwitch(names[3]), 2, 'a closed tab leaves the list: nobody was freed for the 3rd');
    await rendered(page, 1);

    // toggle off: the kept background tabs are freed at once; leaving a tab frees it like before
    await setting(false);
    assert.equal(await page.evaluate(() => localStorage.getItem('v.instantTabs')), '0');
    assert.equal(await canvasesAfterSwitch(names[5]), 0, 'background tab freed by the toggle');
    await rendered(page, 1);
    assert.equal(await canvasesAfterSwitch(names[3]), 0, 'toggle off: the tab left was freed');
    await rendered(page, 1);
    await setting(true);
    assert.equal(await page.evaluate(() => localStorage.getItem('v.instantTabs')), '1');
    await page.locator('#settings-menu summary').click();
    await page.locator('#view').click(); // click outside closes it too
    assert.equal(await page.locator('#settings-menu').evaluate((el) => el.open), false);
    await canvasesAfterSwitch(names[5]);
    await rendered(page, 1);
    assert.equal(await canvasesAfterSwitch(names[3]), 2, 'toggle on again: the tab left stays drawn');
  });

  await step('launch with a 2-page TIFF: both pages drawn, Open in D off, Ctrl+P prints 2 pages', async () => {
    const tiff = join(root, 'scan.tif');
    await writeFile(tiff, makeTiff([{ w: 300, h: 400, rgb: [20, 60, 160] }, { w: 400, h: 300, gray: 50, packBits: true }]));
    await launch(exe, tiff);
    await page.getByRole('tab', { selected: true }).getByText('scan.tif', { exact: true }).waitFor();
    await until("#count is '2'", async () => await page.locator('#count').textContent() === '2');
    await rendered(page, 1);
    await rendered(page, 2);
    assert.equal(await page.locator('#open-in-d').isDisabled(), true);
    const before = await page.evaluate(() => window.printCalls);
    await page.keyboard.press('Control+p');
    await until('window.print called', () => page.evaluate((n) => window.printCalls === n + 1, before));
    assert.equal(await page.locator('#print-root img').count(), 2);
    await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  });

  if (timingPdf) await step('time viewer with --pdf', async () => {
    await launch(exe, timingPdf);
    await page.getByRole('tab', { selected: true }).getByText(basename(timingPdf), { exact: true }).waitFor();
    await page.locator('.pg canvas').first().waitFor();
    await viewerTimings(page);
  });
} catch (error) {
  console.error(error.message);
  // The only skip: a CI runner with no WebView2 runtime at all (registry says so); every other failure stays red.
  if (error.webview2Missing && process.env.GITHUB_ACTIONS === 'true') console.log('SKIP real window: WebView2 runtime is not installed on this runner');
  else process.exitCode = 1;
} finally {
  if (root) {
    try {
      await step('cleanup', async () => {
        try {
          for (const [child, closed] of children) {
            if (child.pid && child.exitCode === null && child.signalCode === null) {
              const killed = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 4000 });
              if (killed.status !== 0) child.kill();
            }
            await closed;
          }
          await browser?.close();
        } finally {
          await rm(root, { recursive: true, force: true, maxRetries: 15, retryDelay: 100 });
        }
      });
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

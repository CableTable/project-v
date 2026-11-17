import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { closeSync, openSync } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { chromium } from 'playwright';

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

async function fixture(path, pages) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (let n = 1; n <= pages; n++) {
    const page = pdf.addPage([288, 360]);
    page.drawText(`lorem page ${n}`, { x: 30, y: 310, size: 20, font });
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
  const exe = await step('preflight', async () => {
    assert(process.argv[2], 'usage: node tools/window-test.mjs <exe>');
    const path = resolve(process.argv[2]);
    await access(path);
    const running = execFileSync('tasklist.exe', ['/FI', 'IMAGENAME eq ProjectV.exe', '/FO', 'CSV', '/NH'], {
      encoding: 'utf8', windowsHide: true,
    });
    assert(!/^"ProjectV\.exe",/im.test(running), 'close ProjectV.exe first');
    await checkPort();
    return path;
  });

  const [first, second, large] = await step('generate PDF fixtures', async () => {
    root = await mkdtemp(join(tmpdir(), 'project-v-window-'));
    const input = join(root, 'in');
    await mkdir(input);
    await writeFile(join(input, 'ignore.txt'), 'not a PDF');
    return [
      await fixture(join(input, 'first.pdf'), 1),
      await fixture(join(input, 'second.PDF'), 2),
      await fixture(join(root, '1000-pages.pdf'), 1000),
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
    assert(await query.evaluate((input) => input === document.activeElement));
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

  await step('merge Add files and validate the saved PDF', async () => {
    await page.locator('#merge').click();
    const dialog = page.getByRole('dialog', { name: 'Merge PDFs' });
    await dialog.getByRole('button', { name: 'Clear all' }).click();
    await dialog.getByRole('button', { name: 'Add files' }).click();
    await dialog.getByText(basename(second), { exact: true }).waitFor();
    assert.deepEqual(await dialog.locator('ol li strong').allTextContents(), [basename(first), basename(second)]);
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await dialog.waitFor({ state: 'hidden' });
    await checkMerged(join(root, 'out', 'merged.pdf'), 1 + 2);
    await page.getByRole('tab', { selected: true }).getByText('merged.pdf', { exact: true }).waitFor();
  });

  await step('Ctrl+Shift+D requests a ProjectD.exe pick', async () => {
    assert.equal(await page.locator('body').getAttribute('data-v-pick'), null);
    await page.keyboard.press('Control+Shift+D');
    await page.locator('body[data-v-pick="1"]').waitFor();
  });

  await step('open a 1000-page PDF', async () => {
    const start = performance.now();
    await launch(exe, large);
    await page.getByRole('tab', { selected: true }).getByText(basename(large), { exact: true }).waitFor();
    assert.equal(await page.locator('#count').textContent(), '1000');
    await rendered(page, 1);
    timing('1000-page open', start);
  });

  await step('scroll to page 1000', async () => {
    const start = performance.now();
    const pageNumber = page.locator('#page');
    await pageNumber.fill('1000');
    await pageNumber.press('Enter');
    await rendered(page, 1000);
    assert.equal(await pageNumber.inputValue(), '1000');
    timing('Scroll to page 1000', start);
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

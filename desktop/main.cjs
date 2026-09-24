const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

app.disableHardwareAcceleration();

let window;
let server;
let serverUrl;
let quitting = false;
const smoke = process.argv.includes('--smoke-test');
app.setPath('userData', process.env.TRACKER_DESKTOP_HOME ? path.resolve(process.env.TRACKER_DESKTOP_HOME) : path.join(app.getPath('appData'), 'Social Follower Tracker'));
const dataRoot = path.join(app.getPath('userData'), 'records');
const runtime = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'build/runtime');
const browserPath = app.isPackaged ? path.join(process.resourcesPath, 'browsers') : path.join(__dirname, 'build/browsers');

async function seedRecords() {
  await fs.mkdir(dataRoot, { recursive: true });
  try { await fs.access(path.join(dataRoot, 'accounts.csv')); return; } catch {}
  for (const folder of ['data']) {
    await fs.cp(path.join(runtime, folder), path.join(dataRoot, folder), { recursive: true, force: false, errorOnExist: false });
  }
  await fs.copyFile(path.join(runtime, 'accounts.csv'), path.join(dataRoot, 'accounts.csv'));
}

function startServer() {
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(runtime, 'app/server.mjs')], {
      cwd: runtime,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TRACKER_DATA_ROOT: dataRoot, PLAYWRIGHT_BROWSERS_PATH: browserPath, PORT: '0' },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const timer = setTimeout(() => reject(new Error('The local tracker did not start in time.')), 30000);
    for (const stream of [server.stdout, server.stderr]) stream.on('data', chunk => {
      fs.appendFile(path.join(dataRoot, 'desktop.log'), chunk).catch(() => {});
    });
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => {
      clearTimeout(timer);
      if (!serverUrl) reject(new Error(`The local tracker exited (${code}).`));
      else if (!quitting) dialog.showErrorBox('Tracker stopped', 'The local service stopped. Restart the application. Your saved records are still available.');
    });
    server.on('message', async message => {
      if (message.type === 'ready') {
        clearTimeout(timer);
        serverUrl = message.url;
        try {
          const response = await fetch(serverUrl);
          if (!response.ok) throw new Error(`Local dashboard returned HTTP ${response.status}.`);
          console.log(`Dashboard ready: ${serverUrl}`);
          resolve();
        } catch (error) {
          reject(new Error(`Local dashboard readiness check failed: ${error.message}`));
        }
      }
    });
  });
}

async function exportFile(filename) {
  const { canceled, filePath } = await dialog.showSaveDialog(window, { defaultPath: filename, filters: [{ name: 'CSV', extensions: ['csv'] }] });
  if (!canceled && filePath) await fs.copyFile(path.join(dataRoot, 'data', filename), filePath);
}

async function editAccounts() {
  const { running } = await fetch(`${serverUrl}/api/run-status`).then(res => res.json());
  if (running) return dialog.showMessageBox(window, { message: 'Wait for collection to finish before editing accounts.' });
  await shell.openPath(path.join(dataRoot, 'accounts.csv'));
}

function createMenu() {
  const action = fn => () => Promise.resolve().then(fn).catch(error => dialog.showErrorBox('Action failed', error.message));
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open data folder', click: action(() => shell.openPath(dataRoot)) },
      { label: 'Edit accounts.csv', click: action(editAccounts) },
      { type: 'separator' },
      { label: 'Export history matrix...', click: action(() => exportFile('history_matrix.csv')) },
      { label: 'Export raw history...', click: action(() => exportFile('snapshots.csv')) },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }] },
    { label: 'Help', submenu: [
      { label: 'GitHub releases', click: () => shell.openExternal('https://github.com/Khush-ORF/Social-Media-Tracker/releases') },
      { label: 'About', click: () => dialog.showMessageBox(window, { title: 'Social Follower Tracker', message: `Social Follower Tracker ${app.getVersion()}`, detail: `Local records: ${dataRoot}\nFresh public counts only. Failed requests remain missing. Internet access is required for collection.` }) },
    ] },
  ]));
}

async function stopServer() {
  if (!server?.pid || server.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.once('close', resolve);
      killer.once('error', resolve);
    });
  } else server.kill();
}

async function runSmokeTest() {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browserPath;
  const { chromium } = require(path.join(runtime, 'node_modules/playwright'));
  if (process.argv.includes('--smoke-collect')) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(runtime, 'app/collect.mjs'), '--ids', '001-youtube,001-x,001-linkedin,001-instagram,001-facebook', '--render', '--concurrency', '2'], {
        cwd: runtime, windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', TRACKER_DATA_ROOT: dataRoot, PLAYWRIGHT_BROWSERS_PATH: browserPath },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      child.once('error', reject);
      child.once('close', async code => {
        await fs.writeFile(path.join(app.getPath('userData'), 'smoke-collection.log'), output);
        if (code === 0) resolve(); else reject(new Error(`Packaged collection failed (${code}): ${output.slice(-2000)}`));
      });
    });
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(serverUrl);
  await page.waitForFunction(() => document.querySelectorAll('#latestRows tr').length > 10);
  const result = await page.evaluate(() => ({ title: document.title, rows: document.querySelectorAll('#latestRows tr').length, fetchButton: document.querySelector('#runNow').textContent }));
  await page.screenshot({ path: path.join(app.getPath('userData'), 'desktop-preview.png'), fullPage: false });
  await browser.close();
  const latest = await fetch(`${serverUrl}/api/latest`).then(res => res.json());
  const db = new (require('node:sqlite').DatabaseSync)(path.join(dataRoot, 'data/follower_tracker.sqlite'));
  result.sqlite = db.prepare('PRAGMA integrity_check').get().integrity_check;
  db.close();
  result.accounts = latest.rows.length;
  result.snapshots = (await fetch(`${serverUrl}/api/snapshots`).then(res => res.json())).rows.length;
  result.packaged = app.isPackaged;
  result.nativeWindowLoaded = window.webContents.getURL() === `${serverUrl}/`;
  result.sample = latest.rows.filter(row => row.id.startsWith('001-')).map(({ id, status, count, captured_at, fetch_method }) => ({ id, status, count, captured_at, fetch_method }));
  result.dataRoot = dataRoot;
  await fs.writeFile(path.join(app.getPath('userData'), 'smoke-result.json'), JSON.stringify(result, null, 2));
  quitting = true;
  await stopServer();
  app.quit();
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (window) { window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    await seedRecords();
    await startServer();
    createMenu();
    window = new BrowserWindow({ show: !smoke, width: 1440, height: 940, minWidth: 880, minHeight: 600, title: 'Social Follower Tracker', backgroundColor: '#ffffff', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) => {
      console.error(`Renderer load failed (${code}, mainFrame=${mainFrame}): ${description} ${url}`);
      fs.appendFile(path.join(dataRoot, 'desktop.log'), `Renderer load failed (${code}, mainFrame=${mainFrame}): ${description} ${url}\n`).catch(() => {});
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      const message = `Renderer process exited: ${JSON.stringify(details)}\n`;
      console.error(message);
      fs.appendFile(path.join(dataRoot, 'desktop.log'), message).catch(() => {});
    });
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== new URL(serverUrl).origin) {
        event.preventDefault();
        const message = `Blocked navigation to ${url}; expected ${serverUrl}\n`;
        console.error(message);
        fs.appendFile(path.join(dataRoot, 'desktop.log'), message).catch(() => {});
        if (/^https?:\/\//.test(url)) shell.openExternal(url);
      }
    });
    window.webContents.session.on('will-download', (_event, item) => {
      item.setSaveDialogOptions({ defaultPath: path.join(app.getPath('downloads'), item.getFilename()) });
    });
    await window.loadURL(serverUrl);
    if (smoke) return runSmokeTest();
    window.on('close', event => {
      if (quitting) return;
      event.preventDefault();
      fetch(`${serverUrl}/api/run-status`).then(res => res.json()).then(async ({ running }) => {
        if (running) {
          const answer = await dialog.showMessageBox(window, { type: 'question', buttons: ['Keep collecting', 'Quit'], defaultId: 0, cancelId: 0, message: 'Collection is still running.', detail: 'Quitting stops this run. Completed runs remain saved.' });
          if (answer.response === 0) return;
        }
        quitting = true;
        await stopServer();
        app.quit();
      }).catch(async () => { quitting = true; await stopServer(); app.quit(); });
    });
  }).catch(async error => {
    await fs.writeFile(path.join(app.getPath('userData'), 'startup-error.txt'), error.stack || error.message).catch(() => {});
    if (!smoke) dialog.showErrorBox('Unable to start tracker', error.message);
    quitting = true;
    await stopServer();
    app.exit(1);
  });
  app.on('before-quit', event => {
    if (!quitting && window) { event.preventDefault(); window.close(); }
  });
}

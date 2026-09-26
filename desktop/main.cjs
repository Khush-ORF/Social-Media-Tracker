const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Electron is only the desktop shell. The real tracker still runs as the local
// Node server, then this window opens that server like a private browser tab.
app.disableHardwareAcceleration();

let window;
let server;
let serverUrl;
let quitting = false;
const smoke = process.argv.includes('--smoke-test');
app.setPath('userData', process.env.TRACKER_DESKTOP_HOME ? path.resolve(process.env.TRACKER_DESKTOP_HOME) : path.join(app.getPath('appData'), 'Social Follower Tracker'));
const dataRoot = path.join(app.getPath('userData'), 'records');
const runtime = app.isPackaged ? path.join(process.resourcesPath, 'runtime') : path.join(__dirname, 'build/runtime');
let browserPreference = '';

async function loadBrowserPreference() {
  // The installer writes tracker-settings.json. It says whether collection should
  // use Edge, Chrome, auto-detect, or downloaded Playwright browsers.
  if (process.env.TRACKER_BROWSER_CHANNEL) return process.env.TRACKER_BROWSER_CHANNEL;
  const settingsPath = path.join(app.isPackaged ? path.dirname(process.execPath) : __dirname, 'tracker-settings.json');
  try {
    const { browser } = JSON.parse(await fs.readFile(settingsPath, 'utf8'));
    return ['auto', 'edge', 'chrome', 'playwright'].includes(browser) ? browser : 'auto';
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`Unable to read browser preference: ${error.message}`);
    return 'auto';
  }
}

async function seedRecords() {
  // On first launch, give the user a tiny demo accounts.csv. Existing user data
  // is left alone forever.
  await fs.mkdir(dataRoot, { recursive: true });
  try { await fs.access(path.join(dataRoot, 'accounts.csv')); return; } catch {}
  await fs.copyFile(path.join(runtime, 'accounts.csv'), path.join(dataRoot, 'accounts.csv'));
}

function startServer() {
  // Start the local API in a child process. Electron stays responsive while the
  // server collects, exports, and saves files.
  return new Promise((resolve, reject) => {
    server = spawn(process.execPath, [path.join(runtime, 'app/server.mjs')], {
      cwd: runtime,
      windowsHide: true,
      env: {
        ...process.env, ELECTRON_RUN_AS_NODE: '1', TRACKER_DATA_ROOT: dataRoot,
        TRACKER_BROWSER_CHANNEL: browserPreference === 'playwright' ? '' : browserPreference,
        ...(browserPreference === 'playwright' ? { PLAYWRIGHT_BROWSERS_PATH: path.join(process.resourcesPath, 'browsers') } : {}),
        PORT: '0',
      },
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
  // The menu opens the real accounts.csv, but only when a run is not currently
  // writing records.
  const { running } = await fetch(`${serverUrl}/api/run-status`).then(res => res.json());
  if (running) return dialog.showMessageBox(window, { message: 'Wait for collection to finish before editing accounts.' });
  await shell.openPath(path.join(dataRoot, 'accounts.csv'));
}

function createMenu() {
  // Keep native menu actions small: open folders, export existing files, or point
  // people to release information.
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
  // Closing the app should also stop the private local server it started.
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
  // CI uses this headless path to prove a packaged app can boot, show the launch
  // screen, and read a fresh demo-only records folder.
  const smokePayload = await window.webContents.executeJavaScript(`(async () => {
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !document.querySelector('#launchAccountMeta')?.textContent.includes('2 organizations')) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const initial = {
      title: document.title,
      launchVisible: getComputedStyle(document.querySelector('#launchPanel')).display !== 'none',
      dashboardVisible: getComputedStyle(document.querySelector('#appShell')).display !== 'none',
      accountMeta: document.querySelector('#launchAccountMeta')?.textContent.trim(),
      runMeta: document.querySelector('#launchRunMeta')?.textContent.trim(),
      latestRows: document.querySelectorAll('#latestRows tr').length,
    };
    document.querySelector('#launchFetcher')?.click();
    await new Promise(resolve => setTimeout(resolve, 500));
    return { initial, dashboard: {
      visible: getComputedStyle(document.querySelector('#appShell')).display !== 'none',
      organizations: document.querySelector('#headerOrgMeta')?.textContent.trim(),
      targets: document.querySelector('#targetSummary')?.textContent.trim(),
      fetchButton: document.querySelector('#runNow')?.textContent.trim(),
    }};
  })()`);
  const result = typeof smokePayload === 'string' ? JSON.parse(smokePayload) : smokePayload;
  const latest = await fetch(`${serverUrl}/api/latest`).then(res => res.json());
  result.accounts = latest.rows.length;
  result.snapshots = (await fetch(`${serverUrl}/api/snapshots`).then(res => res.json())).rows.length;
  result.packaged = app.isPackaged;
  result.nativeWindowLoaded = window.webContents.getURL() === `${serverUrl}/`;
  result.historyPathExists = await fs.access(path.join(dataRoot, 'data', 'snapshots.csv')).then(() => true, () => false);
  result.dataRoot = dataRoot;
  result.browserPreference = browserPreference;
  result.packagedHistoryExists = await fs.access(path.join(runtime, 'public', 'data')).then(() => true, () => false);
  result.passed = result.initial.launchVisible && !result.initial.dashboardVisible && result.dashboard.visible
    && result.initial.accountMeta.includes('2 organizations') && result.snapshots === 0 && !result.packagedHistoryExists;
  if (process.argv.includes('--smoke-workflows')) {
    if (!process.env.TRACKER_DESKTOP_HOME) throw new Error('Workflow testing requires an isolated TRACKER_DESKTOP_HOME.');
    try { result.workflows = await require('./smoke-ui.cjs')(window); }
    catch (error) { result.passed = false; result.workflowError = error.stack || error.message; }
  }
  await fs.writeFile(path.join(app.getPath('userData'), 'smoke-result.json'), JSON.stringify(result, null, 2));
  quitting = true;
  await stopServer();
  app.exit(result.passed ? 0 : 1);
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // A second click on the app icon should focus the existing window instead of
  // starting another server pointed at the same records.
  app.on('second-instance', () => { if (window) { window.restore(); window.focus(); } });
  app.whenReady().then(async () => {
    await seedRecords();
    browserPreference = await loadBrowserPreference();
    await startServer();
    createMenu();
    window = new BrowserWindow({ show: !smoke, width: 1440, height: 940, minWidth: 880, minHeight: 600, title: 'Social Follower Tracker', backgroundColor: '#ffffff', webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: false } });
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

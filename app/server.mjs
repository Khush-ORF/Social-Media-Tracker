import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, DATA_DIR, HISTORY_MATRIX_CSV, LATEST_JSON, ROOT, RUNS_DIR, SNAPSHOTS_CSV, SNAPSHOT_COLUMNS, buildLatest, latestRunAt, organizationId, readAccounts, readAccountRows, readSnapshots, toCsv, writeAccountRows, writeHistoryMatrix, writeLatest } from './utils.mjs';
import { currentRunCsv, platformHistoryWorkbook } from './exports.mjs';

// This is the small local web server behind the dashboard. The browser talks to
// these /api routes; social-media pages are never fetched directly by the UI.
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
const RECORD_BACKUPS_DIR = path.join(ROOT, 'record-backups');
let running = null;
let lastRun = {
  state: 'idle',
  started_at: '',
  finished_at: '',
  platform: '',
  scope: 'all',
  targets: 0,
  completed: 0,
  stdout: '',
  stderr: '',
  error: '',
};

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
};

async function sendJson(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function runCollector({ platform = '', organizationIds = [], mode = 'hybrid', render = false, staticOnly = false } = {}) {
  // Only one collection run is allowed at a time. The UI can poll lastRun to show
  // progress while the child process does the slow fetching work.
  if (running) return running;
  const accountsPromise = readAccounts();
  const accountPromise = accountsPromise.then(accounts => {
    const selected = organizationIds.length ? accounts.filter(account => organizationIds.includes(organizationId(account))) : accounts;
    return platform ? selected.filter(account => account.platform.toLowerCase() === platform.toLowerCase()) : selected;
  });
  lastRun = {
    state: 'running',
    started_at: new Date().toISOString(),
    finished_at: '',
    platform,
    mode,
    scope: organizationIds.length ? 'selected' : 'all',
    targets: 0,
    completed: 0,
    stdout: '',
    stderr: '',
    error: '',
  };
  const script = fileURLToPath(new URL('./collect.mjs', import.meta.url));
  const args = [script, platform ? '--platform' : '--all'];
  if (platform) args.push(platform);
  if (staticOnly) args.push('--static-only');
  else if (mode === 'complete') args.push('--mode', 'complete');
  else if (render) args.push('--render');
  args.push('--concurrency', '12');
  running = new Promise((resolve, reject) => {
    accountPromise.then(accounts => {
      lastRun.targets = accounts.length;
      if (organizationIds.length) args.push('--orgs', organizationIds.join(','));
      const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      lastRun.stdout = stdout.slice(-8000);
      lastRun.completed = (stdout.match(/^\d+\/\d+ .* \.\.\. (?:collected|count_not_found|failed)(?:\s|$)/gm) || []).length;
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      lastRun.stderr = stderr.slice(-8000);
    });
    child.on('error', error => {
      running = null;
      lastRun = { ...lastRun, state: 'failed', finished_at: new Date().toISOString(), error: error.message };
      reject(error);
    });
    child.on('close', code => {
      running = null;
      if (code === 0) {
        lastRun = { ...lastRun, state: 'complete', finished_at: new Date().toISOString(), stdout: stdout.slice(-8000), stderr: stderr.slice(-8000), error: '' };
        resolve({ stdout, stderr });
      } else {
        const error = new Error(stderr || stdout || `collector exited ${code}`);
        lastRun = { ...lastRun, state: 'failed', finished_at: new Date().toISOString(), stdout: stdout.slice(-8000), stderr: stderr.slice(-8000), error: error.message };
        reject(error);
      }
    });
    }).catch(error => {
      running = null;
      lastRun = { ...lastRun, state: 'failed', finished_at: new Date().toISOString(), error: error.message };
      reject(error);
    });
  });
  return running;
}

function searchMatches(row, query) {
  if (!query) return true;
  return [row.name, row.website, row.handle, row.profile_url].join(' ').toLowerCase().includes(query.toLowerCase());
}

function applyRowFilters(rows, url) {
  // Server-side filters make downloads and dashboard views agree about selected
  // organizations, platform, status, and search text.
  const orgIds = new Set((url.searchParams.get('org_ids') || '').split(',').map(value => value.trim()).filter(Boolean));
  const platform = String(url.searchParams.get('platform') || '').trim().toLowerCase();
  const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
  const query = String(url.searchParams.get('q') || '').trim();
  return rows.filter(row => {
    const orgId = row.org_id || organizationId(row);
    return (!orgIds.size || orgIds.has(orgId))
      && (!platform || platform === 'all' || String(row.platform).toLowerCase() === platform)
      && (!status || status === 'all' || String(row.status).toLowerCase() === status)
      && searchMatches(row, query);
  }).map(row => ({ ...row, org_id: row.org_id || organizationId(row) }));
}

function runSummaries(rows) {
  // Records screen needs one compact row per run, not every account/platform row.
  const runs = new Map();
  for (const row of rows) {
    if (!runs.has(row.run_id)) runs.set(row.run_id, {
      run_id: row.run_id,
      captured_at: row.captured_at,
      targets: 0,
      collected: 0,
      count_not_found: 0,
      failed: 0,
    });
    const run = runs.get(row.run_id);
    run.targets++;
    if (String(row.captured_at) > String(run.captured_at)) run.captured_at = row.captured_at;
    if (row.status === 'collected') run.collected++;
    else if (row.status === 'count_not_found') run.count_not_found++;
    else if (row.status === 'failed') run.failed++;
  }
  return [...runs.values()].sort((a, b) => String(b.captured_at).localeCompare(String(a.captured_at)));
}

async function backupRecords(label) {
  // Deleting records is reversible from disk: copy the current data files into a
  // timestamped backup before removing anything.
  const stamp = `${label}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const backupDir = path.join(RECORD_BACKUPS_DIR, stamp);
  await fs.mkdir(path.join(backupDir, 'runs'), { recursive: true });
  for (const file of [SNAPSHOTS_CSV, HISTORY_MATRIX_CSV, LATEST_JSON, path.join(DATA_DIR, 'follower_tracker.sqlite'), path.join(DATA_DIR, 'follower_tracker.sqlite-wal'), path.join(DATA_DIR, 'follower_tracker.sqlite-shm')]) {
    try { await fs.copyFile(file, path.join(backupDir, path.basename(file))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  try { await fs.cp(RUNS_DIR, path.join(backupDir, 'runs'), { recursive: true }); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return backupDir;
}

async function rebuildDerivedData() {
  // snapshots.csv is the source of truth. After edits/deletes, rebuild every
  // cache/export that depends on it.
  const snapshots = await readSnapshots();
  await writeHistoryMatrix(snapshots);
  await writeLatest(snapshots, await readAccounts());
  await import(`./sync_sqlite.mjs?rebuild=${Date.now()}`);
  await import(`./export_public_data.mjs?rebuild=${Date.now()}`);
}

async function deleteRuns(runIds) {
  if (running) throw new Error('Wait for the current collection to finish before deleting records.');
  const ids = new Set(runIds.map(value => String(value)));
  const snapshots = await readSnapshots();
  const knownIds = new Set(snapshots.map(row => String(row.run_id)));
  const unknownIds = [...ids].filter(runId => !knownIds.has(runId));
  if (unknownIds.length) throw new Error('One or more selected runs do not exist. Refresh the run list and try again.');
  const backupDir = await backupRecords('delete-runs');
  const remaining = snapshots.filter(row => !ids.has(String(row.run_id)));
  await fs.writeFile(SNAPSHOTS_CSV, toCsv(remaining, SNAPSHOT_COLUMNS), 'utf8');
  for (const runId of ids) await fs.rm(path.join(RUNS_DIR, `${runId}.json`), { force: true });
  await rebuildDerivedData();
  return { deleted_runs: [...ids], deleted_rows: snapshots.length - remaining.length, backup_dir: backupDir };
}

async function deleteAllRecords() {
  if (running) throw new Error('Wait for the current collection to finish before deleting records.');
  const snapshots = await readSnapshots();
  const backupDir = await backupRecords('delete-all');
  await fs.rm(SNAPSHOTS_CSV, { force: true });
  await fs.rm(HISTORY_MATRIX_CSV, { force: true });
  await fs.rm(LATEST_JSON, { force: true });
  await fs.rm(path.join(DATA_DIR, 'follower_tracker.sqlite'), { force: true });
  await fs.rm(path.join(DATA_DIR, 'follower_tracker.sqlite-wal'), { force: true });
  await fs.rm(path.join(DATA_DIR, 'follower_tracker.sqlite-shm'), { force: true });
  await fs.rm(RUNS_DIR, { recursive: true, force: true });
  await rebuildDerivedData();
  return { deleted_runs: runSummaries(snapshots).length, deleted_rows: snapshots.length, backup_dir: backupDir };
}

async function routeApi(req, res, url) {
  // API routes are intentionally boring JSON/file endpoints so the same server
  // works in a browser, in Electron, and in tests.
  if (url.pathname === '/api/latest') {
    try {
      const latest = JSON.parse(await fs.readFile(LATEST_JSON, 'utf8'));
      const snapshots = await readSnapshots();
      const rows = buildLatest(snapshots, await readAccounts());
      return sendJson(res, 200, { ...latest, latest_run_at: latestRunAt(rows) || latest.latest_run_at || null, rows: applyRowFilters(rows, url) });
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(res, 200, { generated_at: null, rows: [] });
      throw error;
    }
  }
  if (url.pathname === '/api/snapshots') {
    return sendJson(res, 200, { rows: applyRowFilters(await readSnapshots(), url) });
  }
  if (url.pathname === '/api/history') {
    return sendJson(res, 200, { rows: applyRowFilters(await readSnapshots(), url) });
  }
  if (url.pathname === '/api/runs') {
    return sendJson(res, 200, { runs: runSummaries(await readSnapshots()) });
  }
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const body = await readBody(req).catch(() => '{}');
    const payload = body ? JSON.parse(body) : {};
    const platform = String(payload.platform || '').trim();
    const organizationIds = Array.isArray(payload.organizationIds) ? [...new Set(payload.organizationIds.map(value => String(value).slice(0, 500)))] : [];
    const mode = ['complete', 'static'].includes(payload.mode) ? payload.mode : 'hybrid';
    const render = payload.render === true;
    const staticOnly = mode === 'static';
    if (running) {
      return sendJson(res, 202, { ok: true, running: true, status: lastRun });
    }
    if (payload.scope === 'selected' && !organizationIds.length) return sendJson(res, 400, { ok: false, error: 'Select at least one organization, or choose the entire accounts.csv.' });
    if (payload.scope === 'selected') {
      const accounts = await readAccounts();
      const matches = accounts.filter(account => organizationIds.includes(organizationId(account)) && (!platform || account.platform.toLowerCase() === platform.toLowerCase()));
      if (!matches.length) return sendJson(res, 400, { ok: false, error: 'The selected organizations have no profile for this platform.' });
    }
    runCollector({ platform, organizationIds: payload.scope === 'selected' ? organizationIds : [], mode, render, staticOnly }).catch(error => console.error(error.message));
    return sendJson(res, 202, { ok: true, running: true, status: lastRun });
  }
  if (url.pathname === '/api/run-status') {
    return sendJson(res, 200, { ok: true, running: Boolean(running), status: lastRun });
  }
  if (url.pathname === '/api/records/clear' && req.method === 'POST') {
    const payload = JSON.parse(await readBody(req).catch(() => '{}'));
    if (running) return sendJson(res, 409, { ok: false, error: 'Wait for the current collection to finish before deleting records.' });
    if (payload.scope === 'all') return sendJson(res, 200, { ok: true, ...(await deleteAllRecords()) });
    if (payload.scope === 'runs' && Array.isArray(payload.runIds) && payload.runIds.length) {
      return sendJson(res, 200, { ok: true, ...(await deleteRuns(payload.runIds)) });
    }
    return sendJson(res, 400, { ok: false, error: 'Choose at least one run or use the all-records action.' });
  }
  if (url.pathname === '/api/shutdown' && req.method === 'POST' && process.env.TRACKER_ALLOW_SHUTDOWN === 'true') {
    await sendJson(res, 202, { ok: true });
    setTimeout(() => server.close(() => process.exit(0)), 50);
    return;
  }
  if (url.pathname === '/api/download/snapshots.csv') {
    try {
      const csv = await fs.readFile(SNAPSHOTS_CSV);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="snapshots.csv"' });
      return res.end(csv);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        return res.end('No snapshots yet');
      }
      throw error;
    }
  }
  if (url.pathname === '/api/download/current-run.csv') {
    const csv = currentRunCsv(await readSnapshots());
    res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="current-run.csv"' });
    return res.end(csv);
  }
  if (url.pathname === '/api/download/dataset.xlsx') {
    const buffer = await platformHistoryWorkbook(await readSnapshots());
    res.writeHead(200, {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="social-follower-dataset.xlsx"',
    });
    return res.end(Buffer.from(buffer));
  }
  if (url.pathname === '/api/download/database.sqlite') {
    const databasePath = path.join(DATA_DIR, 'follower_tracker.sqlite');
    let tempDir = '';
    try {
      const { DatabaseSync, backup } = await import('node:sqlite');
      const db = new DatabaseSync(databasePath);
      tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'social-tracker-db-'));
      const copyPath = path.join(tempDir, 'follower_tracker.sqlite');
      try { await backup(db, copyPath); } finally { db.close(); }
      const database = await fs.readFile(copyPath);
      res.writeHead(200, { 'content-type': 'application/vnd.sqlite3', 'content-disposition': 'attachment; filename="follower_tracker.sqlite"' });
      return res.end(database);
    } catch (error) {
      if (error.code === 'ENOENT') { res.writeHead(404); return res.end('Database not available yet'); }
      throw error;
    } finally {
      if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
  if (url.pathname === '/api/download/history_matrix.csv') {
    try {
      const snapshots = await readSnapshots();
      await writeHistoryMatrix(snapshots);
      const csv = await fs.readFile(HISTORY_MATRIX_CSV);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="history_matrix.csv"' });
      return res.end(csv);
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.writeHead(404);
        return res.end('No snapshots yet');
      }
      throw error;
    }
  }
  if (url.pathname === '/api/accounts' && req.method === 'GET') {
    const rows = await readAccountRows();
    return sendJson(res, 200, { rows: rows.map(row => ({ ...row, org_id: organizationId(row) })) });
  }
  if (url.pathname === '/api/accounts' && req.method === 'PUT') {
    if (running) return sendJson(res, 409, { ok: false, error: 'Wait for the current collection to finish before editing accounts.' });
    const payload = JSON.parse(await readBody(req));
    if (!Array.isArray(payload.rows)) return sendJson(res, 400, { ok: false, error: 'Expected rows for accounts.csv.' });
    const rows = await writeAccountRows(payload.rows);
    return sendJson(res, 200, { ok: true, rows: rows.map(row => ({ ...row, org_id: organizationId(row) })) });
  }
  res.writeHead(404);
  res.end('Not found');
}

async function routeStatic(req, res, url) {
  // Static files are served from public/. The path check prevents a URL from
  // escaping the app folder and reading random files from the computer.
  const requested = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const baseDir = requested.startsWith('/data/') ? path.join(ROOT, 'public') : PUBLIC_DIR;
  const fullPath = path.resolve(baseDir, `.${requested}`);
  const relative = path.relative(baseDir, fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  try {
    const data = await fs.readFile(fullPath);
    res.writeHead(200, { 'content-type': contentTypes[path.extname(fullPath)] || 'application/octet-stream' });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not found');
    } else {
      throw error;
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) return await routeApi(req, res, url);
    return await routeStatic(req, res, url);
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(error.message);
  }
});

await fs.mkdir(DATA_DIR, { recursive: true });
await readAccountRows();
server.listen(PORT, HOST, async () => {
  const displayHost = HOST === '0.0.0.0' ? '127.0.0.1' : HOST;
  const url = `http://${displayHost}:${server.address().port}`;
  if (process.env.TRACKER_READY_FILE) await fs.writeFile(process.env.TRACKER_READY_FILE, url, 'utf8');
  console.log(`Local follower tracker: ${url}`);
  process.send?.({ type: 'ready', url });
});

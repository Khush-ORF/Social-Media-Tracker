import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, DATA_DIR, HISTORY_MATRIX_CSV, LATEST_JSON, ROOT, SNAPSHOTS_CSV, parseCsv, readSnapshots, writeHistoryMatrix } from './utils.mjs';

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(APP_ROOT, 'public');
let running = null;
let lastRun = {
  state: 'idle',
  started_at: '',
  finished_at: '',
  platform: '',
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

function runCollector(platform = '') {
  if (running) return running;
  lastRun = {
    state: 'running',
    started_at: new Date().toISOString(),
    finished_at: '',
    platform,
    stdout: '',
    stderr: '',
    error: '',
  };
  const script = fileURLToPath(new URL('./collect.mjs', import.meta.url));
  const args = [script, platform ? '--platform' : '--all'];
  if (platform) args.push(platform);
  args.push('--render', '--concurrency', '4');
  running = new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk;
      lastRun.stdout = stdout.slice(-8000);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk;
      lastRun.stderr = stderr.slice(-8000);
    });
    child.on('error', error => {
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
  });
  return running;
}

async function routeApi(req, res, url) {
  if (url.pathname === '/api/latest') {
    try {
      const latest = JSON.parse(await fs.readFile(LATEST_JSON, 'utf8'));
      return sendJson(res, 200, latest);
    } catch (error) {
      if (error.code === 'ENOENT') return sendJson(res, 200, { generated_at: null, rows: [] });
      throw error;
    }
  }
  if (url.pathname === '/api/snapshots') {
    return sendJson(res, 200, { rows: await readSnapshots() });
  }
  if (url.pathname === '/api/run' && req.method === 'POST') {
    const body = await readBody(req).catch(() => '{}');
    const payload = body ? JSON.parse(body) : {};
    const platform = String(payload.platform || '').trim();
    if (running) {
      return sendJson(res, 202, { ok: true, running: true, status: lastRun });
    }
    runCollector(platform).catch(error => console.error(error.message));
    return sendJson(res, 202, { ok: true, running: true, status: lastRun });
  }
  if (url.pathname === '/api/run-status') {
    return sendJson(res, 200, { ok: true, running: Boolean(running), status: lastRun });
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
  if (url.pathname === '/api/accounts') {
    const accounts = parseCsv(await fs.readFile(path.join(ROOT, 'accounts.csv'), 'utf8'));
    return sendJson(res, 200, { rows: accounts });
  }
  res.writeHead(404);
  res.end('Not found');
}

async function routeStatic(req, res, url) {
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
server.listen(PORT, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}`;
  console.log(`Local follower tracker: ${url}`);
  process.send?.({ type: 'ready', url });
});

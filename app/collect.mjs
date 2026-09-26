import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendSnapshots, ensureDataDirs, organizationId, readAccounts, readSnapshots, writeHistoryMatrix, writeLatest, writeRun } from './utils.mjs';
import { parseFromText, parseMetric } from './parsers.mjs';

// This file is the collector: it opens each public profile page, looks for the
// public follower number, and writes one saved row for every attempted account.
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const platformArg = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : '';
const idsArg = args.includes('--ids') ? String(args[args.indexOf('--ids') + 1] || '') : '';
const requestedIds = new Set(idsArg.split(',').map(value => value.trim()).filter(Boolean));
const organizationArg = args.includes('--orgs') ? String(args[args.indexOf('--orgs') + 1] || '') : '';
const requestedOrganizations = new Set(organizationArg.split(',').map(value => value.trim()).filter(Boolean));
if (args.includes('--ids') && !requestedIds.size) throw new Error('The --ids option requires at least one account id.');
if (args.includes('--orgs') && !requestedOrganizations.size) throw new Error('The --orgs option requires at least one organization id.');
const all = args.includes('--all') || (!platformArg && !requestedIds.size && !requestedOrganizations.size);
const requestedMode = args.includes('--mode') ? String(args[args.indexOf('--mode') + 1] || '') : '';
const fullMode = args.includes('--full') || requestedMode === 'complete' || process.env.COLLECT_MODE === 'full';
const renderEnabled = !args.includes('--static-only') && (fullMode || args.includes('--render') || process.env.COLLECT_RENDER === 'true' || !args.includes('--no-render'));
const concurrencyArg = args.includes('--concurrency') ? Number(args[args.indexOf('--concurrency') + 1]) : 0;
const githubActions = process.env.GITHUB_ACTIONS === 'true';
const selfHostedRunner = process.env.RUNNER_ENVIRONMENT === 'self-hosted';
const overallConcurrency = Number.isFinite(concurrencyArg) && concurrencyArg > 0
  ? Math.trunc(concurrencyArg)
  : fullMode
    ? 4
    : githubActions && !selfHostedRunner
      ? 8
      : 16;

const platformConcurrency = fullMode
  ? { YouTube: 2, X: 1, LinkedIn: 2, Instagram: 1, Facebook: 1 }
  : githubActions && !selfHostedRunner
    ? { YouTube: 6, X: 0, LinkedIn: 4, Instagram: 1, Facebook: 2 }
    : { YouTube: 8, X: 3, LinkedIn: 6, Instagram: 2, Facebook: 3 };

// Every run gets a time-based name. That name connects the CSV rows, JSON file,
// SQLite tables, and UI progress display.
function runIdFor(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchStatic(url) {
  // First try the cheap path: download the page HTML like a normal web request.
  // This is fast and avoids opening a browser when the count is already visible.
  let lastError;
  const attempts = fullMode ? 3 : 1;
  const timeoutMs = fullMode ? 35000 : 8000;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (response.ok) return { html: await response.text(), source_url: response.url, fetch_method: 'static' };
    lastError = new Error(`HTTP ${response.status}`);
    if (![403, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    if (attempt < attempts - 1) await sleep(4000 * (attempt + 1));
  }
  throw lastError;
}

let renderedBrowser;
let renderedBrowserPromise;

async function getRenderedBrowser() {
  // Some pages hide the count until JavaScript runs. Playwright gives us a real
  // headless browser for those pages, and this keeps one browser shared per run.
  if (renderedBrowser) return renderedBrowser;
  if (!renderedBrowserPromise) {
    renderedBrowserPromise = Promise.resolve().then(() => {
      const { chromium } = require('playwright');
      const browserOptions = process.env.TRACKER_BROWSER_CHANNEL ? { channel: process.env.TRACKER_BROWSER_CHANNEL } : {};
      return chromium.launch({ headless: true, ...browserOptions });
    }).then(browser => { renderedBrowser = browser; return browser; }).catch(error => {
      renderedBrowserPromise = null;
      throw error;
    });
  }
  return renderedBrowserPromise;
}

async function closeRenderedBrowser() {
  const browser = renderedBrowser;
  renderedBrowser = null;
  renderedBrowserPromise = null;
  if (browser) await browser.close().catch(() => {});
}

function systemBrowserExecutable(preference = '') {
  // The installer can use the user's existing Edge/Chrome, so the app stays much
  // smaller than bundling a whole browser every time.
  const browserRoots = {
    edge: [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ],
    chrome: [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ],
  };
  const requested = String(preference).toLowerCase();
  const order = requested === 'chrome' || requested === 'googlechrome' ? ['chrome', 'edge'] : ['edge', 'chrome'];
  if (process.env.TRACKER_BROWSER_PATH && existsSync(process.env.TRACKER_BROWSER_PATH)) return { path: process.env.TRACKER_BROWSER_PATH, name: 'system browser' };
  for (const browser of order) {
    const executable = browserRoots[browser].filter(Boolean).find(candidate => existsSync(candidate));
    if (executable) return { path: executable, name: browser === 'chrome' ? 'chrome' : 'edge' };
  }
  return null;
}

async function fetchRenderedWithSystemBrowser(url, preference = '') {
  // Edge and Chrome both have a --dump-dom mode: open the page invisibly, wait a
  // moment, then print the finished HTML so the parser can read it.
  const selected = systemBrowserExecutable(preference);
  if (!selected) throw new Error('No supported browser is available. Install Microsoft Edge or Google Chrome, or install Playwright browsers.');
  const profile = mkdtempSync(path.join(os.tmpdir(), 'social-tracker-browser-'));
  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(selected.path, [
        '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
        `--user-data-dir=${profile}`, '--virtual-time-budget=5000', '--dump-dom', url,
      ], { windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error(`${selected.name} render timed out.`)); }, fullMode ? 55000 : 30000);
      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => {
        clearTimeout(timer);
        if (code === 0 && stdout.trim()) resolve({ html: stdout, source_url: url, fetch_method: selected.name });
        else reject(new Error(stderr.trim() || `${selected.name} exited ${code}`));
      });
    });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

async function fetchRendered(url, platform) {
  // Browser fallback order:
  // 1. user's chosen system browser,
  // 2. Playwright browser if installed,
  // 3. clear error so the UI shows why that profile could not be collected.
  const channel = String(process.env.TRACKER_BROWSER_CHANNEL || '').toLowerCase();
  if (channel === 'auto' && systemBrowserExecutable()) return fetchRenderedWithSystemBrowser(url);
  if (['msedge', 'edge', 'chrome', 'googlechrome'].includes(channel)) return fetchRenderedWithSystemBrowser(url, channel);
  let browser;
  try { browser = await getRenderedBrowser(); } catch (error) {
    const fallback = systemBrowserExecutable();
    if (fallback) return fetchRenderedWithSystemBrowser(url, fallback.name);
    if (error.message.includes('playwright')) throw new Error('Playwright is unavailable and no Edge or Chrome installation was found. Install a browser or disable browser fallback.');
    throw error;
  }
  let page;
  try {
    page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      locale: 'en-US',
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: fullMode ? 45000 : 20000 });
    await sleep(fullMode ? (platform === 'Instagram' || platform === 'Facebook' ? 2500 : 1200) : 900);
    const html = await page.content();
    const visibleText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    return { html: `${html}\n${visibleText}`, source_url: page.url(), fetch_method: 'playwright' };
  } finally {
    await page?.close();
  }
}

async function collectOne(account, runId, pageCache) {
  // A failed profile still becomes a saved row. That way missing data is visible
  // in the dashboard instead of silently disappearing.
  const captured_at = new Date().toISOString();
  const base = {
    run_id: runId,
    id: account.id,
    name: account.name,
    website: account.website,
    platform: account.platform,
    handle: account.handle,
    profile_url: account.profile_url,
    metric_label: '',
    count: '',
    raw_display_text: '',
    count_precision: '',
    status: 'failed',
    error: '',
    source_url: '',
    captured_at,
    fetch_method: '',
    notes: account.notes,
  };

  let firstError = '';
  const fetchers = [fetchStatic];
  if (renderEnabled) fetchers.push(fetchRendered);
  for (const fetcher of fetchers) {
    try {
      // If the same page appears more than once in a run, fetch it once and share
      // the result. This saves time and reduces repeated hits to public sites.
      const cacheKey = `${fetcher.name}:${account.platform}:${account.profile_url}`;
      if (!pageCache.has(cacheKey)) pageCache.set(cacheKey, fetcher(account.profile_url, account.platform));
      const page = await pageCache.get(cacheKey);
      const parsed = parseMetric(account.platform, page.html) || parseFromText(account.platform, page.html);
      if (parsed) {
        return {
          ...base,
          metric_label: parsed.metric_label,
          count: parsed.count,
          raw_display_text: parsed.raw_display_text,
          count_precision: parsed.count_precision,
          status: 'collected',
          source_url: page.source_url,
          fetch_method: page.fetch_method,
        };
      }
      firstError ||= 'count not found in public page';
      if (fetcher === fetchers.at(-1)) {
        return {
          ...base,
          status: 'count_not_found',
          error: firstError,
          source_url: page.source_url,
          fetch_method: page.fetch_method,
        };
      }
    } catch (error) {
      if (fetcher === fetchRendered && /No supported browser is available|Microsoft Edge is not available|Google Chrome is not available/.test(error.message)) firstError = error.message;
      else firstError ||= error.message;
      if (fetcher === fetchers.at(-1)) {
        return { ...base, status: 'failed', error: firstError, fetch_method: fetcher === fetchRendered ? 'playwright' : 'static' };
      }
    }
  }
  return { ...base, status: 'failed', error: firstError || 'unknown error' };
}

function platformLimit(platform) {
  return platformConcurrency[platform] ?? 2;
}

async function collectMany(accounts, runId) {
  // This is a small traffic controller. It runs several accounts at once, but it
  // slows down noisy platforms so one site does not block or rate-limit the run.
  if (!accounts.length) return [];
  const rows = new Array(accounts.length);
  const activeByPlatform = new Map();
  const queued = accounts.map((account, index) => ({ account, index }));
  const pageCache = new Map();
  let activeTotal = 0;
  let completed = 0;

  return await new Promise(resolve => {
    function tryStart() {
      while (activeTotal < overallConcurrency) {
        const queueIndex = queued.findIndex(item => (activeByPlatform.get(item.account.platform) || 0) < platformLimit(item.account.platform));
        if (queueIndex === -1) break;
        const [{ account, index }] = queued.splice(queueIndex, 1);
        activeTotal++;
        activeByPlatform.set(account.platform, (activeByPlatform.get(account.platform) || 0) + 1);
        console.log(`${index + 1}/${accounts.length} ${account.platform} ${account.handle || account.profile_url} ... started`);
        collectOne(account, runId, pageCache)
          .then(row => {
            rows[index] = row;
            console.log(`${index + 1}/${accounts.length} ${account.platform} ${account.handle || account.profile_url} ... ${row.status}${row.count ? ` (${row.count})` : row.error ? ` - ${row.error}` : ''}`);
          })
          .catch(error => {
            rows[index] = {
              run_id: runId,
              id: account.id,
              name: account.name,
              website: account.website,
              platform: account.platform,
              handle: account.handle,
              profile_url: account.profile_url,
              metric_label: '',
              count: '',
              raw_display_text: '',
              count_precision: '',
              status: 'failed',
              error: error.message,
              source_url: '',
              captured_at: new Date().toISOString(),
              fetch_method: '',
              notes: account.notes,
            };
            console.log(`${index + 1}/${accounts.length} ${account.platform} ${account.handle || account.profile_url} ... failed - ${error.message}`);
          })
          .finally(() => {
            activeTotal--;
            activeByPlatform.set(account.platform, Math.max(0, (activeByPlatform.get(account.platform) || 1) - 1));
            completed++;
            if (completed === accounts.length) resolve(rows);
            else tryStart();
          });
      }
    }
    tryStart();
  });
}

async function main() {
  // Main flow: choose accounts, collect rows, then rebuild every derived file the
  // UI and exports read from.
  await ensureDataDirs();
  const requestedPlatform = platformArg ? platformArg.toLowerCase() : '';
  const accounts = (await readAccounts()).filter(row => {
    if (requestedIds.size && !requestedIds.has(row.id)) return false;
    if (requestedOrganizations.size && !requestedOrganizations.has(organizationId(row))) return false;
    return all || !requestedPlatform || row.platform.toLowerCase() === requestedPlatform;
  });
  const runId = runIdFor();
  console.log(JSON.stringify({
    mode: fullMode ? 'full' : 'fast',
    render_enabled: renderEnabled,
    overall_concurrency: overallConcurrency,
    platform_concurrency: platformConcurrency,
    targets: accounts.length,
  }, null, 2));
  let rows;
  try { rows = await collectMany(accounts, runId); } finally { await closeRenderedBrowser(); }
  await appendSnapshots(rows);
  await writeRun(runId, rows);
  const allSnapshots = await readSnapshots();
  const matrix = await writeHistoryMatrix(allSnapshots);
  const latest = await writeLatest(allSnapshots, await readAccounts());
  await import('./sync_sqlite.mjs');
  await import('./export_public_data.mjs');
  const summary = {
    run_id: runId,
    targets: rows.length,
    collected: rows.filter(row => row.status === 'collected').length,
    count_not_found: rows.filter(row => row.status === 'count_not_found').length,
    failed: rows.filter(row => row.status === 'failed').length,
    latest_rows: latest.length,
    history_matrix_rows: matrix.length,
  };
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

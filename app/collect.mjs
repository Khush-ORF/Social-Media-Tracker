import { createRequire } from 'node:module';
import { appendSnapshots, ensureDataDirs, readAccounts, readSnapshots, writeHistoryMatrix, writeLatest, writeRun } from './utils.mjs';
import { parseFromText, parseMetric } from './parsers.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const platformArg = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : '';
const idsArg = args.includes('--ids') ? String(args[args.indexOf('--ids') + 1] || '') : '';
const requestedIds = new Set(idsArg.split(',').map(value => value.trim()).filter(Boolean));
const all = args.includes('--all') || (!platformArg && !requestedIds.size);
const fullMode = args.includes('--full') || process.env.COLLECT_MODE === 'full';
const renderEnabled = fullMode || args.includes('--render') || process.env.COLLECT_RENDER === 'true';
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

function runIdFor(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchStatic(url) {
  let lastError;
  const attempts = fullMode ? 3 : 1;
  const timeoutMs = fullMode ? 35000 : 12000;
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

async function fetchRendered(url, platform) {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch {
    throw new Error('Playwright unavailable');
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      locale: 'en-US',
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await sleep(platform === 'Instagram' || platform === 'Facebook' ? 5000 : 2500);
    const html = await page.content();
    const visibleText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    return { html: `${html}\n${visibleText}`, source_url: page.url(), fetch_method: 'playwright' };
  } finally {
    await browser.close();
  }
}

async function collectOne(account, runId) {
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
  const renderedFirst = githubActions && !selfHostedRunner && ['X', 'Instagram'].includes(account.platform);
  const fetchers = renderedFirst && renderEnabled ? [fetchRendered, fetchStatic] : [fetchStatic];
  if (renderEnabled && !renderedFirst) fetchers.push(fetchRendered);
  for (const fetcher of fetchers) {
    try {
      const page = await fetcher(account.profile_url, account.platform);
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
      firstError ||= error.message;
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
  if (!accounts.length) return [];
  const rows = new Array(accounts.length);
  const activeByPlatform = new Map();
  const queued = accounts.map((account, index) => ({ account, index }));
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
        collectOne(account, runId)
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
  await ensureDataDirs();
  const requestedPlatform = platformArg ? platformArg.toLowerCase() : '';
  const accounts = (await readAccounts()).filter(row => {
    if (requestedIds.size && !requestedIds.has(row.id)) return false;
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
  const rows = await collectMany(accounts, runId);
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

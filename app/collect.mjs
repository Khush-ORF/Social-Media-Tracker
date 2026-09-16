import { createRequire } from 'node:module';
import { appendSnapshots, ensureDataDirs, readAccounts, readSnapshots, writeHistoryMatrix, writeLatest, writeRun } from './utils.mjs';
import { parseFromText, parseMetric } from './parsers.mjs';

const require = createRequire(import.meta.url);
const args = process.argv.slice(2);
const platformArg = args.includes('--platform') ? args[args.indexOf('--platform') + 1] : '';
const all = args.includes('--all') || !platformArg;

function runIdFor(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 23);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function platformDelay(platform) {
  const githubActions = process.env.GITHUB_ACTIONS === 'true';
  if (!githubActions) return 500;
  if (platform === 'Instagram') return 12000;
  if (platform === 'X') return 3500;
  if (platform === 'Facebook') return 2500;
  if (platform === 'LinkedIn') return 1500;
  return 750;
}

async function fetchStatic(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(35000),
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
        'accept-language': 'en-US,en;q=0.9',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    if (response.ok) return { html: await response.text(), source_url: response.url, fetch_method: 'static' };
    lastError = new Error(`HTTP ${response.status}`);
    if (![403, 429, 500, 502, 503, 504].includes(response.status)) throw lastError;
    await sleep(4000 * (attempt + 1));
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
  const renderedFirst = process.env.GITHUB_ACTIONS === 'true' && ['X', 'Instagram'].includes(account.platform);
  const fetchers = renderedFirst ? [fetchRendered, fetchStatic] : [fetchStatic, fetchRendered];
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

async function main() {
  await ensureDataDirs();
  const requestedPlatform = platformArg ? platformArg.toLowerCase() : '';
  const accounts = (await readAccounts()).filter(row => all || row.platform.toLowerCase() === requestedPlatform);
  const runId = runIdFor();
  const rows = [];
  for (let i = 0; i < accounts.length; i++) {
    const account = accounts[i];
    process.stdout.write(`${i + 1}/${accounts.length} ${account.platform} ${account.handle || account.profile_url} ... `);
    const row = await collectOne(account, runId);
    rows.push(row);
    console.log(`${row.status}${row.count ? ` (${row.count})` : row.error ? ` - ${row.error}` : ''}`);
    await sleep(platformDelay(account.platform));
  }
  await appendSnapshots(rows);
  await writeRun(runId, rows);
  const allSnapshots = await readSnapshots();
  const matrix = await writeHistoryMatrix(allSnapshots);
  const latest = await writeLatest(allSnapshots, accounts);
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

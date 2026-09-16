import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from './utils.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const outputFile = path.join(ROOT, 'research', 'official_social_scan.json');
const orgs = JSON.parse(await fs.readFile(path.join(ROOT, 'research', 'organizations.json'), 'utf8'));
const requestedIds = new Set(process.argv.includes('--ids')
  ? String(process.argv[process.argv.indexOf('--ids') + 1] ?? '').split(',').map(value => Number(value.trim())).filter(Boolean)
  : []);

const platformPatterns = [
  ['YouTube', /(?:youtube\.com|youtu\.be)/i],
  ['X', /(?:x\.com|twitter\.com)/i],
  ['LinkedIn', /linkedin\.com/i],
  ['Instagram', /instagram\.com/i],
  ['Facebook', /facebook\.com/i],
];

const blockedPathParts = [
  '/share',
  '/sharer',
  '/intent/',
  '/search',
  '/hashtag/',
  '/posts/',
  '/status/',
  '/watch?',
  '/reel/',
  '/p/',
  '/login',
  '/tr',
  '/plugins/',
  '/events/',
];

function cleanUrl(raw, base) {
  try {
    const url = new URL(raw, base);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|mc_|ref|trk)/i.test(key)) url.searchParams.delete(key);
    }
    if (url.hostname === 'twitter.com') url.hostname = 'x.com';
    url.hostname = url.hostname.replace(/^m\./, 'www.');
    return url.toString();
  } catch {
    return '';
  }
}

function likelyProfile(urlText) {
  if (!urlText) return false;
  const lower = urlText.toLowerCase();
  return !blockedPathParts.some(part => lower.includes(part));
}

function platformFor(url) {
  return platformPatterns.find(([, pattern]) => pattern.test(url))?.[0] ?? '';
}

function handleFor(platform, urlText) {
  const url = new URL(urlText);
  const parts = url.pathname.split('/').filter(Boolean);
  if (platform === 'YouTube') {
    if (parts[0]?.startsWith('@')) return parts[0];
    if (['channel', 'c', 'user'].includes(parts[0])) return `${parts[0]}/${parts[1] ?? ''}`.replace(/\/$/, '');
    return parts[0] ?? '';
  }
  if (platform === 'LinkedIn') {
    if (['company', 'school', 'showcase'].includes(parts[0])) return `${parts[0]}/${parts[1] ?? ''}`.replace(/\/$/, '');
    return parts.join('/');
  }
  if (platform === 'Facebook') {
    return parts[0] ?? '';
  }
  if (platform === 'Instagram') {
    return parts[0] ?? '';
  }
  if (platform === 'X') {
    return parts[0] ?? '';
  }
  return parts.join('/');
}

function extractSocialLinks(html, base) {
  const links = new Map();
  const hrefs = [...html.matchAll(/\bhref=["']([^"']+)["']/gi)].map(match => match[1]);
  for (const href of hrefs) {
    const url = cleanUrl(href, base);
    const platform = platformFor(url);
    if (!platform || !likelyProfile(url)) continue;
    const handle = handleFor(platform, url);
    if (!handle || /^(home|pages|groups|share|sharer|company)$/i.test(handle)) continue;
    const existing = links.get(platform);
    if (!existing || url.length < existing.url.length) {
      links.set(platform, { platform, url, handle });
    }
  }
  return [...links.values()];
}

async function fetchHtml(url) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(25000),
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      'accept-language': 'en-US,en;q=0.9',
    },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return { html: await response.text(), finalUrl: response.url, method: 'fetch' };
}

async function renderHtml(browser, url) {
  const page = await browser.newPage({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
    locale: 'en-US',
  });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 35000 });
    await page.waitForTimeout(2500);
    const hrefs = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => node.href));
    const html = hrefs.map(href => `<a href="${href}"></a>`).join('\n') + '\n' + await page.content();
    return { html, finalUrl: page.url(), method: 'playwright' };
  } finally {
    await page.close();
  }
}

const browser = await chromium.launch({ headless: true });
const results = [];
try {
  const targets = requestedIds.size ? orgs.filter(org => requestedIds.has(org.id)) : orgs;
  for (const [index, org] of targets.entries()) {
    process.stdout.write(`${index + 1}/${targets.length} ${org.id} ${org.name} ... `);
    let page;
    let error = '';
    try {
      page = await fetchHtml(org.url);
    } catch (fetchError) {
      error = fetchError.message;
      try {
        page = await renderHtml(browser, org.url);
        error = '';
      } catch (renderError) {
        error = `${error}; ${renderError.message}`;
      }
    }
    const links = page ? extractSocialLinks(page.html, page.finalUrl) : [];
    results.push({
      id: org.id,
      name: org.name,
      website: org.url,
      final_url: page?.finalUrl ?? '',
      method: page?.method ?? '',
      links,
      error,
    });
    console.log(`${links.length} links${error ? ` (${error})` : ''}`);
  }
} finally {
  await browser.close();
}

await fs.writeFile(outputFile, JSON.stringify({
  generated_at: new Date().toISOString(),
  results,
}, null, 2), 'utf8');

const counts = {};
for (const result of results) {
  for (const link of result.links) counts[link.platform] = (counts[link.platform] ?? 0) + 1;
}
console.log(JSON.stringify({ outputFile, organizations: results.length, counts }, null, 2));

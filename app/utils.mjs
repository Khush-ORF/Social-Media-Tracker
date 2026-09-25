import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT = process.env.TRACKER_DATA_ROOT ? path.resolve(process.env.TRACKER_DATA_ROOT) : APP_ROOT;
export const ACCOUNTS_FILE = path.join(ROOT, 'accounts.csv');
export const DATA_DIR = path.join(ROOT, 'data');
export const RUNS_DIR = path.join(DATA_DIR, 'runs');
export const SNAPSHOTS_CSV = path.join(DATA_DIR, 'snapshots.csv');
export const HISTORY_MATRIX_CSV = path.join(DATA_DIR, 'history_matrix.csv');
export const LATEST_JSON = path.join(DATA_DIR, 'latest.json');
export const PLATFORMS = ['YouTube', 'X', 'LinkedIn', 'Instagram', 'Facebook'];

export const SNAPSHOT_COLUMNS = [
  'run_id',
  'id',
  'name',
  'website',
  'platform',
  'handle',
  'profile_url',
  'metric_label',
  'count',
  'raw_display_text',
  'count_precision',
  'status',
  'error',
  'source_url',
  'captured_at',
  'fetch_method',
  'notes',
];

export async function ensureDataDirs() {
  await fs.mkdir(RUNS_DIR, { recursive: true });
}

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header = [], ...body] = rows.filter(values => values.some(value => String(value).trim() !== ''));
  return body.map(values => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])));
}

export function toCsv(rows, columns) {
  const quote = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [columns.join(','), ...rows.map(row => columns.map(column => quote(row[column])).join(','))].join('\r\n') + '\r\n';
}

const ACCOUNT_PLATFORMS = ['Facebook', 'LinkedIn', 'X', 'Instagram', 'YouTube'];
export const ACCOUNT_COLUMNS = ['Name', 'Website', 'Facebook', 'LinkedIn', 'X', 'Instagram', 'Youtube'];

function accountId(name, platform) {
  const slug = String(name).normalize('NFKD').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
  return `${slug || 'account'}-${platform.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

function profileUrl(value, platform) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  const handle = raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  const bases = {
    Facebook: 'https://www.facebook.com/',
    LinkedIn: 'https://www.linkedin.com/company/',
    X: 'https://x.com/',
    Instagram: 'https://www.instagram.com/',
    YouTube: 'https://www.youtube.com/@',
  };
  if (platform === 'YouTube' && /^UC[\w-]{20,}$/i.test(handle)) return `https://www.youtube.com/channel/${handle}`;
  if (platform === 'YouTube' && /^(user|channel|c)\//i.test(handle)) return `https://www.youtube.com/${handle}`;
  return `${bases[platform]}${handle}`;
}

export async function readAccounts() {
  await ensureAccountsFormat();
  const text = await fs.readFile(ACCOUNTS_FILE, 'utf8');
  const sourceRows = parseCsv(text);
  return sourceRows.flatMap(row => ACCOUNT_PLATFORMS.flatMap(platform => {
    const url = profileUrl(row[platform] ?? row[platform === 'YouTube' ? 'Youtube' : platform], platform);
    if (!url) return [];
    const handle = url.replace(/\/$/, '').split('/').at(-1).replace(/^@/, '');
    return [{
      id: accountId(row.Name, platform), name: String(row.Name ?? '').trim(), website: String(row.Website ?? '').trim(),
      platform, handle, profile_url: url, active: true, notes: '',
    }];
  }));
}

function accountField(row, field) {
  const key = Object.keys(row).find(value => value.trim().toLowerCase() === field.toLowerCase());
  return key ? String(row[key] ?? '').trim() : '';
}

function canonicalAccountRows(rows) {
  const legacy = rows.length && Object.keys(rows[0]).some(key => key.trim().toLowerCase() === 'platform');
  if (!legacy) return rows.map(row => Object.fromEntries(ACCOUNT_COLUMNS.map(column => [column, accountField(row, column === 'Youtube' ? 'youtube' : column)])));

  const groups = new Map();
  for (const row of rows) {
    if (accountField(row, 'active') && !/^(true|yes|1)$/i.test(accountField(row, 'active'))) continue;
    const name = accountField(row, 'name');
    const website = accountField(row, 'website');
    const platform = normalizePlatform(accountField(row, 'platform'));
    if (!name || !ACCOUNT_PLATFORMS.includes(platform)) continue;
    const key = `${name}\u0000${website}`;
    if (!groups.has(key)) groups.set(key, Object.fromEntries(ACCOUNT_COLUMNS.map(column => [column, ''])));
    const group = groups.get(key);
    group.Name = name;
    group.Website ||= website;
    const column = platform === 'YouTube' ? 'Youtube' : platform;
    const value = accountField(row, 'profile_url') || accountField(row, 'handle');
    if (!group[column] && value) group[column] = profileUrl(value, platform);
  }
  return [...groups.values()];
}

export async function readAccountRows() {
  await ensureAccountsFormat();
  return parseCsv(await fs.readFile(ACCOUNTS_FILE, 'utf8'));
}

export async function ensureAccountsFormat() {
  let source;
  try { source = await fs.readFile(ACCOUNTS_FILE, 'utf8'); } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  const parsed = parseCsv(source);
  const legacy = parsed.length && Object.keys(parsed[0]).some(key => key.trim().toLowerCase() === 'platform');
  const header = source.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0].split(',').map(value => value.trim());
  if (!legacy && header.length === ACCOUNT_COLUMNS.length && header.every((value, index) => value === ACCOUNT_COLUMNS[index])) return;

  const converted = canonicalAccountRows(parsed);
  const backupBase = `${ACCOUNTS_FILE}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  let backup = backupBase;
  for (let suffix = 1; await fs.access(backup).then(() => true, () => false); suffix++) backup = `${backupBase}-${suffix}`;
  await fs.copyFile(ACCOUNTS_FILE, backup);
  const temporary = `${ACCOUNTS_FILE}.migrating`;
  await fs.writeFile(temporary, toCsv(converted, ACCOUNT_COLUMNS), 'utf8');
  const validation = parseCsv(await fs.readFile(temporary, 'utf8'));
  if (validation.length !== converted.length || validation.some(row => !row.Name)) {
    await fs.rm(temporary, { force: true });
    throw new Error('Account CSV migration validation failed; the original file was preserved.');
  }
  await fs.rename(temporary, ACCOUNTS_FILE);
}

export async function writeAccountRows(rows) {
  const normalized = rows.map(row => Object.fromEntries(ACCOUNT_COLUMNS.map(column => {
    const value = String(row[column] ?? row[column.toLowerCase()] ?? '').trim();
    if (value.length > 2000) throw new Error(`${column} values must be 2,000 characters or fewer.`);
    return [column, value];
  }))).filter(row => row.Name);
  const temporary = `${ACCOUNTS_FILE}.saving`;
  await fs.writeFile(temporary, toCsv(normalized, ACCOUNT_COLUMNS), 'utf8');
  const validation = parseCsv(await fs.readFile(temporary, 'utf8'));
  if (validation.length !== normalized.length || validation.some(row => !row.Name)) {
    await fs.rm(temporary, { force: true });
    throw new Error('Account CSV validation failed; existing records were not changed.');
  }
  try {
    await fs.copyFile(ACCOUNTS_FILE, `${ACCOUNTS_FILE}.backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.rename(temporary, ACCOUNTS_FILE);
  return normalized;
}

export function organizationId(row) {
  return Buffer.from(`${String(row.name ?? row.Name ?? '').trim()}\u0000${String(row.website ?? row.Website ?? '').trim()}`).toString('base64url');
}

export function normalizePlatform(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'twitter' || text === 'x.com') return 'X';
  if (text === 'youtube' || text === 'yt') return 'YouTube';
  if (text === 'linkedin' || text === 'linked in') return 'LinkedIn';
  if (text === 'instagram' || text === 'insta') return 'Instagram';
  if (text === 'facebook' || text === 'fb') return 'Facebook';
  return String(value ?? '').trim();
}

export function parseCompactNumber(raw) {
  const source = String(raw ?? '').trim();
  const normalized = source
    .replace(/\u00a0/g, ' ')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
    .toUpperCase();
  const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)(K|M|B)?$/);
  if (!match) return null;
  const scale = { K: 1e3, M: 1e6, B: 1e9 }[match[2]] ?? 1;
  return {
    count: Math.round(Number(match[1]) * scale),
    raw_display_text: source,
    count_precision: scale === 1 ? 'exact_public' : 'rounded_public',
  };
}

export async function readSnapshots() {
  try {
    return parseCsv(await fs.readFile(SNAPSHOTS_CSV, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

export async function appendSnapshots(rows) {
  await ensureDataDirs();
  let existing = '';
  try {
    existing = await fs.readFile(SNAPSHOTS_CSV, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const body = rows.map(row => SNAPSHOT_COLUMNS.map(column => {
    const text = String(row[column] ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }).join(',')).join('\r\n') + '\r\n';
  const expectedHeader = SNAPSHOT_COLUMNS.join(',');
  const currentHeader = existing.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0];
  if (existing && currentHeader === expectedHeader) {
    await fs.appendFile(SNAPSHOTS_CSV, body, 'utf8');
  } else if (existing) {
    const previousRows = parseCsv(existing);
    await fs.writeFile(SNAPSHOTS_CSV, toCsv([...previousRows, ...rows], SNAPSHOT_COLUMNS), 'utf8');
  } else {
    await fs.writeFile(SNAPSHOTS_CSV, expectedHeader + '\r\n' + body, 'utf8');
  }
}

export async function writeRun(runId, rows) {
  await ensureDataDirs();
  await fs.writeFile(path.join(RUNS_DIR, `${runId}.json`), JSON.stringify(rows, null, 2), 'utf8');
}

export function buildLatest(allRows, accounts = null) {
  const allowedIds = accounts ? new Set(accounts.map(account => account.id)) : null;
  const allowedNames = accounts ? new Set(accounts.map(account => `${account.name}\u0000${account.platform}`)) : null;
  const latest = new Map();
  for (const row of allRows) {
    if (allowedIds && !allowedIds.has(row.id) && !allowedNames.has(`${row.name}\u0000${row.platform}`)) continue;
    // Account row IDs can change when accounts.csv is migrated or regenerated.
    // The organization name and website are the stable identity used by the UI.
    const key = `${organizationId(row)}\u0000${row.platform}`;
    const current = latest.get(key);
    if (!current || String(row.captured_at) > String(current.captured_at)) latest.set(key, row);
  }
  return [...latest.values()].map(row => ({ ...row, org_id: organizationId(row) })).sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.platform).localeCompare(String(b.platform)));
}

export function latestRunAt(rows) {
  const latestRunId = rows.map(row => String(row.run_id || '')).sort().at(-1) || '';
  const latestRunRows = rows.filter(row => String(row.run_id || '') === latestRunId);
  return latestRunRows.reduce((earliest, row) => {
    const captured = String(row.captured_at || '');
    return captured && (!earliest || captured < earliest) ? captured : earliest;
  }, '');
}

export async function writeLatest(allRows, accounts = null) {
  const rows = buildLatest(allRows, accounts);
  const latestRunAtValue = latestRunAt(rows);
  await ensureDataDirs();
  await fs.writeFile(LATEST_JSON, JSON.stringify({ generated_at: new Date().toISOString(), latest_run_at: latestRunAtValue || null, rows }, null, 2), 'utf8');
  return rows;
}

function observationDate(row) {
  const captured = String(row.captured_at ?? '');
  return captured.includes('T') ? captured.slice(0, 10) : captured;
}

export function buildHistoryMatrix(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = [
      row.run_id,
      observationDate(row),
      row.name,
      row.website,
    ].join('\u0000');
    if (!grouped.has(key)) {
      grouped.set(key, {
        run_id: row.run_id,
        captured_date: observationDate(row),
        name: row.name,
        website: row.website,
        last_captured_at: '',
      });
    }
    const group = grouped.get(key);
    const platform = row.platform;
    if (!PLATFORMS.includes(platform)) continue;
    const prefix = platform.toLowerCase();
    group[`${prefix}_count`] = row.count;
    group[`${prefix}_raw`] = row.raw_display_text;
    group[`${prefix}_precision`] = row.count_precision;
    group[`${prefix}_status`] = row.status;
    group[`${prefix}_source`] = row.source_url || row.profile_url;
    if (String(row.captured_at) > String(group.last_captured_at)) group.last_captured_at = row.captured_at;
  }
  return [...grouped.values()].sort((a, b) =>
    String(a.captured_date).localeCompare(String(b.captured_date))
    || String(a.name).localeCompare(String(b.name))
    || String(a.run_id).localeCompare(String(b.run_id))
  );
}

export const HISTORY_MATRIX_COLUMNS = [
  'run_id',
  'captured_date',
  'name',
  'website',
  ...PLATFORMS.flatMap(platform => {
    const prefix = platform.toLowerCase();
    return [`${prefix}_count`, `${prefix}_raw`, `${prefix}_precision`, `${prefix}_status`, `${prefix}_source`];
  }),
  'last_captured_at',
];

export async function writeHistoryMatrix(rows) {
  await ensureDataDirs();
  const matrix = buildHistoryMatrix(rows);
  await fs.writeFile(HISTORY_MATRIX_CSV, toCsv(matrix, HISTORY_MATRIX_COLUMNS), 'utf8');
  return matrix;
}

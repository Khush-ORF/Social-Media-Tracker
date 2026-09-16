import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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

export async function readAccounts() {
  const text = await fs.readFile(ACCOUNTS_FILE, 'utf8');
  return parseCsv(text)
    .map(row => ({
      ...row,
      active: /^(true|yes|1)$/i.test(String(row.active ?? '').trim()),
      platform: normalizePlatform(row.platform),
      profile_url: String(row.profile_url ?? '').trim(),
    }))
    .filter(row => row.active && row.profile_url);
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

export async function writeLatest(allRows, accounts = null) {
  const allowedIds = accounts ? new Set(accounts.map(account => account.id)) : null;
  const latest = new Map();
  for (const row of allRows) {
    if (allowedIds && !allowedIds.has(row.id)) continue;
    const key = `${row.id}\u0000${row.platform}`;
    const current = latest.get(key);
    if (!current || String(row.captured_at) > String(current.captured_at)) latest.set(key, row);
  }
  const rows = [...latest.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.platform).localeCompare(String(b.platform)));
  await ensureDataDirs();
  await fs.writeFile(LATEST_JSON, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2), 'utf8');
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

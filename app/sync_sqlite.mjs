import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ACCOUNTS_FILE, DATA_DIR, ROOT, parseCsv, readSnapshots } from './utils.mjs';

const dbPath = path.join(DATA_DIR, 'follower_tracker.sqlite');
const schemaPath = path.join(ROOT, 'sql', 'schema.sql');

function sqlString(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInteger(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : 'NULL';
}

async function runSql(sql) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn('sqlite3', [dbPath], { cwd: ROOT });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `sqlite3 exited ${code}`));
    });
    child.stdin.end(sql);
  });
}

const schema = await fs.readFile(schemaPath, 'utf8');
const accounts = parseCsv(await fs.readFile(ACCOUNTS_FILE, 'utf8'));
const snapshots = await readSnapshots();

const accountSql = accounts.map(row => `INSERT INTO accounts (
  id, name, website, platform, handle, profile_url, active, notes
) VALUES (
  ${sqlString(row.id)}, ${sqlString(row.name)}, ${sqlString(row.website)}, ${sqlString(row.platform)},
  ${sqlString(row.handle)}, ${sqlString(row.profile_url)}, ${/^(true|yes|1)$/i.test(row.active) ? 1 : 0}, ${sqlString(row.notes)}
);`).join('\n');

const snapshotSql = snapshots.map(row => `INSERT OR IGNORE INTO snapshots (
  run_id, account_id, name, website, platform, handle, profile_url, metric_label, count,
  raw_display_text, count_precision, status, error, source_url, captured_at, fetch_method, notes
) VALUES (
  ${sqlString(row.run_id)}, ${sqlString(row.id)}, ${sqlString(row.name)}, ${sqlString(row.website)},
  ${sqlString(row.platform)}, ${sqlString(row.handle)}, ${sqlString(row.profile_url)}, ${sqlString(row.metric_label)},
  ${sqlInteger(row.count)}, ${sqlString(row.raw_display_text)}, ${sqlString(row.count_precision)},
  ${sqlString(row.status)}, ${sqlString(row.error)}, ${sqlString(row.source_url)}, ${sqlString(row.captured_at)},
  ${sqlString(row.fetch_method)}, ${sqlString(row.notes)}
);`).join('\n');

await runSql(`${schema}
BEGIN;
DELETE FROM accounts;
${accountSql}
${snapshotSql}
COMMIT;
`);

console.log(JSON.stringify({
  database: dbPath,
  accounts: accounts.length,
  snapshots: snapshots.length,
}, null, 2));


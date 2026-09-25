import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DATA_DIR, ROOT, ensureDataDirs, readSnapshots } from './utils.mjs';
import { datasetTables } from './exports.mjs';

export const databasePath = path.join(DATA_DIR, 'follower_tracker.sqlite');

function sqlString(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sqlInteger(value) {
  if (value === undefined || value === null || value === '') return 'NULL';
  const number = Number(value);
  return Number.isFinite(number) ? String(Math.trunc(number)) : 'NULL';
}

function sqlIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function buildRunRows(snapshots) {
  const runs = new Map();
  for (const row of snapshots) {
    if (!runs.has(row.run_id)) runs.set(row.run_id, {
      run_id: row.run_id,
      started_at_ist: row.captured_at,
      finished_at_ist: row.captured_at,
      scope: 'all',
      platform: 'all',
      mode: row.fetch_method === 'playwright' ? 'complete' : 'hybrid',
      targets: 0,
      collected: 0,
      count_not_found: 0,
      failed: 0,
    });
    const run = runs.get(row.run_id);
    run.targets++;
    if (String(row.captured_at) < String(run.started_at_ist)) run.started_at_ist = row.captured_at;
    if (String(row.captured_at) > String(run.finished_at_ist)) run.finished_at_ist = row.captured_at;
    if (row.status === 'collected') run.collected++;
    else if (row.status === 'count_not_found') run.count_not_found++;
    else if (row.status === 'failed') run.failed++;
  }
  return [...runs.values()];
}

function buildSql(snapshots) {
  const tables = datasetTables(snapshots);
  const runRows = buildRunRows(snapshots);
  const dates = tables.flatMap(table => table.dates).sort();
  const statements = [
    'PRAGMA journal_mode = WAL;',
    'PRAGMA foreign_keys = ON;',
    'BEGIN;',
    'DROP TABLE IF EXISTS "Facebook";',
    'DROP TABLE IF EXISTS "LinkedIn";',
    'DROP TABLE IF EXISTS "X";',
    'DROP TABLE IF EXISTS "Instagram";',
    'DROP TABLE IF EXISTS "Youtube";',
    'DROP TABLE IF EXISTS snapshots;',
    'DROP TABLE IF EXISTS accounts;',
    'DROP TABLE IF EXISTS collection_runs;',
    'DROP TABLE IF EXISTS dataset_metadata;',
    `CREATE TABLE dataset_metadata (
      schema_version INTEGER NOT NULL,
      generated_at_ist TEXT NOT NULL,
      earliest_date TEXT,
      latest_date TEXT,
      source_file TEXT NOT NULL
    );`,
    `CREATE TABLE collection_runs (
      run_id TEXT PRIMARY KEY,
      started_at_ist TEXT NOT NULL,
      finished_at_ist TEXT NOT NULL,
      scope TEXT NOT NULL,
      platform TEXT NOT NULL,
      mode TEXT NOT NULL,
      targets INTEGER NOT NULL,
      collected INTEGER NOT NULL,
      count_not_found INTEGER NOT NULL,
      failed INTEGER NOT NULL
    );`,
  ];
  const earliestDate = dates[0] || '';
  const latestDate = dates.at(-1) || '';

  for (const table of tables) {
    const columns = [
      '"Name" TEXT NOT NULL',
      '"Website" TEXT',
      '"Social Media Name" TEXT',
      '"Time Collected (IST)" TEXT',
      ...table.dates.map(date => `${sqlIdentifier(date)} INTEGER`),
      '"Sources" TEXT',
    ];
    statements.push(`CREATE TABLE ${sqlIdentifier(table.tableName)} (${columns.join(', ')});`);
    for (const row of table.rows) {
      const values = [
        sqlString(row.Name),
        sqlString(row.Website),
        sqlString(row['Social Media Name']),
        sqlString(row['Time Collected (IST)']),
        ...table.dates.map(date => sqlInteger(row[date])),
        sqlString(row.Sources),
      ];
      statements.push(`INSERT INTO ${sqlIdentifier(table.tableName)} VALUES (${values.join(', ')});`);
    }
  }

  const nowIst = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'short', timeStyle: 'medium' }).format(new Date());
  statements.push(`INSERT INTO dataset_metadata VALUES (2, ${sqlString(nowIst)}, ${sqlString(earliestDate)}, ${sqlString(latestDate)}, 'data/snapshots.csv');`);
  for (const run of runRows) {
    statements.push(`INSERT INTO collection_runs VALUES (${sqlString(run.run_id)}, ${sqlString(run.started_at_ist)}, ${sqlString(run.finished_at_ist)}, ${sqlString(run.scope)}, ${sqlString(run.platform)}, ${sqlString(run.mode)}, ${run.targets}, ${run.collected}, ${run.count_not_found}, ${run.failed});`);
  }
  statements.push('COMMIT;');
  return statements.join('\n');
}

async function runWithSqliteCli(sql) {
  const command = process.env.SQLITE3_BIN || 'sqlite3';
  await new Promise((resolve, reject) => {
    const child = spawn(command, [databasePath], { cwd: ROOT, windowsHide: true });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(new Error(stderr || `sqlite3 exited ${code}`)));
    child.stdin.end(sql);
  });
}

async function preserveLegacyDatabase() {
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databasePath);
    const legacy = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name IN ('snapshots', 'accounts')").get());
    db.close();
    if (legacy) {
      const backup = `${databasePath}.legacy-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.copyFile(databasePath, backup);
    }
  } catch (error) {
    if (error.code !== 'ENOENT' && error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
  }
}

export async function syncDatabase() {
  await ensureDataDirs();
  const snapshots = await readSnapshots();
  await preserveLegacyDatabase();
  const sql = buildSql(snapshots);
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databasePath);
    try { db.exec(sql); } finally { db.close(); }
  } catch (error) {
    if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
    await runWithSqliteCli(sql);
  }
  return { database: databasePath, snapshots: snapshots.length, tables: datasetTables(snapshots).map(table => table.tableName) };
}

const result = await syncDatabase();
console.log(JSON.stringify(result, null, 2));

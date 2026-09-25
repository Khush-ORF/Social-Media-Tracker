-- Dataset metadata and collection audit tables are stable.
-- Platform tables are rebuilt by app/sync_sqlite.mjs because each collection
-- date becomes a typed, quoted YYYY-MM-DD count column.
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS dataset_metadata (
  schema_version INTEGER NOT NULL,
  generated_at_ist TEXT NOT NULL,
  earliest_date TEXT,
  latest_date TEXT,
  source_file TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_runs (
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
);

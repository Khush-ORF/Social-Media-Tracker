PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  website TEXT,
  platform TEXT NOT NULL,
  handle TEXT,
  profile_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS snapshots (
  run_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  platform TEXT NOT NULL,
  handle TEXT,
  profile_url TEXT,
  metric_label TEXT,
  count INTEGER,
  raw_display_text TEXT,
  count_precision TEXT,
  status TEXT NOT NULL,
  error TEXT,
  source_url TEXT,
  captured_at TEXT NOT NULL,
  fetch_method TEXT,
  notes TEXT,
  PRIMARY KEY (run_id, account_id, platform, captured_at)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_account_platform_time
ON snapshots(account_id, platform, captured_at);

CREATE INDEX IF NOT EXISTS idx_snapshots_platform_time
ON snapshots(platform, captured_at);


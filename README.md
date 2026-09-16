# Social Media Tracker

A zero-subscription social follower tracker for public institutional accounts.

This project tracks publicly visible follower/subscriber counts for think tank and policy organization accounts across:

- YouTube
- X
- LinkedIn
- Instagram
- Facebook

It is designed to run locally and on GitHub for free. The app keeps a historical dataset over time, exposes CSV/JSON exports, stores records in SQLite, and publishes a static dashboard with GitHub Pages.

## What This Does

The tracker uses a manually curated `accounts.csv` containing official or corroborated social media profile URLs. A collector visits each public profile page, extracts the visible follower/subscriber count where available, and appends the result to the historical dataset.

The dashboard displays the latest collected values in a matrix:

```text
Account | YouTube | X | LinkedIn | Instagram | Facebook | Last captured | Source
```

The raw history is stored in long format so every fetch is preserved:

```text
run_id, account, platform, count, status, source_url, captured_at
```

A generated history matrix is also available for spreadsheet use.

## Important Limitations

This project intentionally avoids paid APIs and business-account authentication.

That means:

- It only uses publicly visible account/profile pages.
- Scraping is best-effort and can break when platforms change markup.
- Some pages may block GitHub Actions or headless browsers.
- YouTube often exposes only rounded public subscriber counts, such as `2.06M`.
- Instagram sometimes exposes exact public follower counts in embedded page data.
- Facebook, LinkedIn, and X counts depend on what the public page exposes at fetch time.

The app records failures and missing counts instead of hiding them.

## Repository Structure

```text
accounts.csv                    Input account list
app/
  collect.mjs                   Collector CLI
  server.mjs                    Local dashboard server and API
  parsers.mjs                   Platform count parsers
  utils.mjs                     CSV, snapshot, matrix utilities
  build_accounts_from_profiles.mjs
  scan_official_social_links.mjs
  sync_sqlite.mjs               Sync CSV records into SQLite
  export_public_data.mjs        Export static dashboard data
data/
  snapshots.csv                 Raw historical records
  history_matrix.csv            Pivoted historical matrix
  latest.json                   Latest row per account/platform
  follower_tracker.sqlite       SQLite database
  runs/                         Per-run JSON files
public/
  index.html                    Dashboard
  app.js
  styles.css
  data/                         Static files for GitHub Pages
sql/
  schema.sql                    SQLite schema
.github/workflows/
  collect.yml                   Manual/monthly collection workflow
  pages.yml                     GitHub Pages deployment workflow
```

## Account List

The tracker reads `accounts.csv`.

Required columns:

```text
id,name,website,platform,handle,profile_url,active,notes
```

Current coverage:

```text
Total rows: 387
YouTube:   88
X:         79
LinkedIn:  94
Instagram: 60
Facebook:  66
```

LinkedIn coverage is complete for all 94 organizations. Other platform coverage reflects accounts found from existing verified profile evidence plus official website scans.

## Local Setup

Install dependencies:

```bash
npm install
```

Install Playwright browser binaries if needed:

```bash
npx playwright install chromium
```

Start the local dashboard:

```bash
npm start
```

Then open:

```text
http://localhost:4173
```

## Running Collection Locally

Run all platforms:

```bash
npm run collect
```

Run a single platform:

```bash
npm run collect:x
```

Or directly:

```bash
node app/collect.mjs --platform LinkedIn
node app/collect.mjs --platform Instagram
node app/collect.mjs --platform Facebook
node app/collect.mjs --platform YouTube
node app/collect.mjs --platform X
```

For local use, prefer one platform at a time. A full run currently covers hundreds of accounts and can take a while.

## Dashboard Fetch Button

The local dashboard has a `Run fetch now` button.

Locally, this starts a background collector job through the local server. The status line shows live progress while the job runs.

On GitHub Pages, the dashboard runs in static mode. Static mode cannot directly scrape platforms from the browser. Use GitHub Actions for collection.

## Data Files

### Raw History

```text
data/snapshots.csv
```

One row per account/platform/fetch.

This is the main audit log.

### Latest Snapshot

```text
data/latest.json
```

Latest row per account/platform for the dashboard.

### History Matrix

```text
data/history_matrix.csv
```

Pivoted historical format:

```text
run_id,captured_date,name,website,
youtube_count,youtube_raw,youtube_precision,youtube_status,youtube_source,
x_count,x_raw,x_precision,x_status,x_source,
linkedin_count,...
instagram_count,...
facebook_count,...
last_captured_at
```

### SQLite

```text
data/follower_tracker.sqlite
```

Tables:

- `accounts`
- `snapshots`

Sync CSV data into SQLite:

```bash
npm run sync:sqlite
```

Inspect locally:

```bash
sqlite3 data/follower_tracker.sqlite
```

Example queries:

```sql
SELECT platform, COUNT(*) FROM accounts GROUP BY platform;

SELECT platform, COUNT(*) FROM snapshots GROUP BY platform;

SELECT name, platform, count, status, captured_at
FROM snapshots
ORDER BY captured_at DESC
LIMIT 20;
```

## Static Export

GitHub Pages serves static files from `public/`.

Generate static dashboard data:

```bash
npm run export:public
```

Build everything needed for static deployment:

```bash
npm run build:static
```

This updates:

```text
public/data/latest.json
public/data/snapshots.json
public/data/snapshots.csv
public/data/history_matrix.csv
```

## GitHub Pages Deployment

The repository includes:

```text
.github/workflows/pages.yml
```

This workflow:

1. Installs Node.
2. Installs SQLite.
3. Runs `npm ci`.
4. Runs `npm run build:static`.
5. Deploys `public/` to GitHub Pages.

To enable Pages:

```text
GitHub repo → Settings → Pages → Source: GitHub Actions
```

## GitHub Actions Collection

The repository includes:

```text
.github/workflows/collect.yml
```

It supports:

- Manual collection from GitHub Actions.
- Scheduled monthly collection on the last UTC day of each month.

Manual run:

```text
GitHub repo → Actions → Collect Follower Counts → Run workflow
```

Optional platform input:

```text
YouTube
X
LinkedIn
Instagram
Facebook
```

If no platform is supplied, the workflow runs all platforms.

The scheduled workflow runs on the 28th-31st but only collects when tomorrow is the first day of a new month. This handles months that do not have a 31st.

After collection, the workflow commits updated files under:

```text
data/
public/data/
```

## Rebuilding `accounts.csv`

The account list is generated from:

- Existing verified profile evidence.
- Manual corrections for missing LinkedIn rows.
- Official website scan results.

Rebuild:

```bash
npm run build:accounts
```

Re-scan official websites for social links:

```bash
npm run scan:social
npm run build:accounts
```

The scan audit is saved at:

```text
research/official_social_scan.json
```

## Count Precision

Each collected row includes `count_precision`.

Possible values:

```text
exact_public
rounded_public
```

Examples:

- Instagram may expose `6615663`, recorded as `exact_public`.
- YouTube may expose `2.06M`, recorded as `rounded_public` and parsed as `2060000`.

The tracker preserves the original displayed value in `raw_display_text`.

## Recommended Workflow

For normal use:

1. Update `accounts.csv` if needed.
2. Run one platform locally to test:

   ```bash
   node app/collect.mjs --platform X
   ```

3. Sync/export:

   ```bash
   npm run build:static
   ```

4. Commit and push.
5. Use GitHub Actions for monthly collection.

## Notes on Cost

This project is designed for zero-dollar operation:

- GitHub repository: free
- GitHub Actions: free within account limits
- GitHub Pages: free
- SQLite: local file, free
- No paid APIs
- No paid scraping services

Reliability depends on public platform behavior.


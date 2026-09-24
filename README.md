# Social Media Tracker

A zero-subscription tracker for publicly visible follower and subscriber counts. It includes a Windows desktop app and a separate unattended server deployment.

The app tracks curated public accounts across YouTube, X, LinkedIn, Instagram, and Facebook. It stores every collection attempt in CSV and SQLite, shows a local dashboard, and exports spreadsheet-friendly files. It does not use paid APIs, paid scraping services, or business-account authentication.

## Download

Download the Windows x64 executable from:

https://github.com/Khush-ORF/Social-Media-Tracker/releases

The release is a portable `.exe`. Node.js, Playwright, the headless browser runtime, and SQLite support are bundled inside the app. Internet access is required when collecting fresh counts.

This release is unsigned, so Windows may show an unknown-publisher warning. Release assets include `SHA256SUMS.txt` for verification.

## Desktop Use

Run the executable to open the tracker dashboard.

The first launch copies the bundled account list and seed dataset into your Windows user data folder:

```text
%APPDATA%/Social Follower Tracker/records
```

Use the app menu:

- `File -> Open data folder` to inspect the records.
- `File -> Edit accounts.csv` to edit the tracked profiles.
- `File -> Export history matrix...` for the wide spreadsheet file.
- `File -> Export raw history...` for the full long-format audit log.

Click `Run fetch now` to collect fresh counts. You can run all platforms or one selected platform. Keep the app open until collection finishes. The dashboard reconnects to progress after reloads.

Failed or blocked pages remain missing in the latest table. The app does not substitute an older value for a failed fresh request.

## Data Model

Input file:

```text
accounts.csv
```

The current input format has one organization per row:

```text
Name,Website,Facebook,LinkedIn,X,Instagram,Youtube
```

Each social column accepts a full public profile URL or a platform handle. Blank cells mean that platform is not tracked for that organization. The reader still accepts the older internal per-platform format for existing installations.

Primary output files:

```text
data/snapshots.csv
data/history_matrix.csv
data/latest.json
data/follower_tracker.sqlite
data/runs/*.json
```

`snapshots.csv` is the audit log with one row per account, platform, and collection run. It preserves failures as rows.

`history_matrix.csv` is the spreadsheet-friendly wide format with platform columns for each organization and run. The dashboard's **Download CSV** link exports only the latest completed run. **Download Data Set** creates an `.xlsx` workbook with a separate platform sheet and one count column per observation date; source cells are clickable.

`latest.json` powers the dashboard.

`follower_tracker.sqlite` mirrors the CSV records into SQLite tables.

## Repository Structure

```text
.github/workflows/desktop-release.yml  Manual Windows release build
accounts.csv                           Curated account list
app/                                   Collector, parsers, local server, exports
data/                                  Seed history bundled into the app
desktop/                               Electron desktop wrapper and release scripts
public/                                Local dashboard UI
sql/schema.sql                         SQLite schema
package.json                           Local server/collector scripts
```

`deployment/` contains the independent server setup, database, start/stop, and month-end scheduling scripts. It uses SQLite and a lightweight local Node server.

## Local Development

Use Windows x64 and Node.js 24.

Install root dependencies:

```powershell
npm ci
npx playwright install --only-shell chromium
```

Run the local dashboard:

```powershell
npm start
```

Then open:

```text
http://127.0.0.1:4173
```

Run collection from the terminal:

```powershell
node app/collect.mjs --all --render --concurrency 4
```

Run one platform:

```powershell
node app/collect.mjs --platform X --render --concurrency 4
```

The plain `npm run collect` script uses the collector defaults. For best local completeness, use `--render`.

## Build The Desktop App

Install desktop dependencies:

```powershell
cd desktop
npm ci
```

Build the portable executable:

```powershell
npm run dist
```

The executable is written to:

```text
desktop/dist/
```

The current Electron and bundled Chromium executable is about 196 MB. It does not meet a 50 MB download or 100 MB installed-footprint target. Those limits require replacing the Electron/Chromium bundle with a thin WebView client and using an already-installed browser/runtime, or deploying the server app without a bundled desktop executable.

The release workflow now enforces both size limits and will stop before publishing while the current Electron build exceeds them.

## Server Deployment

See [deployment/README.md](deployment/README.md). On Windows, run `deployment/install-windows.bat` as administrator. On Linux or macOS, run `sh deployment/install-unix.sh`. Both set up SQLite, the local dashboard, and a daily month-end check that collects only on the last calendar day in Indian Standard Time.

For an unpacked test build:

```powershell
npm run pack
```

## Release Workflow

The only tracked GitHub workflow is:

```text
.github/workflows/desktop-release.yml
```

It can be run manually from GitHub Actions. It builds the Windows portable executable, smoke-tests the packaged app, writes a SHA-256 checksum, uploads build artifacts, and publishes a GitHub release using the version in `desktop/package.json`.

Before making a new public release:

1. Update `desktop/package.json` version.
2. Update `desktop/release-notes.md`.
3. Commit and push.
4. Run `Build Windows Desktop Release` from GitHub Actions.

## Limitations

This app reads public profile pages only.

- Some pages block automated or headless requests.
- Platform markup can change.
- YouTube often exposes rounded subscriber counts.
- Instagram, X, LinkedIn, and Facebook expose different levels of detail depending on the profile and request path.
- Personal LinkedIn/Facebook profiles are out of scope; organization pages are the target.

The tracker records what happened during each run instead of hiding failures.

## Cost

The desktop app is designed for zero-dollar operation:

- No paid APIs.
- No subscriptions.
- No hosted database.
- Local SQLite file.
- Local CSV exports.
- Local server scheduling via Task Scheduler or cron.

## Security Checks

Both the production dependency tree and desktop build dependency tree pass `npm audit` with zero reported vulnerabilities. The release workflow runs those audits and targeted ESLint rules for dynamic code execution patterns before building. The dashboard binds to localhost by default; the deployment instructions require an authenticated HTTPS reverse proxy before exposing it to a network.

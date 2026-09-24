# Social Media Tracker

A zero-subscription desktop tracker for publicly visible follower and subscriber counts.

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

Required columns:

```text
id,name,website,platform,handle,profile_url,active,notes
```

Primary output files:

```text
data/snapshots.csv
data/history_matrix.csv
data/latest.json
data/follower_tracker.sqlite
data/runs/*.json
```

`snapshots.csv` is the audit log with one row per account, platform, and collection run. It preserves failures as rows.

`history_matrix.csv` is the spreadsheet-friendly wide format with platform columns for each organization and run.

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

The repository is now focused on the downloadable desktop app. Old GitHub Pages, hosted scheduled collection, worker, and research scan artifacts have been removed from tracked source.

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

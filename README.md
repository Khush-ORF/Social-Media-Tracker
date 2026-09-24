# Social Media Tracker

A zero-subscription tracker for publicly visible follower and subscriber counts. It includes a Windows desktop app and a separate unattended server deployment.

The app tracks curated public accounts across YouTube, X, LinkedIn, Instagram, and Facebook. It stores every collection attempt in CSV and SQLite, shows a local dashboard, and exports spreadsheet-friendly files. It does not use paid APIs, paid scraping services, or business-account authentication.

## Download

Download the Windows x64 executable from:

https://github.com/Khush-ORF/Social-Media-Tracker/releases

The release is a self-extracting `.exe` (currently 12.35 MB) with a 53.91 MB application payload. It uses installed Windows components rather than bundling Chromium: Windows x64, .NET Framework 4.8, Microsoft Edge WebView2 Runtime, Node.js 24+, and Microsoft Edge for rendered collection are required. The app and its JavaScript dependencies are bundled; internet access is required to collect fresh counts.

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
desktop/lightweight/                   Native WebView desktop host and self-extracting launcher
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

On Windows, install the .NET 10 SDK, .NET Framework 4.8 targeting pack, and Node.js 24+. Then from the repository root run:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/lightweight/build.ps1
```

The build restores the pinned WebView2 package, audits NuGet dependencies, embeds the runtime and account/data seed, and enforces a download below 50 MB and extracted app below 100 MB. The current measured sizes are 12.35 MB and 53.91 MB respectively. Output is `desktop/dist/Social-Follower-Tracker-0.3.0-Windows-x64.exe`.

## Server Deployment

See [deployment/README.md](deployment/README.md). On Windows, run `deployment/install-windows.bat` as administrator. On Linux or macOS, run `sh deployment/install-unix.sh`. Both set up SQLite, the local dashboard, and a daily month-end check that collects only on the last calendar day in Indian Standard Time.

## Release Workflow

The only tracked GitHub workflow is:

```text
.github/workflows/desktop-release.yml
```

It can be run manually from GitHub Actions. It builds the lightweight Windows executable, smoke-tests extraction and dashboard startup, enforces both size limits, writes a SHA-256 checksum, uploads the artifact, and publishes a GitHub release using the version in `desktop/package.json`.

Before making a new public release:

1. Update the version in `desktop/package.json` and `desktop/lightweight/build.ps1`/C# launchers together.
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

The production Node dependency tree is checked with `npm audit`; the desktop workflow also runs targeted ESLint checks, audits the pinned .NET/WebView2 dependency tree, and tests the packaged executable before release. The dashboard binds to localhost by default; the deployment instructions require an authenticated HTTPS reverse proxy before exposing it to a network.

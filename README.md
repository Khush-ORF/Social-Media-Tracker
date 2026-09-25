# Social Media Tracker

A zero-subscription tracker for publicly visible follower and subscriber counts. It includes a Windows desktop app and a separate unattended server deployment.

The app tracks curated public accounts across YouTube, X, LinkedIn, Instagram, and Facebook. It stores every collection attempt in CSV and SQLite, shows a local dashboard, and exports spreadsheet-friendly files. It does not use paid APIs, paid scraping services, or business-account authentication.

## Download

Download the Windows x64 setup installer from:

https://github.com/Khush-ORF/Social-Media-Tracker/releases

Run `Social-Follower-Tracker-1.0.0-Windows-x64-Setup.exe` to open the NSIS setup wizard. It shows progress, lets you choose the installation folder, and creates Start Menu and desktop shortcuts. The app includes Electron and its own Node.js runtime. No separate Node.js or WebView2 installation is required. Internet access is needed to collect fresh counts.

Setup offers automatic browser selection, a preference for Microsoft Edge or Google Chrome with the other as a fallback when unavailable, or **Full support**, which downloads and configures Playwright Chromium during installation. A failed optional download leaves automatic Edge/Chrome selection available.

The 1.0.0 installer is 119.2 MiB. The base installation is approximately 388.6 MiB; Full support is approximately 1,089.7 MiB including downloaded browsers. **Reducing installer and installed size is being worked on.** The earlier 50 MB installer / 100 MB installed targets are not met by this Electron release.

This release is unsigned, so Windows may show an unknown-publisher warning. Release assets include `SHA256SUMS.txt` for verification.

## Desktop Use

After setup completes, launch Social Follower Tracker from the Start Menu or desktop shortcut.

The first launch copies two demo organizations, OpenAI and GitHub, into your Windows user data folder. New installations have no collected history. Existing records are preserved on updates:

```text
%APPDATA%/Social Follower Tracker/records
```

Use the app menu:

- `File -> Open data folder` to inspect the records.
- `File -> Edit accounts.csv` to edit the tracked profiles.

The dashboard lets you add organizations, edit profile URLs or handles, select organizations, and save the wide-format `accounts.csv`. Choose **Entire accounts.csv** or **Selected organizations** before fetching. The selected organization set also filters the latest table and full history table. Choose **Hybrid automatic** for the fast static-first path, **Completeness mode** for browser fallback on more difficult pages, or **Static-only diagnostic** when you want to avoid browser rendering. If the records folder contains the older one-row-per-platform CSV, startup saves a dated backup and converts it to the current wide format.

Use **Current CSV** for the latest completed run, **Dataset Excel** for the full date-column workbook, and **SQLite** for the database shaped like the workbook. **Clear records** opens run-level deletion and full-database deletion; a timestamped backup is created before either operation. The desktop dashboard also has a paste importer for adding profile URLs or handles.

Click `Fetch now` to collect fresh counts. You can run all platforms or one selected platform. Keep the app open until collection finishes. The dashboard reconnects to progress after reloads.

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
accounts.csv                           Demo account list; edit for your own use
app/                                   Collector, parsers, local server, exports
data/                                  Local generated records (ignored by Git)
desktop/                               Electron app, NSIS options, release scripts
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
node app/collect.mjs --all --concurrency 16
```

Run one platform:

```powershell
node app/collect.mjs --platform X --concurrency 16
```

The plain `npm run collect` command tries static requests first and permits browser fallback. Use `--static-only` to disable rendering or `--mode complete` for more patient collection. Direct Node runs need a Playwright browser or installed Edge/Chrome for rendering; the desktop installer configures that choice for you.

## Build The Desktop App

On Windows, install Node.js 24, install the repository dependencies, and then build:

```powershell
npm ci
cd desktop
npm ci
npm run dist
```

The build creates `desktop/dist-electron/Social-Follower-Tracker-1.0.0-Windows-x64-Setup.exe`. Electron Builder downloads its NSIS build tools. The default `start` and `dist` scripts in `desktop/` use Electron; `start:electron` and `dist:electron` are equivalent explicit commands. No .NET SDK is required.

Packaging checks reject missing runtime dependencies, dependencies resolving outside the package, non-demo account files, and bundled collected records. Generated builds, installers, caches, and local records are excluded from Git. Release downloads are attached to GitHub Releases rather than committed as binaries.

## Server Deployment

See [deployment/README.md](deployment/README.md). On Windows, run `deployment/install-windows.bat` as administrator. On Linux or macOS, run `sh deployment/install-unix.sh`. Both set up SQLite, the local dashboard, and a daily month-end check that collects only on the last calendar day in Indian Standard Time.

## Release Workflow

The only tracked GitHub workflow is:

```text
.github/workflows/desktop-release.yml
```

It can be run manually from GitHub Actions. It builds the Electron NSIS installer, silently installs it, checks a fresh demo profile, uninstalls the test app, records package size, writes a SHA-256 checksum, and uploads an artifact. Select the workflow's publish option to publish a release from `main`. Build-only runs do not modify releases. Live collection is not required by the CI smoke test because public-platform availability varies across runners.

Before making a new public release:

1. Update the version in both package manifests and lockfiles.
2. Update `desktop/release-notes.md` and record verification results.
3. Commit and push the tested source to `main`.
4. Run `Build Windows Desktop Release` from GitHub Actions, selecting publish only when ready.

For a locally verified build, put its checksum in `desktop/dist-electron/SHA256SUMS.txt`, then run `node desktop/publish-release.mjs --publish`. The helper requires GitHub credentials, a clean tracked worktree, and a source commit matching remote `main`. It uploads assets to a draft before publishing and refuses to overwrite a published version. Credentials are never printed.

See [the detailed 0.4.0 to 1.0.0 changelog](desktop/release-notes.md) and [verification report](desktop/VERIFICATION.md). A previous QA upgrade failed removing the old app; uninstalling it separately and installing fresh succeeded. Back up records before upgrading; in-place upgrades need further verification.

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

The root and desktop dependency trees are checked with `npm audit`; the workflow also runs targeted ESLint checks and tests the installed Electron app. The dashboard binds to localhost by default; deployment instructions require an authenticated HTTPS reverse proxy before network exposure. A clean audit means no known advisory was reported at that time, not a guarantee against undiscovered vulnerabilities.

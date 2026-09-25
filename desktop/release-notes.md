# Social Follower Tracker 1.0.0

Version 1.0.0 is a major desktop and dataset workflow update since **0.4.0**. Download **Social-Follower-Tracker-1.0.0-Windows-x64-Setup.exe** for Windows 10/11 x64. The standard per-user NSIS installer offers directory selection, progress, and desktop/Start Menu shortcuts.

## Detailed Changelog Since 0.4.0

### Installation and Browser Support

- Retains the standalone Electron window and bundled Node.js runtime. No separate Node.js, .NET SDK, or WebView2 installation is required.
- Adds a browser-selection page: automatic installed-browser selection, prefer Edge, prefer Chrome, or Full support.
- Edge and Chrome preferences use the other installed browser when the preferred browser is absent.
- Full support downloads Playwright Chromium and supporting files during setup and configures the app to use them.
- Setup waits for the optional download and verifies a Chromium executable exists. Download failure leaves automatic Edge/Chrome selection available and reports the failure.
- Fixes missing collector dependencies in packaged installations by explicitly including runtime modules. Build checks verify dependencies resolve inside the package and the browser-install CLI can run.
- Makes Electron NSIS the default desktop build and release workflow; removes obsolete experimental WebView2 build paths from the active codebase.

### Fresh Installation and Account Files

- Replaces the 0.4.0 seeded research account list and historical dataset with two demo organizations, OpenAI and GitHub, and an empty history.
- Excludes research records, cached exports, test profiles, and build output from the installer and current repository tree. Existing user records remain outside the installation folder.
- Uses one organization per `accounts.csv` row: `Name,Website,Facebook,LinkedIn,X,Instagram,Youtube`.
- Adds migration of older per-platform account files with a dated backup.
- Accepts URLs or handles, including YouTube @handles, channel IDs, and legacy channel/user paths.
- Fixes blank fields displaying or saving as `#`; optional website and social fields may remain empty.

### Dashboard and Account Editing

- Introduces the revised dashboard and a startup choice screen for collecting, editing accounts, and viewing saved records.
- Keeps the startup screen visible until an action is selected instead of automatically opening the dashboard.
- Gives the account editor its own full-page view, with add/edit/save actions and a paste-import workflow.
- Makes the organization side panel searchable and toggleable.
- Applies organization selection to both collection targets and latest/history displays.
- Adds whole-file and selected-organization collection scope, platform selection, and a target summary.
- Revises search, status, platform, date, and missing-record filters.
- Restores compact platform source links and clarifies labels and timestamps.
- Improves long-field editing with expanding fields and full-value tooltips.
- Fixes new organizations disappearing after earlier runs. Accounts without data remain visible as missing records.
- Fixes collection controls staying disabled after completion or errors, including Electron workflow regressions.

### Collection and Freshness

- Adds Hybrid automatic, Completeness, and Static-only diagnostic modes.
- Uses static requests first, platform-specific concurrency, and rendering where appropriate. Completeness mode uses more patient retries/timeouts with lower concurrency.
- Supports installed Edge/Chrome rendering and optional Playwright rendering.
- Updates YouTube parsing for the current subscriber-label format.
- Refreshes the dashboard automatically after collection, including the first run in a new profile.
- Corrects latest-run reconstruction and displayed timestamps after reload or a new browser session.
- Retains each failed attempt with its status/error. Older successful counts are not substituted into fresh failed results.
- Displays precision information where available; rounded public YouTube counts are not claimed to be exact.

### CSV, Excel, SQLite, and Records

- Current-run CSV exports only the latest completed run, with Name, Website, IST collection time, the five platforms, and a compact Source hyperlink formula.
- Historical Excel exports contain Facebook, LinkedIn, X, Instagram, and Youtube sheets, with organization, website, social profile name, IST collection time, chronological `YYYY-MM-DD` date columns, and clickable sources.
- Rebuilds Excel column/header construction to address workbook corruption/recovery reports. Generated workbooks passed an ExcelJS reload check.
- Uses the latest observation per organization/platform/IST date in the daily workbook; the raw audit CSV retains individual attempts.
- Reshapes SQLite into five platform tables matching the date-column workbook, with run and metadata tables. Downloads use a consistent database copy.
- Adds run summaries, selected-run deletion, and entire-dataset deletion, with an automatic backup before deletion. Account definitions are retained.
- Rebuilds derived history, latest results, and database output after record changes.

### Server and Release Maintenance

- Retains separate Windows/Unix server setup, dashboard start/stop scripts, SQLite storage, and last-calendar-day collection checks in IST.
- Updates deployment documentation for wide account files, Excel/SQLite exports, and record deletion.
- Excludes generated records, caches, builds, and installers from source control. Installers are distributed as release assets.
- Adds installed Electron smoke tests, package-content checks, checksums, and draft-first release publishing.

## Size Reduction Is Being Worked On

**Reducing installer size and installed disk usage is actively being worked on.** This release uses the tested Electron runtime and does not meet the earlier under-50-MB installer / under-100-MB installed targets.

- Installer: **119.2 MiB** (124,968,924 bytes).
- Base installation: approximately **388.6 MiB**.
- Full support with downloaded browsers: approximately **1,089.7 MiB**.

Automatic Edge/Chrome selection avoids the additional collection-browser download. Electron's desktop runtime is still included.

## Verification and Known Limits

- Fresh installation outside the development repository passed, including the Full support download and an actual downloaded-browser launch.
- Installed-app tests passed for fresh startup, optional blanks, account creation, organization scope, collection controls, live YouTube collection, automatic refresh, and newly added accounts after a run.
- CSV, five-sheet Excel, and SQLite downloads passed programmatic checks. The final workbook was not opened in Microsoft Excel during this verification.
- Root and desktop dependency audits reported zero known vulnerabilities during this release preparation. This does not guarantee there are no undiscovered issues.
- The manual native-window visual pass was interrupted and not completed. Live collection was verified on YouTube, not every account on every platform.
- An upgrade over an earlier QA copy failed during old-version removal. Uninstalling that copy separately and installing fresh passed. In-place upgrades need further verification; back up records before upgrading.
- The installer is unsigned. Verify it with the attached SHA256SUMS.txt.
- Public collection remains best effort: rate limits, login walls, hidden metrics, and markup changes may leave results missing. No paid API or subscription is required; universal success and exact publicly rounded counts are not promised.

User records are in `%APPDATA%/Social Follower Tracker/records`, separate from application files. Keep the app open during collection; use the server deployment for unattended scheduling.

Source comparison: [v0.4.0...v1.0.0](https://github.com/Khush-ORF/Social-Media-Tracker/compare/v0.4.0...v1.0.0).

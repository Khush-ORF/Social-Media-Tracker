# Social Follower Tracker

Windows desktop app for collecting public follower counts from YouTube, LinkedIn, X, Instagram, and Facebook. Saves history locally and exports CSV, Excel, and SQLite. No paid APIs or subscriptions.

## Download

[Download the latest Windows x64 installer](https://github.com/Khush-ORF/Social-Media-Tracker/releases/latest).

Requires Windows 10/11 and internet access. Setup lets you choose the install folder and use Edge, Chrome, or download Playwright Chromium with **Full support**. No separate Node.js installation is needed.

Installer: **119.2 MiB**. Installed: approximately **389 MiB**, or **1.1 GiB** with Full support. **Size reduction is being worked on.** The installer is unsigned; checksums are included in the release.

## Use

1. Edit the demo accounts in the app; enter profile URLs or handles. Unused fields can stay blank.
2. Choose all or selected organizations, a platform, and a collection mode. Click **Fetch now** and keep the app open.
3. Export **Current CSV** for the latest run, **Dataset Excel** for history by platform/date, or **SQLite** for the database.

Account format, one organization per row:

```csv
Name,Website,Facebook,LinkedIn,X,Instagram,Youtube
```

Records are stored in `%APPDATA%/Social Follower Tracker/records`. **Clear records** deletes selected runs or the dataset after making a backup.

Blocked or unavailable counts stay missing; older data is never substituted. Public YouTube counts may be rounded.

## Build

Requires Windows x64 and Node.js 24. From the repository root:

```powershell
npm ci
cd desktop
npm ci
npm run dist
```

Installer output: `desktop/dist-electron/`. Use `npm start` inside `desktop/` to run the desktop app during development.

[Changelog](desktop/release-notes.md) · [Test results and known issues](desktop/VERIFICATION.md)

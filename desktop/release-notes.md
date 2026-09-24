## Windows Desktop App

Download **Social-Follower-Tracker-0.4.0-Windows-x64-Setup.exe** below and run it. The setup wizard shows installation progress and lets you choose the installation folder. It creates Start Menu and desktop shortcuts. Electron, Chromium, Node.js, Playwright, and the tracker are bundled; no separate runtime or browser installation is required. Internet access is required for collection.

- A desktop window with the account matrix, search, status filters, source links, history, and CSV exports.
- Fetch performs fresh public-page collection with browser rendering enabled. Failed requests stay missing; older counts are never substituted.
- Local CSV and SQLite records persist between launches and app upgrades. Use **File > Open data folder** to find or back them up.
- Use **File > Edit accounts.csv** to update tracked accounts while no collection is running.
- Bundles the current account list and collected historical dataset as first-launch seed data. Seed timestamps are displayed; use Fetch to obtain new observations.
- Includes 68 additional social accounts across 15 of the 16 newly requested think tanks. CIIS remains unverified. Corrected the Africa Center mapping and excluded Al Jazeera's parent-network LinkedIn profile from centre-level tracking.

Windows 10/11 x64. The per-user installer does not require administrator privileges. Uninstalling the app preserves tracker records in the user's application data folder. The installer is not code-signed, so Windows may display an unknown-publisher warning. SHA256SUMS.txt provides the installer checksum.

Public scraping is best-effort: blocked pages, unavailable profiles, and hidden counts remain visible as missing results. YouTube subscriber counts may be rounded. Keep the application open until collection finishes. Scheduling remains available through GitHub Actions; the desktop app does not run when closed.

# Server Deployment

This folder runs the same collector and local web server independently from the desktop wrapper. SQLite is the database; it is stored at `deployment/runtime/data/follower_tracker.sqlite`. SQLite needs no daemon or database credentials.

## Windows

1. Clone/download this repository to a stable folder.
2. Open an elevated PowerShell prompt in `deployment` and run:

   ```powershell
   .\install-windows.bat
   ```

The installer uses an existing Node 24 runtime or downloads and SHA-256 verifies the official portable Node 24 archive. It runs `npm ci`, installs Playwright's Chromium headless shell, initializes SQLite, and registers Windows scheduled tasks for the lightweight dashboard server at boot and the collector daily at 02:10. The collector checks the date in IST and exits immediately unless it is the last calendar day of the month. Logs are written under `deployment/runtime/logs`.

Open `http://127.0.0.1:4173`. Collection is available from the dashboard, and scheduled collection runs automatically. The machine must be online at the scheduled time.

To remove the scheduled tasks, run `uninstall-windows.bat` as administrator. Use `stop-server.bat` to stop the server until the next boot. Edit `deployment/runtime/accounts.csv` to change tracked profiles after installation.

## Linux and macOS

1. Clone/download this repository to a stable folder. `curl`, `tar`, and a SHA-256 utility are required if Node 24 is not already installed.
2. From the repository root, run:

   ```sh
   sh deployment/install-unix.sh
   ```

The script uses Node 24 if available or downloads and verifies an official Node 24 runtime, then installs npm dependencies and the headless browser. It initializes SQLite, starts the server at boot with cron, and schedules a daily 02:10 check. The collection runs only when that day is the final calendar day in `Asia/Kolkata` (IST). The server binds to `127.0.0.1:4173`; place an authenticated HTTPS reverse proxy in front of it before allowing network access.

Use `sh deployment/stop-server.sh` to stop the current server process. Edit `deployment/runtime/accounts.csv` to change tracked profiles after installation. Logs are in `deployment/runtime/logs`.

## Data and Downloads

- `accounts.csv` uses `Name,Website,Facebook,LinkedIn,X,Instagram,Youtube`, one organization per row.
- SQLite holds the structured account and snapshot tables.
- The dashboard's **Download CSV** exports the latest completed run only.
- **Download Data Set** creates an Excel workbook with one sheet per platform, all observation dates, and clickable source links.
- **SQLite** downloads a database copy.

The scheduled task keeps no persistent collector process running. It starts Node for the month-end job, writes the run to CSV/JSON and SQLite, refreshes the database, then exits. The dashboard server is a small Node HTTP process.

Public profile collection is best effort. Platforms may block automated requests or hide follower counts; those outcomes remain recorded as missing or failed rows. No paid API or subscription is used.

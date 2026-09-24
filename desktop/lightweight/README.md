# Lightweight Windows App

This is the Windows desktop build used for the 50 MB download and 100 MB installed-app limits. It is a self-extracting `.exe` with a small native WinForms/WebView2 shell and the tracker runtime. It uses the Windows-shared WebView2 Runtime instead of shipping Electron and Chromium.

## Requirements

- Windows 10 or 11 x64 with .NET Framework 4.8 and Microsoft Edge WebView2 Runtime (normally present on current Windows installations).
- Node.js 24 or later on `PATH`.
- Microsoft Edge installed for rendered collection. Without it, static requests still run and rendering failures are recorded.
- Internet access for collection.

These shared system prerequisites are not copied into the desktop app folder or its download. The tracker and its JavaScript dependencies are extracted to `%LOCALAPPDATA%/Social Follower Tracker/app/0.3.0`; records remain at `%APPDATA%/Social Follower Tracker/records`.

## Build

From the repository root in PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File desktop/lightweight/build.ps1
```

The script restores the pinned WebView2 SDK, audits NuGet packages, packages the production runtime and seed data, then fails if the resulting `.exe` is 50 MB or larger or the extracted app is 100 MB or larger. Output:

```text
desktop/dist/Social-Follower-Tracker-0.3.0-Windows-x64.exe
```

The app itself needs no administrator rights. On first launch it extracts its bundled files, starts the local collector server, and opens the dashboard in a native window.

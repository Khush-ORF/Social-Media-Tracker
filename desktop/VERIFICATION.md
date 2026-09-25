# Social Follower Tracker 1.0.0 - Installer Verification

Tested on Windows x64 on 2026-09-25.

Installer: `Social-Follower-Tracker-1.0.0-Windows-x64-Setup.exe`

SHA-256: `9d550c66392f3de3c938f6a0741571a0dd03e3d7121269db5be415730dcc7d03`

## Passed

- NSIS fresh installation outside the development repository, exit code 0.
- Full support downloaded Chromium, headless Chromium, and supporting browser files during setup; preference saved as `playwright`.
- Installed collector resolves its dependencies inside its own runtime directory.
- Downloaded Chromium launched headlessly and rendered a local test page.
- Fresh app profile started on the launch screen with two demo organizations and zero historical records.
- Editor added an organization using a YouTube handle with all optional fields blank.
- Organization selection and the scope, platform, and collection-mode controls retained changes.
- A live YouTube collection completed and the dashboard refreshed automatically.
- Collection controls remained enabled after the run.
- A second newly added organization appeared despite having no collected records.
- Blank optional fields remained blank after save.
- Historical Excel download reopened successfully with ExcelJS and contained the five expected platform sheets.
- Current-run CSV contained the newly collected organization.
- SQLite download returned a valid SQLite file header.
- Package content checks confirmed only demo accounts and no collected records or cached public exports.
- Root and desktop dependency audits reported zero known vulnerabilities during this build session.

## Sizes

- Installer: 124,968,924 bytes (119.2 MiB).
- Base installed app: approximately 388.6 MiB.
- Full installation including downloaded browsers: approximately 1,089.7 MiB.

This Electron build does not meet the earlier 50 MB installer / 100 MB installed target.

## Verification Limits

The manual native-window visual check was stopped by the user with Escape. Automated Electron workflow tests passed; a complete manual UI pass was not completed. The Excel workbook was parsed programmatically, not opened in Microsoft Excel during this final check. Live collection was verified on YouTube, not every profile on all five social platforms.

An upgrade attempt over an earlier QA installation failed during old-version removal. Explicitly uninstalling that QA copy succeeded, and the final fresh-install test then passed. In-place upgrades need additional verification.

The installer is unsigned. Existing user records remain separate from application files and are not included in the package.

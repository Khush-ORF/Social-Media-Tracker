#!/usr/bin/env sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname "$DEPLOY_DIR")
RUNTIME_DIR="$DEPLOY_DIR/runtime"
NODE_BIN=$(command -v node)
mkdir -p "$RUNTIME_DIR/logs"
[ -f "$RUNTIME_DIR/accounts.csv" ] || cp "$DEPLOY_DIR/accounts.csv" "$RUNTIME_DIR/accounts.csv"
printf '%s\n' "$NODE_BIN" > "$RUNTIME_DIR/node-path.txt"
cd "$REPO_ROOT"
npm ci
npx playwright install --only-shell chromium
TRACKER_DATA_ROOT="$RUNTIME_DIR" "$NODE_BIN" app/sync_sqlite.mjs

chmod +x "$DEPLOY_DIR/run-month-end.sh" "$DEPLOY_DIR/start-server.sh" "$DEPLOY_DIR/stop-server.sh"
CRON_LINES=$(crontab -l 2>/dev/null || true)
FILTERED=$(printf '%s\n' "$CRON_LINES" | grep -F -v "$DEPLOY_DIR/run-month-end.sh" | grep -F -v "$DEPLOY_DIR/start-server.sh" || true)
printf '%s\n' "$FILTERED" "10 2 * * * sh \"$DEPLOY_DIR/run-month-end.sh\"" "@reboot sh \"$DEPLOY_DIR/start-server.sh\"" | crontab -
"$DEPLOY_DIR/start-server.sh"
echo "Installed. Dashboard: http://127.0.0.1:4173"

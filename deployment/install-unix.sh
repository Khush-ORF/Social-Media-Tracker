#!/usr/bin/env sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname "$DEPLOY_DIR")
RUNTIME_DIR="$DEPLOY_DIR/runtime"
mkdir -p "$RUNTIME_DIR/logs"
[ -f "$RUNTIME_DIR/accounts.csv" ] || cp "$DEPLOY_DIR/accounts.csv" "$RUNTIME_DIR/accounts.csv"
NODE_MAJOR=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -ge 24 ] && command -v npm >/dev/null 2>&1 && command -v npx >/dev/null 2>&1; then
  NODE_BIN=$(command -v node)
  NPM_COMMAND=$(command -v npm)
  NPX_COMMAND=$(command -v npx)
else
  NODE_VERSION=v24.15.0
  OS=$(uname -s | tr '[:upper:]' '[:lower:]')
  ARCH=$(uname -m)
  case "$OS:$ARCH" in
    linux:x86_64) NODE_ARCH=linux-x64 ;;
    linux:aarch64|linux:arm64) NODE_ARCH=linux-arm64 ;;
    darwin:x86_64) NODE_ARCH=darwin-x64 ;;
    darwin:arm64) NODE_ARCH=darwin-arm64 ;;
    *) echo "Unsupported system for automatic Node.js setup: $OS $ARCH" >&2; exit 1 ;;
  esac
  NODE_ARCHIVE="node-$NODE_VERSION-$NODE_ARCH.tar.xz"
  NODE_URL="https://nodejs.org/dist/$NODE_VERSION/$NODE_ARCHIVE"
  curl -fsSL "$NODE_URL" -o "$RUNTIME_DIR/$NODE_ARCHIVE"
  curl -fsSL "https://nodejs.org/dist/$NODE_VERSION/SHASUMS256.txt" -o "$RUNTIME_DIR/SHASUMS256.txt"
  EXPECTED=$(awk -v file="$NODE_ARCHIVE" '$2 == file {print $1; exit}' "$RUNTIME_DIR/SHASUMS256.txt")
  if command -v sha256sum >/dev/null 2>&1; then ACTUAL=$(sha256sum "$RUNTIME_DIR/$NODE_ARCHIVE" | awk '{print $1}'); else ACTUAL=$(shasum -a 256 "$RUNTIME_DIR/$NODE_ARCHIVE" | awk '{print $1}'); fi
  [ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || { echo 'Node.js archive checksum validation failed.' >&2; exit 1; }
  mkdir -p "$RUNTIME_DIR/node"
  tar -xJf "$RUNTIME_DIR/$NODE_ARCHIVE" -C "$RUNTIME_DIR/node" --strip-components=1
  rm -f "$RUNTIME_DIR/$NODE_ARCHIVE" "$RUNTIME_DIR/SHASUMS256.txt"
  NODE_BIN="$RUNTIME_DIR/node/bin/node"
  NPM_COMMAND="$RUNTIME_DIR/node/bin/npm"
  NPX_COMMAND="$RUNTIME_DIR/node/bin/npx"
fi
export PATH="$(dirname "$NODE_BIN"):$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$RUNTIME_DIR/browsers"
printf '%s\n' "$NODE_BIN" > "$RUNTIME_DIR/node-path.txt"
cd "$REPO_ROOT"
"$NPM_COMMAND" ci
"$NPX_COMMAND" playwright install --only-shell chromium
TRACKER_DATA_ROOT="$RUNTIME_DIR" "$NODE_BIN" app/sync_sqlite.mjs

chmod +x "$DEPLOY_DIR/run-month-end.sh" "$DEPLOY_DIR/start-server.sh" "$DEPLOY_DIR/stop-server.sh"
CRON_LINES=$(crontab -l 2>/dev/null || true)
FILTERED=$(printf '%s\n' "$CRON_LINES" | grep -F -v "$DEPLOY_DIR/run-month-end.sh" | grep -F -v "$DEPLOY_DIR/start-server.sh" || true)
printf '%s\n' "$FILTERED" "10 2 * * * sh \"$DEPLOY_DIR/run-month-end.sh\"" "@reboot sh \"$DEPLOY_DIR/start-server.sh\"" | crontab -
"$DEPLOY_DIR/start-server.sh"
echo "Installed. Dashboard: http://127.0.0.1:4173"

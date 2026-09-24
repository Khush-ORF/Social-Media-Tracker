#!/usr/bin/env sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname "$DEPLOY_DIR")
RUNTIME_DIR="$DEPLOY_DIR/runtime"
NODE_BIN=$(cat "$RUNTIME_DIR/node-path.txt")
mkdir -p "$RUNTIME_DIR/logs"
if [ -f "$RUNTIME_DIR/server.pid" ] && kill -0 "$(cat "$RUNTIME_DIR/server.pid")" 2>/dev/null; then exit 0; fi
cd "$REPO_ROOT"
TRACKER_DATA_ROOT="$RUNTIME_DIR" HOST=127.0.0.1 PORT=4173 nohup "$NODE_BIN" app/server.mjs >> "$RUNTIME_DIR/logs/server.log" 2>&1 &
echo $! > "$RUNTIME_DIR/server.pid"

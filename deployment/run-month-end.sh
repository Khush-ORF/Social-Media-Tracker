#!/usr/bin/env sh
set -eu
DEPLOY_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname "$DEPLOY_DIR")
RUNTIME_DIR="$DEPLOY_DIR/runtime"
export TRACKER_DATA_ROOT="$RUNTIME_DIR"
export PLAYWRIGHT_BROWSERS_PATH="$RUNTIME_DIR/browsers"
NODE_BIN=$(cat "$RUNTIME_DIR/node-path.txt")
cd "$REPO_ROOT"
"$NODE_BIN" "$DEPLOY_DIR/run-month-end.mjs" >> "$RUNTIME_DIR/logs/collector.log" 2>&1

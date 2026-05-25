#!/usr/bin/env bash
# run.sh — Launch the Cyberdeck Aviation Console
# Usage: bash cyberdeck/run.sh [--headless]
#
# --headless   Start only the data server (no Qt UI, useful for testing)

set -e
cd "$(dirname "$0")"

# Pass any args through to app.py
if [[ "$1" == "--headless" ]]; then
    echo "Starting in headless/server-only mode..."
    python3 server.py
else
    echo "Starting Cyberdeck Aviation Console..."
    python3 app.py "$@"
fi

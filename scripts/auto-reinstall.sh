#!/bin/bash
# auto-reinstall.sh — triggered by deploy.sh on version mismatch
# Runs non-interactively: reset → install. Logs everything to reinstall.log.
# Never call this directly — use deploy.sh or run reset.sh + install.sh manually.

REPO_DIR="/opt/flighttracker"
LOGFILE="$REPO_DIR/reinstall.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

{
  log "========================================"
  log "  Auto-reinstall starting"
  log "  From version: $(cat "$REPO_DIR/.installed-version" 2>/dev/null || echo 'none')"
  log "  To version:   $(cat "$REPO_DIR/VERSION")"
  log "========================================"

  log "Step 1/2: Reset..."
  bash "$REPO_DIR/scripts/reset.sh" --force
  log "Reset complete."

  log "Step 2/2: Install..."
  bash "$REPO_DIR/scripts/install.sh"
  log "Install complete."

  log "========================================"
  log "  Auto-reinstall finished successfully"
  log "========================================"

} >> "$LOGFILE" 2>&1

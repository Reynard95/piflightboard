#!/bin/bash
# deploy.sh — runs on the Pi after every git pull
# Called by GitHub Actions via SSH

set -e

REPO_DIR="/opt/flighttracker"
WEB_DIR="/var/www/flightboard"
CONFIG_DIR="/etc/lighttpd/conf-enabled"
READSB_DEFAULT="/etc/default/readsb"
SYSTEMD_DIR="/etc/systemd/system"

echo "[deploy] Starting deployment..."

# ── Version check ──────────────────────────────────────────
# If the stack version has changed (or no install stamp exists),
# trigger a full reset + reinstall via the systemd oneshot service.
REPO_VERSION=$(cat "$REPO_DIR/VERSION" 2>/dev/null || echo "0")
INSTALLED_VERSION=$(cat "$REPO_DIR/.installed-version" 2>/dev/null || echo "none")

if [ "$REPO_VERSION" != "$INSTALLED_VERSION" ]; then
  echo "[deploy] Version mismatch — installed: $INSTALLED_VERSION, repo: $REPO_VERSION"
  echo "[deploy] Triggering auto-reinstall via systemd..."
  echo "[deploy] Progress: sudo journalctl -u flightboard-reinstall -f"
  echo "[deploy]           or: tail -f $REPO_DIR/reinstall.log"
  # The flightboard-reinstall.service was installed by install.sh.
  # We only need systemctl to start it — no sudo cp required.
  sudo systemctl daemon-reload
  sudo systemctl start flightboard-reinstall
  echo "[deploy] Reinstall service started. Exiting deploy — nothing else to do."
  exit 0
fi

echo "[deploy] Version $REPO_VERSION matches — running normal deploy."

# ── Web files ──────────────────────────────────────────────
# Copy to a staging dir then atomically replace the live root so a browser
# request during deploy never sees a half-updated file set.
echo "[deploy] Copying web files (atomic)..."
STAGE_DIR=$(mktemp -d "/tmp/flightboard-stage.XXXXXX")
cp -r "$REPO_DIR"/www/. "$STAGE_DIR/"
chmod -R a+rX "$STAGE_DIR"
# Swap: move the old root aside, promote staging, remove old.
OLD_DIR=$(mktemp -d "/tmp/flightboard-old.XXXXXX")
mv "$WEB_DIR" "$OLD_DIR" 2>/dev/null || true
mv "$STAGE_DIR" "$WEB_DIR"
rm -rf "$OLD_DIR"

# ── lighttpd config ────────────────────────────────────────
echo "[deploy] Installing lighttpd config..."
sudo cp "$REPO_DIR/config/lighttpd-flightboard.conf" "$CONFIG_DIR/50-flightboard.conf"

# ── lighttpd reload ────────────────────────────────────────
echo "[deploy] Reloading lighttpd..."
sudo lighttpd -tt -f /etc/lighttpd/lighttpd.conf
sudo systemctl enable lighttpd
sudo systemctl reload-or-restart lighttpd

# ── readsb config ──────────────────────────────────────────
# config/readsb.conf in the repo is a template with placeholder lat/lon.
# The Pi's real coordinates are set once during install (via settings API or
# manually) and must never be overwritten by deploy. Skip this entirely.
echo "[deploy] Skipping readsb.conf — Pi keeps its own coordinates."

# ── tmpfiles (permissions that survive reboot) ────────────
sudo cp "$REPO_DIR/config/tmpfiles-readsb.conf" /etc/tmpfiles.d/readsb.conf

# ── route proxy ────────────────────────────────────────────
# Service now runs directly from the repo (no copy to /usr/local/bin needed).
# Only update the service file if it changed, then restart.
if ! diff -q "$REPO_DIR/config/route-proxy.service" "$SYSTEMD_DIR/route-proxy.service" > /dev/null 2>&1; then
  echo "[deploy] Updating route-proxy service file..."
  sudo cp "$REPO_DIR/config/route-proxy.service" "$SYSTEMD_DIR/route-proxy.service"
  sudo systemctl daemon-reload
  sudo systemctl enable route-proxy
fi
echo "[deploy] Restarting route-proxy..."
sudo systemctl restart route-proxy

# ── settings API ────────────────────────────────────────────
# Service now runs directly from the repo (no copy to /usr/local/bin needed).
# Only update the service file if it changed, then restart.
if ! diff -q "$REPO_DIR/config/settings-api.service" "$SYSTEMD_DIR/settings-api.service" > /dev/null 2>&1; then
  echo "[deploy] Updating settings-api service file..."
  sudo cp "$REPO_DIR/config/settings-api.service" "$SYSTEMD_DIR/settings-api.service"
  sudo systemctl daemon-reload
  sudo systemctl enable settings-api
fi
echo "[deploy] Restarting settings-api..."
sudo systemctl restart settings-api

echo "[deploy] Done! Deployment complete."

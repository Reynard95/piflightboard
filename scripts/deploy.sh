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

# ── Web files ──────────────────────────────────────────────
# Always copy web files first — regardless of version check below.
# This ensures the latest HTML/CSS/JS is live immediately on every push,
# even when a version bump triggers a slow background reinstall.
echo "[deploy] Copying web files (atomic)..."
STAGE_DIR=$(mktemp -d "/tmp/flightboard-stage.XXXXXX")
cp -r "$REPO_DIR"/www/. "$STAGE_DIR/"
chmod -R a+rX "$STAGE_DIR"
# Swap: move the old root aside, promote staging, remove old.
OLD_DIR=$(mktemp -d "/tmp/flightboard-old.XXXXXX")
mv "$WEB_DIR" "$OLD_DIR" 2>/dev/null || true
mv "$STAGE_DIR" "$WEB_DIR"
rm -rf "$OLD_DIR"

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
  sudo systemctl daemon-reload
  sudo systemctl start flightboard-reinstall
  echo "[deploy] Reinstall service started. Web files already updated above."
  exit 0
fi

echo "[deploy] Version $REPO_VERSION matches — running normal deploy."

# ── lighttpd config ────────────────────────────────────────
echo "[deploy] Installing lighttpd config..."
sudo cp "$REPO_DIR/config/lighttpd-flightboard.conf" "$CONFIG_DIR/50-flightboard.conf"

# ── lighttpd restart ───────────────────────────────────────
echo "[deploy] Restarting lighttpd..."
sudo lighttpd -tt -f /etc/lighttpd/lighttpd.conf
sudo systemctl enable lighttpd
sudo systemctl restart lighttpd

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

# ── fr24feed: switch from direct DVB-T to Beast TCP via readsb ─────────────
# If fr24feed.ini still has receiver=dvbt, readsb and fr24feed both try to
# own the RTL-SDR dongle and fr24feed loses every time. Point it at readsb's
# Beast output port instead. Only modifies the two relevant keys; FR24 key
# and all other settings are preserved.
if [ -f /etc/fr24feed.ini ] && grep -q '^receiver=dvbt' /etc/fr24feed.ini; then
  echo "[deploy] Fixing fr24feed: switching receiver=dvbt → beast-tcp on port 30005..."
  sudo sed -i 's/^receiver=.*/receiver=beast-tcp/' /etc/fr24feed.ini
  if grep -q '^host=' /etc/fr24feed.ini; then
    sudo sed -i 's/^host=.*/host=127.0.0.1:30005/' /etc/fr24feed.ini
  else
    printf '\nhost=127.0.0.1:30005\n' | sudo tee -a /etc/fr24feed.ini > /dev/null
  fi
  sudo systemctl restart fr24feed
  echo "[deploy] fr24feed reconfigured and restarted."
fi

# ── Health check ───────────────────────────────────────────
# Verify critical services are active after all restarts.
# If a service is still down, try one more cold start.
for svc in lighttpd route-proxy settings-api; do
  if ! systemctl is-active --quiet "$svc"; then
    echo "[deploy] WARNING: $svc not active — attempting recovery restart..."
    sudo systemctl restart "$svc" || echo "[deploy] ERROR: $svc failed to start"
  fi
done

echo "[deploy] Done! Deployment complete."

#!/bin/bash
# deploy.sh — runs on the Pi after every git pull
# Called by GitHub Actions via SSH

set -e

REPO_DIR="/opt/flighttracker"
WEB_DIR="/usr/local/share/tar1090/html"
CONFIG_DIR="/etc/lighttpd/conf-enabled"
READSB_DEFAULT="/etc/default/readsb"
SYSTEMD_DIR="/etc/systemd/system"

echo "[deploy] Starting deployment..."

# ── Web files ──────────────────────────────────────────────
echo "[deploy] Copying web files..."
sudo cp "$REPO_DIR"/www/* "$WEB_DIR/"

# ── lighttpd aliases for local assets ─────────────────────
# 87-* loads before 88-tar1090.conf so our specific aliases win over the catch-all /tar1090/
echo "[deploy] Installing lighttpd asset aliases..."
sudo cp "$REPO_DIR/config/lighttpd-tar1090.conf" "$CONFIG_DIR/87-flighttracker.conf"
sudo cp "$REPO_DIR/config/lighttpd-assets.conf"  "$CONFIG_DIR/89-flighttracker-assets.conf"

# ── lighttpd reload ────────────────────────────────────────
echo "[deploy] Reloading lighttpd..."
sudo lighttpd -tt -f /etc/lighttpd/lighttpd.conf && sudo systemctl reload lighttpd

# ── readsb config (only if changed) ───────────────────────
if ! diff -q "$REPO_DIR/config/readsb.conf" "$READSB_DEFAULT" > /dev/null 2>&1; then
  echo "[deploy] Updating readsb config..."
  sudo cp "$REPO_DIR/config/readsb.conf" "$READSB_DEFAULT"
  sudo systemctl restart readsb
else
  echo "[deploy] readsb config unchanged, skipping restart."
fi

# ── tmpfiles (permissions that survive reboot) ────────────
sudo cp "$REPO_DIR/config/tmpfiles-readsb.conf" /etc/tmpfiles.d/readsb.conf

# ── route proxy ────────────────────────────────────────────
if [ -f "$REPO_DIR/config/route-proxy.service" ]; then
  sudo cp "$REPO_DIR/scripts/route-proxy.py" /usr/local/bin/route-proxy.py
  sudo chmod +x /usr/local/bin/route-proxy.py
  sudo cp "$REPO_DIR/config/route-proxy.service" "$SYSTEMD_DIR/route-proxy.service"
  sudo systemctl daemon-reload
  sudo systemctl enable route-proxy
  sudo systemctl restart route-proxy
fi

echo "[deploy] Done! Deployment complete."
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
sudo cp "$REPO_DIR/www/flightboard.html" "$WEB_DIR/flightboard.html"

# ── lighttpd aliases for local assets ─────────────────────
echo "[deploy] Patching lighttpd aliases for logos and flags..."
# Remove any existing asset aliases first to avoid duplicates
sudo sed -i '/tar1090\/airline_logos/d' /etc/lighttpd/conf-enabled/88-tar1090.conf
sudo sed -i '/tar1090\/country_flags/d' /etc/lighttpd/conf-enabled/88-tar1090.conf
# Add aliases before the catch-all /tar1090/ entry
sudo sed -i 's|"/tar1090/" => "/usr/local/share/tar1090/html/"|"/tar1090/airline_logos/" => "/opt/flighttracker/images/airline_logos/",\n  "/tar1090/country_flags/" => "/opt/flighttracker/images/country_flags/",\n  "/tar1090/" => "/usr/local/share/tar1090/html/"|' \
  /etc/lighttpd/conf-enabled/88-tar1090.conf

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
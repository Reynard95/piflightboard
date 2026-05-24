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
# trigger a full reset + reinstall in the background and exit.
# The SSH session closes cleanly; progress is logged to reinstall.log.
REPO_VERSION=$(cat "$REPO_DIR/VERSION" 2>/dev/null || echo "0")
INSTALLED_VERSION=$(cat "$REPO_DIR/.installed-version" 2>/dev/null || echo "none")

if [ "$REPO_VERSION" != "$INSTALLED_VERSION" ]; then
  echo "[deploy] Version mismatch — installed: $INSTALLED_VERSION, repo: $REPO_VERSION"
  echo "[deploy] Triggering auto-reinstall via systemd..."
  echo "[deploy] Progress: sudo journalctl -u flightboard-reinstall -f"
  echo "[deploy]           or: tail -f $REPO_DIR/reinstall.log"
  # Install the service file from the repo before starting it — it won't exist
  # on a fresh Pi that has never had install.sh run. cp and systemctl are both
  # in the deploy sudoers so no TTY issues.
  sudo cp "$REPO_DIR/config/auto-reinstall.service" /etc/systemd/system/flightboard-reinstall.service
  sudo systemctl daemon-reload
  sudo systemctl start flightboard-reinstall
  echo "[deploy] Reinstall service started. Exiting deploy — nothing else to do."
  exit 0
fi

echo "[deploy] Version $REPO_VERSION matches — running normal deploy."

# ── Web files ──────────────────────────────────────────────
echo "[deploy] Copying web files..."
sudo cp "$REPO_DIR"/www/* "$WEB_DIR/"

# ── lighttpd config ────────────────────────────────────────
echo "[deploy] Installing lighttpd config..."
sudo cp "$REPO_DIR/config/lighttpd-flightboard.conf" "$CONFIG_DIR/50-flightboard.conf"

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

# ── settings API ────────────────────────────────────────────
if [ -f "$REPO_DIR/config/settings-api.service" ]; then
  sudo cp "$REPO_DIR/scripts/settings-api.py" /usr/local/bin/settings-api.py
  sudo chmod +x /usr/local/bin/settings-api.py
  sudo cp "$REPO_DIR/config/settings-api.service" "$SYSTEMD_DIR/settings-api.service"
  sudo systemctl daemon-reload
  sudo systemctl enable settings-api
  sudo systemctl restart settings-api
fi

echo "[deploy] Done! Deployment complete."

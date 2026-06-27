#!/bin/bash
# reset.sh — Undo everything install.sh did
# Returns the Pi to stock Raspberry Pi OS without reflashing.
# The git repo at /opt/flighttracker is left intact — run install.sh again after this.
#
# Usage: sudo bash scripts/reset.sh
# Run over SSH or directly on the Pi.

set -e

REPO_DIR="/opt/flighttracker"
FORCE=0
for arg in "$@"; do [ "$arg" = "--force" ] && FORCE=1; done

echo "============================================"
echo "  Flightboard Reset"
echo "  This will remove all flightboard services,"
echo "  configs, and web files. The repo at"
echo "  $REPO_DIR is kept."
echo "============================================"
echo ""
if [ "$FORCE" -eq 0 ]; then
  read -p "Are you sure? Type YES to continue: " confirm
  [ "$confirm" = "YES" ] || { echo "Aborted."; exit 1; }
else
  echo "  Running in --force mode (non-interactive)."
fi

# ── 1. Stop and disable services ──────────────────────────
echo "[1/8] Stopping services..."
for svc in settings-api route-proxy readsb lighttpd; do
  systemctl stop    "$svc" 2>/dev/null || true
  systemctl disable "$svc" 2>/dev/null || true
done

# ── 2. Remove systemd service files ───────────────────────
echo "[2/8] Removing service files..."
rm -f /etc/systemd/system/readsb.service
rm -f /etc/systemd/system/route-proxy.service
rm -f /etc/systemd/system/settings-api.service
systemctl daemon-reload

# ── 3. Remove installed binaries ──────────────────────────
echo "[3/8] Removing binaries..."
rm -f /usr/local/bin/readsb
rm -f /usr/local/bin/viewadsb
rm -f /usr/local/bin/route-proxy.py
rm -f /usr/local/bin/settings-api.py
rm -f /usr/local/share/aircraft.csv.gz

# ── 4. Remove lighttpd configs ────────────────────────────
echo "[4/8] Removing lighttpd configs..."
rm -f /etc/lighttpd/conf-enabled/50-flightboard.conf
rm -f /etc/lighttpd/conf-enabled/87-flighttracker.conf
rm -f /etc/lighttpd/conf-enabled/88-tar1090.conf
rm -f /etc/lighttpd/conf-enabled/89-flighttracker-assets.conf
rm -f /etc/lighttpd/conf-enabled/95-tar1090-otherport.conf
rm -f /etc/lighttpd/conf-enabled/99-unconfigured.conf

# ── 5. Remove web root and aircraft DB ────────────────────
echo "[5/8] Removing web root and aircraft database..."
rm -rf /var/www/flightboard
rm -rf "$REPO_DIR/db"
rm -f  "$REPO_DIR/config/settings.json"

# Keep these (they're user data / deploy secrets):
#   $REPO_DIR/config/readsb.conf   — lat/lon config
#   ~/.ssh/deploy_key               — GitHub deploy key

# ── 6. Remove system config files ─────────────────────────
echo "[6/8] Removing system config files..."
rm -f /etc/default/readsb
rm -f /etc/modprobe.d/rtlsdr.conf
rm -f /etc/udev/rules.d/rtl-sdr.rules
rm -f /etc/tmpfiles.d/readsb.conf
# Sudoers files are intentionally kept — removing them breaks GitHub Actions
# deploys because the Pi has no other passwordless-sudo grant for deploy commands.
# Re-running install.sh will overwrite them with fresh content anyway.
udevadm control --reload-rules

# ── 7. Remove readsb user ─────────────────────────────────
echo "[7/8] Removing readsb system user..."
userdel readsb 2>/dev/null || true
rm -rf /run/readsb

# ── 8. Remove packages installed by install.sh ────────────
echo "[8/8] Removing installed packages..."
echo "      (lighttpd, python3-flask, python3-flask-cors)"
echo "      Skipping build tools and git — those are likely wanted."
apt-get remove -y lighttpd python3-flask python3-flask-cors 2>/dev/null || true
apt-get autoremove -y 2>/dev/null || true

# Note: Tailscale is intentionally NOT removed — you need it to stay connected.
# To remove Tailscale: apt-get remove tailscale

# Clear the installed version stamp so the next deploy knows reinstall is needed
rm -f "$REPO_DIR/.installed-version"

echo ""
echo "============================================"
echo "  Reset complete."
echo ""
echo "  Repo is still at: $REPO_DIR"
echo "  To reinstall:     sudo bash scripts/install.sh"
echo "============================================"

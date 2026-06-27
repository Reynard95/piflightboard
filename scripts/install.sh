#!/bin/bash
# install.sh — Full clean install of the flighttracker stack
# Run once on a fresh Raspberry Pi OS Lite (64-bit) install
# Usage: sudo bash scripts/install.sh

set -e

REPO_DIR="/opt/flighttracker"
WEB_DIR="/var/www/flightboard"
DB_DIR="$REPO_DIR/db"
DEPLOY_USER="${SUDO_USER:-$(whoami)}"

echo "============================================"
echo "  Flightboard Clean Install"
echo "============================================"

# ── 0. Wait for network ────────────────────────────────────
echo "[0/11] Waiting for network and DNS..."
for i in $(seq 1 24); do
  if curl -s --max-time 5 https://github.com > /dev/null 2>&1; then
    echo "       Network ready."
    break
  fi
  if [ "$i" -eq 24 ]; then
    echo "ERROR: No network after 2 minutes. Check your connection and retry."
    exit 1
  fi
  echo "       Attempt $i/24 — retrying in 5s..."
  sleep 5
done

# ── 1. Stop any running services ──────────────────────────
# Must happen before copying binaries — Linux refuses to overwrite a running executable.
echo "[1/11] Stopping any existing services..."
for svc in readsb lighttpd route-proxy settings-api; do
  systemctl stop "$svc" 2>/dev/null || true
done
# Note: do NOT stop flightboard-reinstall here — this script may be running inside it

# ── 2. System update ───────────────────────────────────────
echo "[2/11] Updating system..."
apt-get update
# Force-remove dump1090-mutability:armhf if present — fr24feed installs this
# armhf package on arm64 Pis where its deps can never be satisfied, blocking
# every subsequent apt upgrade. dpkg -f install alone won't remove it.
dpkg --remove --force-remove-reinstreq dump1090-mutability:armhf 2>/dev/null || true
dpkg --remove --force-remove-reinstreq dump1090-mutability 2>/dev/null || true
apt-get -f install -y
apt-get upgrade -y

# ── 3. Dependencies ────────────────────────────────────────
echo "[3/11] Installing dependencies..."
apt install -y \
  build-essential git librtlsdr-dev pkg-config \
  zlib1g-dev libzstd-dev zstd lighttpd curl wget libncurses-dev \
  python3 python3-pip python3-flask python3-flask-cors

# ── 4. Repo, Tailscale, SSH key, sudoers ──────────────────
echo "[4/11] Configuring repo ownership..."
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"

echo "[4/11] Installing Tailscale (skipped if already installed)..."
if ! command -v tailscale &>/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
  echo ""
  echo ">>> ACTION REQUIRED after this script finishes:"
  echo "    1. Run: sudo tailscale up"
  echo "    2. Note your IP: tailscale ip -4"
  echo "    3. Add PI_TAILSCALE_IP to GitHub secrets"
  echo ""
else
  echo "       Tailscale already installed, skipping."
fi

echo "[4/11] Setting up deploy SSH key..."
USER_HOME=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
DEPLOY_KEY="$USER_HOME/.ssh/deploy_key"
mkdir -p "$USER_HOME/.ssh"
chmod 700 "$USER_HOME/.ssh"
if [ ! -f "$DEPLOY_KEY" ]; then
  ssh-keygen -t ed25519 -C "github-actions-deploy" -f "$DEPLOY_KEY" -N ""
  cat "$DEPLOY_KEY.pub" >> "$USER_HOME/.ssh/authorized_keys"
  chmod 600 "$USER_HOME/.ssh/authorized_keys"
  chown -R "$DEPLOY_USER:$DEPLOY_USER" "$USER_HOME/.ssh"
  echo ""
  echo ">>> ACTION REQUIRED: Copy the private key below into GitHub secret DEPLOY_SSH_KEY:"
  echo "--------------------------------------------------------------------"
  cat "$DEPLOY_KEY"
  echo "--------------------------------------------------------------------"
else
  echo "       Deploy key already exists, skipping."
fi

echo "[4/11] Configuring sudoers..."
# !requiretty is required — GitHub Actions SSH sessions have no PTY.
# Without it, sudo demands a password even when NOPASSWD is set.
# Commands are scoped to exactly what deploy.sh needs; no blanket root.
cat > /etc/sudoers.d/flighttracker-deploy << EOF
Defaults:$DEPLOY_USER !requiretty
$DEPLOY_USER ALL=(ALL) NOPASSWD: \
  /usr/bin/cp /opt/flighttracker/config/lighttpd-flightboard.conf /etc/lighttpd/conf-enabled/50-flightboard.conf, \
  /usr/bin/systemctl enable lighttpd, \
  /usr/bin/systemctl reload lighttpd, \
  /usr/bin/systemctl restart lighttpd, \
  /usr/bin/systemctl daemon-reload, \
  /usr/bin/systemctl enable route-proxy, \
  /usr/bin/systemctl restart route-proxy, \
  /usr/bin/systemctl enable settings-api, \
  /usr/bin/systemctl restart settings-api, \
  /usr/bin/systemctl start flightboard-reinstall, \
  /usr/bin/cp /opt/flighttracker/config/readsb.conf /etc/default/readsb, \
  /usr/bin/systemctl restart readsb, \
  /usr/bin/cp /opt/flighttracker/config/tmpfiles-readsb.conf /etc/tmpfiles.d/readsb.conf, \
  /usr/bin/cp /opt/flighttracker/config/route-proxy.service /etc/systemd/system/route-proxy.service, \
  /usr/bin/cp /opt/flighttracker/config/settings-api.service /etc/systemd/system/settings-api.service
EOF
chmod 440 /etc/sudoers.d/flighttracker-deploy

# settings-api runs as nobody; grant only the specific commands it needs.
# Defaults:nobody !requiretty is required — settings-api has no terminal.
# /usr/bin/wget and /usr/bin/bash needed for feeder installs.
# /usr/bin/piaware-config needed to read the generated feeder-id.
cat > /etc/sudoers.d/flighttracker-settings-api << 'EOF'
Defaults:nobody !requiretty
nobody ALL=(ALL) NOPASSWD: \
  /usr/bin/cp /etc/default/readsb, \
  /usr/bin/systemctl restart readsb, \
  /usr/bin/systemctl restart fr24feed, \
  /usr/bin/systemctl enable fr24feed, \
  /usr/bin/systemctl start fr24feed, \
  /usr/bin/systemctl restart piaware, \
  /usr/bin/systemctl enable piaware, \
  /usr/bin/systemctl start piaware, \
  /usr/bin/systemctl restart route-proxy, \
  /usr/bin/apt-get *, \
  /usr/bin/dpkg *, \
  /usr/bin/wget *, \
  /usr/bin/bash *, \
  /usr/bin/piaware-config *
EOF
chmod 440 /etc/sudoers.d/flighttracker-settings-api

# ── 5. Blacklist DVB driver ────────────────────────────────
echo "[5/11] Blacklisting DVB driver..."
echo 'blacklist dvb_usb_rtl28xxu' > /etc/modprobe.d/rtlsdr.conf

# ── 6. RTL-SDR udev rules ──────────────────────────────────
echo "[6/11] Setting up udev rules..."
cat > /etc/udev/rules.d/rtl-sdr.rules << 'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", GROUP="plugdev", MODE="0664"
EOF
udevadm control --reload-rules
udevadm trigger

# ── 7-8. Build and setup readsb (soft-fail) ───────────────
# Wrapped in a subshell so a build failure does not abort the rest of the
# install. lighttpd, settings-api, and route-proxy will still be set up
# even if the readsb build fails. Re-run install.sh to retry the build.
echo "[7/11] Building readsb from source..."
(
  set -e
  cd /tmp
  rm -rf readsb
  git clone --depth 1 https://github.com/wiedehopf/readsb.git
  cd readsb
  make AIRCRAFT_HASH_BITS=12 RTLSDR=yes
  cp readsb /usr/local/bin/readsb
  cp viewadsb /usr/local/bin/viewadsb

  echo "[8/11] Setting up readsb..."
  useradd -r -s /usr/sbin/nologin readsb 2>/dev/null || true
  usermod -a -G plugdev readsb
  mkdir -p /run/readsb
  chown readsb:readsb /run/readsb
  chmod 755 /run/readsb
  cp "$REPO_DIR/config/tmpfiles-readsb.conf" /etc/tmpfiles.d/readsb.conf

  wget -O /usr/local/share/aircraft.csv.gz \
    https://github.com/wiedehopf/tar1090-db/raw/csv/aircraft.csv.gz

  cp /tmp/readsb/debian/readsb.service /etc/systemd/system/
  sed -i 's|/usr/bin/readsb|/usr/local/bin/readsb|g' /etc/systemd/system/readsb.service
  cp "$REPO_DIR/config/readsb.conf" /etc/default/readsb
  systemctl daemon-reload
  systemctl enable readsb
  systemctl start readsb
) || echo "[WARNING] readsb build/setup failed — web UI and API will still work but ADS-B data will be unavailable. Re-run sudo bash scripts/install.sh to retry."

# ── 9. Aircraft hex database ───────────────────────────────
# Sparse-cloned from wiedehopf/tar1090-db — no tar1090 install needed.
# db/ contains per-prefix .js files (valid JSON) served at /db/ by lighttpd.
echo "[9/11] Cloning aircraft hex database..."
rm -rf /tmp/tar1090-db
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/wiedehopf/tar1090-db.git /tmp/tar1090-db
cd /tmp/tar1090-db
git sparse-checkout set db
mkdir -p "$DB_DIR"
cp -r db/* "$DB_DIR/"
cd "$DB_DIR"
for f in *.js; do
  if [ -f "$f" ] && file "$f" | grep -q -i zst; then
    zstd -d "$f" -o "${f}.tmp" && mv "${f}.tmp" "$f" || true
  fi
done
chown -R www-data:www-data "$DB_DIR"
rm -rf /tmp/tar1090-db

# ── 10. Web root and lighttpd ──────────────────────────────
echo "[10/11] Configuring web root and lighttpd..."
mkdir -p "$WEB_DIR"
cp -r "$REPO_DIR"/www/. "$WEB_DIR/"
# Owned by the deploy user so deploy.sh can update web files without sudo.
# Lighttpd only needs read access, which the default umask provides.
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$WEB_DIR"
chmod -R a+rX "$WEB_DIR"

# Patch the document-root in the main lighttpd.conf — lighttpd rejects
# duplicate assignments so we can't set it again in a conf-enabled file.
sed -i 's|^\s*server\.document-root\s*=.*|server.document-root = "/var/www/flightboard"|' \
  /etc/lighttpd/lighttpd.conf

cp "$REPO_DIR/config/lighttpd-flightboard.conf" /etc/lighttpd/conf-enabled/50-flightboard.conf
lighttpd -tt -f /etc/lighttpd/lighttpd.conf
systemctl enable lighttpd
systemctl restart lighttpd

# ── 11. Route proxy, settings API, auto-reinstall service ─
echo "[11/11] Installing services..."

# Services run directly from the repo — no copy to /usr/local/bin needed.
# Scripts must be executable in the repo itself.
chmod +x "$REPO_DIR/scripts/route-proxy.py"
chmod +x "$REPO_DIR/scripts/settings-api.py"
cp "$REPO_DIR/config/route-proxy.service" /etc/systemd/system/route-proxy.service
cp "$REPO_DIR/config/settings-api.service" /etc/systemd/system/settings-api.service

cp "$REPO_DIR/config/auto-reinstall.service" /etc/systemd/system/flightboard-reinstall.service

mkdir -p "$REPO_DIR/config"
if [ ! -f "$REPO_DIR/config/settings.json" ]; then
  cat > "$REPO_DIR/config/settings.json" << 'EOF'
{
  "pin_hash": "",
  "location": { "lat": 0.0, "lon": 0.0 },
  "setup_complete": false
}
EOF
  chown nobody:nogroup "$REPO_DIR/config/settings.json"
  chmod 660 "$REPO_DIR/config/settings.json"
fi

systemctl daemon-reload
systemctl enable route-proxy
systemctl start route-proxy
systemctl enable settings-api
systemctl start settings-api
# flightboard-reinstall is oneshot — not enabled, triggered on demand by deploy.sh

# ── Done ───────────────────────────────────────────────────
# Re-chown the repo so the deploy user can git pull without a sudo TTY.
# Must happen last — some earlier steps (git clone of tar1090-db) run as root
# and temporarily affect the working directory.
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"
# config/ must be writable by nobody so settings-api can create .tmp files
chown nobody:nogroup "$REPO_DIR/config"
chmod 770 "$REPO_DIR/config"
chown nobody:nogroup "$REPO_DIR/config/settings.json" 2>/dev/null || true
chmod 660 "$REPO_DIR/config/settings.json" 2>/dev/null || true
# /etc/default/readsb must be writable by nobody so settings-api can update lat/lon.
# Group ownership set to nogroup (nobody's group) so settings-api can write without
# needing world-write permission.
[ -f /etc/default/readsb ] && chown nobody:nogroup /etc/default/readsb || true
[ -f /etc/default/readsb ] && chmod 640 /etc/default/readsb || true

cp "$REPO_DIR/VERSION" "$REPO_DIR/.installed-version"
echo "[done] Installed version: $(cat "$REPO_DIR/VERSION")"

echo ""
echo "============================================"
echo "  Install complete!"
echo ""
echo "  Next steps:"
echo "  1. sudo tailscale up        (authenticate Tailscale)"
echo "  2. tailscale ip -4          (note IP for GitHub secrets)"
echo "  3. Add GitHub secrets — see README.md"
echo ""
echo "  Web UI:   http://$(hostname).local/"
echo "  Radar:    http://$(hostname).local/radar.html"
echo "  Setup:    http://$(hostname).local/setup.html"
echo "============================================"

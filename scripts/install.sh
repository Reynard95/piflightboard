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

# ── 1. System update ───────────────────────────────────────
echo "[1/10] Updating system..."
apt update && apt upgrade -y

# ── 2. Dependencies ────────────────────────────────────────
echo "[2/10] Installing dependencies..."
apt install -y \
  build-essential git librtlsdr-dev pkg-config \
  zlib1g-dev libzstd-dev zstd lighttpd curl wget libncurses-dev \
  python3 python3-pip python3-flask python3-flask-cors

# ── 2b. Fix repo ownership so deploy user can git pull ─────
echo "[2b/10] Setting repo ownership..."
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$REPO_DIR"

# ── 2c. Tailscale ──────────────────────────────────────────
echo "[2c/10] Installing Tailscale..."
curl -fsSL https://tailscale.com/install.sh | sh
echo ""
echo ">>> ACTION REQUIRED after this script finishes:"
echo "    1. Run: sudo tailscale up"
echo "    2. Note your IP: tailscale ip -4"
echo "    3. Add PI_TAILSCALE_IP to GitHub secrets"
echo ""

# ── 2d. Deploy SSH key ─────────────────────────────────────
echo "[2d/10] Setting up deploy SSH key..."
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
  echo "    Deploy key already exists, skipping."
fi

# ── 2e. Sudoers for deploy script ──────────────────────────
echo "[2e/10] Configuring sudoers for deploy..."
cat > /etc/sudoers.d/flighttracker-deploy << EOF
$DEPLOY_USER ALL=(ALL) NOPASSWD: /bin/cp, /bin/chmod, /usr/bin/systemctl, /usr/sbin/lighttpd
EOF
chmod 440 /etc/sudoers.d/flighttracker-deploy

# ── 3. Blacklist DVB driver ────────────────────────────────
echo "[3/10] Blacklisting DVB driver..."
echo 'blacklist dvb_usb_rtl28xxu' > /etc/modprobe.d/rtlsdr.conf

# ── 4. RTL-SDR udev rules ──────────────────────────────────
echo "[4/10] Setting up udev rules..."
cat > /etc/udev/rules.d/rtl-sdr.rules << 'EOF'
SUBSYSTEM=="usb", ATTRS{idVendor}=="0bda", ATTRS{idProduct}=="2838", GROUP="plugdev", MODE="0664"
EOF
udevadm control --reload-rules
udevadm trigger

# ── 5. Build readsb ────────────────────────────────────────
echo "[5/10] Building readsb from source..."
cd /tmp
rm -rf readsb
git clone --depth 1 https://github.com/wiedehopf/readsb.git
cd readsb
make AIRCRAFT_HASH_BITS=12 RTLSDR=yes
cp readsb /usr/local/bin/readsb
cp viewadsb /usr/local/bin/viewadsb

# ── 6. readsb user and directories ────────────────────────
echo "[6/10] Setting up readsb user and directories..."
useradd -r -s /usr/sbin/nologin readsb 2>/dev/null || true
usermod -a -G plugdev readsb
mkdir -p /run/readsb
chown readsb:readsb /run/readsb
chmod 755 /run/readsb
cat > /etc/tmpfiles.d/readsb.conf << 'EOF'
d /run/readsb 0755 readsb readsb -
EOF

# Aircraft CSV for the readsb binary (hex→type lookups at decode time)
echo "[6b/10] Downloading aircraft CSV for readsb..."
wget -O /usr/local/share/aircraft.csv.gz \
  https://github.com/wiedehopf/tar1090-db/raw/csv/aircraft.csv.gz

echo "[7/10] Installing readsb service..."
cp /tmp/readsb/debian/readsb.service /etc/systemd/system/
sed -i 's|/usr/bin/readsb|/usr/local/bin/readsb|g' /etc/systemd/system/readsb.service
cp "$REPO_DIR/config/readsb.conf" /etc/default/readsb
systemctl daemon-reload
systemctl enable readsb
systemctl start readsb

# ── 8. Aircraft hex database for the browser UI ───────────
# Cloned directly from wiedehopf/tar1090-db — no tar1090 install needed.
# The db/ directory contains per-prefix .js files (valid JSON, .js extension)
# served at /db/ by lighttpd.
echo "[8/10] Cloning aircraft hex database..."
rm -rf /tmp/tar1090-db
git clone --depth 1 --filter=blob:none --sparse \
  https://github.com/wiedehopf/tar1090-db.git /tmp/tar1090-db
cd /tmp/tar1090-db
git sparse-checkout set db
mkdir -p "$DB_DIR"
cp -r db/* "$DB_DIR/"
# Decompress any zstd-compressed files (repo ships some compressed)
cd "$DB_DIR"
for f in *.js; do
  if [ -f "$f" ] && file "$f" | grep -q -i zst; then
    zstd -d "$f" -o "${f}.tmp" && mv "${f}.tmp" "$f" || true
  fi
done
chown -R www-data:www-data "$DB_DIR"
rm -rf /tmp/tar1090-db

# ── 9. Web root and lighttpd ───────────────────────────────
echo "[9/10] Configuring web root and lighttpd..."
mkdir -p "$WEB_DIR"
cp "$REPO_DIR"/www/* "$WEB_DIR/"
chown -R www-data:www-data "$WEB_DIR"

# Install our standalone config — 50- prefix loads after lighttpd defaults (10-)
# and sets server.document-root, overriding the default /var/www/html.
# No dependency on tar1090's 88-tar1090.conf.
cp "$REPO_DIR/config/lighttpd-flightboard.conf" /etc/lighttpd/conf-enabled/50-flightboard.conf

lighttpd -tt -f /etc/lighttpd/lighttpd.conf  # validate before enabling
systemctl enable lighttpd
systemctl restart lighttpd

# ── 10. Route proxy + Settings API ────────────────────────
echo "[10/10] Installing route proxy and settings API..."

cp "$REPO_DIR/scripts/route-proxy.py" /usr/local/bin/route-proxy.py
chmod +x /usr/local/bin/route-proxy.py
cp "$REPO_DIR/config/route-proxy.service" /etc/systemd/system/route-proxy.service

cp "$REPO_DIR/scripts/settings-api.py" /usr/local/bin/settings-api.py
chmod +x /usr/local/bin/settings-api.py
cp "$REPO_DIR/config/settings-api.service" /etc/systemd/system/settings-api.service

# Create initial settings file if it doesn't exist
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

# Sudoers rules so settings-api (runs as nobody) can write configs and restart services
cat > /etc/sudoers.d/flighttracker-settings-api << 'EOF'
nobody ALL=(ALL) NOPASSWD: /bin/cp /etc/default/readsb, /usr/bin/systemctl restart readsb, /usr/bin/systemctl restart fr24feed, /usr/bin/systemctl restart piaware, /usr/bin/systemctl restart route-proxy, /usr/bin/apt-get install *, /usr/bin/dpkg -i *, /bin/bash /tmp/install_fr24.sh
EOF
chmod 440 /etc/sudoers.d/flighttracker-settings-api

systemctl daemon-reload
systemctl enable route-proxy
systemctl start route-proxy
systemctl enable settings-api
systemctl start settings-api

# Stamp the installed version so deploy.sh can detect future mismatches
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

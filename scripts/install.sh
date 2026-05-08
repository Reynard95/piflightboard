#!/bin/bash
# install.sh — Full clean install of the flighttracker stack
# Run once on a fresh Raspberry Pi OS Lite (64-bit) install
# Usage: sudo bash scripts/install.sh

set -e

REPO_DIR="/opt/flighttracker"
WEB_DIR="/usr/local/share/tar1090/html"
DEPLOY_USER="${SUDO_USER:-$(whoami)}"

echo "============================================"
echo "  Flighttracker Clean Install"
echo "============================================"

# ── 1. System update ───────────────────────────────────────
echo "[1/10] Updating system..."
apt update && apt upgrade -y

# ── 2. Dependencies ────────────────────────────────────────
echo "[2/10] Installing dependencies..."
apt install -y \
  build-essential git librtlsdr-dev pkg-config \
  zlib1g-dev libzstd-dev zstd lighttpd curl wget libncurses-dev

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

# ── Aircraft database for readsb ──────────────────────────
echo "[6b/10] Downloading aircraft database..."
wget -O /usr/local/share/aircraft.csv.gz \
  https://github.com/wiedehopf/tar1090-db/raw/csv/aircraft.csv.gz
echo "[7/10] Installing readsb service..."
cp /tmp/readsb/debian/readsb.service /etc/systemd/system/
sed -i 's|/usr/bin/readsb|/usr/local/bin/readsb|g' /etc/systemd/system/readsb.service
cp "$REPO_DIR/config/readsb.conf" /etc/default/readsb
systemctl daemon-reload
systemctl enable readsb
systemctl start readsb

# ── 8. tar1090 web UI ─────────────────────────────────────
echo "[8/10] Installing tar1090..."
bash -c "$(wget -nv -O - https://github.com/wiedehopf/tar1090/raw/master/install.sh)" || {
  echo "    tar1090 install script failed or unavailable."
  echo "    Install manually: https://github.com/wiedehopf/tar1090"
}

# Decompress aircraft db if tar1090 installed successfully
if [ -d /usr/local/share/tar1090/git-db/db/ ]; then
  echo "[8b/10] Decompressing aircraft database..."
  cd /usr/local/share/tar1090/git-db/db/
  for f in *.js; do
    zstd -d "$f" -o "${f}.tmp" 2>/dev/null && mv "${f}.tmp" "$f" || true
  done
else
  echo "    Skipping db decompress — tar1090 not installed."
fi

# Patch tar1090 lighttpd config to add local asset aliases before the catch-all
echo "[8c/10] Patching lighttpd tar1090 config for local assets..."
sudo sed -i 's|"/tar1090/" => "/usr/local/share/tar1090/html/"|"/tar1090/airline_logos/" => "/opt/flighttracker/images/airline_logos/",\n  "/tar1090/country_flags/" => "/opt/flighttracker/images/country_flags/",\n  "/tar1090/" => "/usr/local/share/tar1090/html/"|' /etc/lighttpd/conf-enabled/88-tar1090.conf
echo "[9/10] Configuring lighttpd..."
cp "$REPO_DIR/config/lighttpd-tar1090.conf" /etc/lighttpd/conf-enabled/tar1090.conf
if [ -d "$WEB_DIR" ]; then
  cp "$REPO_DIR"/www/* "$WEB_DIR/"
fi
systemctl enable lighttpd
systemctl restart lighttpd

# ── 10. Route proxy ────────────────────────────────────────
echo "[10/10] Installing route proxy..."
cp "$REPO_DIR/scripts/route-proxy.py" /usr/local/bin/route-proxy.py
chmod +x /usr/local/bin/route-proxy.py
cp "$REPO_DIR/config/route-proxy.service" /etc/systemd/system/route-proxy.service
systemctl daemon-reload
systemctl enable route-proxy
systemctl start route-proxy

echo ""
echo "============================================"
echo "  Install complete!"
echo ""
echo "  Next steps:"
echo "  1. sudo tailscale up        (authenticate Tailscale)"
echo "  2. tailscale ip -4          (note IP for GitHub secrets)"
echo "  3. Add GitHub secrets — see README.md"
echo ""
echo "  Web UI:   http://$(hostname).local/tar1090"
echo "  Board:    http://$(hostname).local/tar1090/flightboard.html"
echo "============================================"
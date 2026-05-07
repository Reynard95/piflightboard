#!/bin/bash
# install.sh — Full clean install of the flighttracker stack
# Run once on a fresh Raspberry Pi OS Lite (64-bit) install
# Usage: sudo bash install.sh

set -e

REPO_DIR="/opt/flighttracker"
WEB_DIR="/usr/local/share/tar1090/html"

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
  zlib1g-dev libzstd-dev lighttpd curl wget

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

# tmpfiles so /run/readsb survives reboot
cat > /etc/tmpfiles.d/readsb.conf << 'EOF'
d /run/readsb 0755 readsb readsb -
EOF

# ── 7. readsb systemd service ─────────────────────────────
echo "[7/10] Installing readsb service..."
cp /tmp/readsb/debian/readsb.service /etc/systemd/system/
sed -i 's|/usr/bin/readsb|/usr/local/bin/readsb|g' /etc/systemd/system/readsb.service

# Copy config from repo
cp "$REPO_DIR/config/readsb.conf" /etc/default/readsb

systemctl daemon-reload
systemctl enable readsb
systemctl start readsb

# ── 8. tar1090 web UI ─────────────────────────────────────
echo "[8/10] Installing tar1090..."
sudo bash -c "$(wget -nv -O - https://github.com/wiedehopf/tar1090/raw/master/install.sh)" || true

# Decompress aircraft db
echo "[8/10b] Decompressing aircraft database..."
apt install -y zstd
cd /usr/local/share/tar1090/git-db/db/
for f in *.js; do
  zstd -d "$f" -o "${f}.tmp" 2>/dev/null && mv "${f}.tmp" "$f" || true
done

# ── 9. lighttpd ────────────────────────────────────────────
echo "[9/10] Configuring lighttpd..."
cp "$REPO_DIR/config/lighttpd-tar1090.conf" /etc/lighttpd/conf-enabled/tar1090.conf
cp "$REPO_DIR/www/flightboard.html" "$WEB_DIR/flightboard.html"
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
echo "  Open: http://$(hostname).local/tar1090"
echo "  Board: http://$(hostname).local/tar1090/flightboard.html"
echo "============================================"

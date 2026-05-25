#!/usr/bin/env bash
# install.sh — One-time setup for the cyberdeck app
# Run once: bash cyberdeck/install.sh

set -e
cd "$(dirname "$0")"

echo "=== Cyberdeck Aviation Console — Setup ==="
echo ""

# --- Python deps ---------------------------------------------------------
echo "[1/3] Installing Python dependencies..."

# PyQt6-WebEngine is not on pip for RPi — apt is the right path there
if grep -q "Raspberry\|raspbian" /etc/os-release 2>/dev/null; then
    echo "  Detected Raspberry Pi OS — using apt for PyQt6..."
    sudo apt-get install -y python3-pyqt6 python3-pyqt6.qtwebengine python3-flask python3-flask-cors python3-psutil
else
    pip3 install --break-system-packages -r requirements.txt 2>/dev/null \
        || pip3 install -r requirements.txt
fi

echo "  Done."
echo ""

# --- /etc/hosts entry for route proxy ------------------------------------
echo "[2/3] Adding flighttracker.local to /etc/hosts..."
if grep -q "flighttracker.local" /etc/hosts; then
    echo "  Already present — skipping."
else
    echo "127.0.0.1  flighttracker.local" | sudo tee -a /etc/hosts > /dev/null
    echo "  Added: 127.0.0.1  flighttracker.local"
fi
echo ""

# --- Config defaults -----------------------------------------------------
echo "[3/3] Checking layout.json..."
if [ ! -f layout.json ]; then
    echo "  layout.json not found — please create it (see layout.example.json)"
else
    echo "  layout.json found — OK"
fi
echo ""

echo "=== Setup complete! ==="
echo ""
echo "Run the app with:"
echo "  bash cyberdeck/run.sh"
echo ""

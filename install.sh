#!/bin/bash

# Flight Board Display - Quick Setup Script
# Run on Raspberry Pi Zero 2W with sudo privileges

set -e

echo "🚀 Flight Board Display - Setup Script"
echo "========================================"
echo ""

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run with sudo"
   exit 1
fi

# Get the current user
CURRENT_USER=$(who am i | awk '{print $1}')
HOME_DIR="/home/$CURRENT_USER"

echo "📝 Configuration:"
echo "  User: $CURRENT_USER"
echo "  Home: $HOME_DIR"
echo ""

# Create directories
echo "📁 Creating directories..."
mkdir -p $HOME_DIR/flight-board/templates
cd $HOME_DIR/flight-board

# Copy files if they exist in current directory
if [ -f "flight_board.py" ]; then
    cp flight_board.py $HOME_DIR/flight-board/
fi
if [ -f "requirements.txt" ]; then
    cp requirements.txt $HOME_DIR/flight-board/
fi
if [ -f "templates/flight_board.html" ]; then
    cp templates/flight_board.html $HOME_DIR/flight-board/templates/
fi
if [ -f "config.ini" ]; then
    cp config.ini $HOME_DIR/flight-board/
fi
if [ -f "SETUP.md" ]; then
    cp SETUP.md $HOME_DIR/flight-board/
fi

chown -R $CURRENT_USER:$CURRENT_USER $HOME_DIR/flight-board

echo "✅ Directories created"
echo ""

# Install Python packages
echo "📦 Installing Python dependencies..."
apt-get update
apt-get install -y python3-pip python3-venv

# Create virtual environment
echo "🐍 Creating Python virtual environment..."
su - $CURRENT_USER << EOF
cd $HOME_DIR/flight-board
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
deactivate
EOF

echo "✅ Python environment ready"
echo ""

# Install Chromium for display
echo "🖥️  Installing Chromium browser..."
apt-get install -y chromium-browser xserver-xorg x11-xserver-utils xinit

# Create startup script
echo "📜 Creating browser startup script..."
cat > $HOME_DIR/start-flightboard.sh << 'EOF'
#!/bin/bash
sleep 5
DISPLAY=:0 /usr/bin/chromium-browser --kiosk --no-sandbox http://localhost:5000
EOF

chmod +x $HOME_DIR/start-flightboard.sh
chown $CURRENT_USER:$CURRENT_USER $HOME_DIR/start-flightboard.sh

echo "✅ Browser startup script created"
echo ""

# Setup systemd service
echo "⚙️  Setting up systemd service..."
cat > /etc/systemd/system/flight-board.service << EOF
[Unit]
Description=Flight Board Display Service
After=network-online.target readsb.service
Wants=network-online.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$HOME_DIR/flight-board
Environment="PATH=$HOME_DIR/flight-board/venv/bin"
ExecStart=$HOME_DIR/flight-board/venv/bin/python3 $HOME_DIR/flight-board/flight_board.py
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable flight-board.service

echo "✅ Systemd service configured"
echo ""

# Verify readsb
echo "🔍 Checking readsb..."
if systemctl is-active --quiet readsb; then
    echo "✅ readsb is running"
    
    # Test API
    if curl -s http://localhost:8080/aircraft.json > /dev/null; then
        echo "✅ readsb API is responding"
    else
        echo "⚠️  readsb API not responding on port 8080"
        echo "   Make sure readsb is configured with --net-api-port 8080"
    fi
else
    echo "⚠️  readsb is not running"
    echo "   Start it with: sudo systemctl start readsb"
fi

echo ""
echo "========================================"
echo "✅ Setup Complete!"
echo "========================================"
echo ""
echo "📝 Next Steps:"
echo ""
echo "1. Edit your location in flight_board.py:"
echo "   RECEIVER_LAT = <your latitude>"
echo "   RECEIVER_LON = <your longitude>"
echo ""
echo "2. Start the service:"
echo "   sudo systemctl start flight-board"
echo ""
echo "3. Check service status:"
echo "   sudo systemctl status flight-board"
echo ""
echo "4. View logs:"
echo "   journalctl -u flight-board -f"
echo ""
echo "5. Access the display:"
echo "   http://localhost:5000"
echo "   or http://<pi-ip>:5000"
echo ""
echo "6. For fullscreen browser display:"
echo "   startx $HOME_DIR/start-flightboard.sh"
echo ""
echo "📚 Documentation: $HOME_DIR/flight-board/SETUP.md"
echo ""

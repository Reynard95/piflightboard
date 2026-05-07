# Flight Board Display - Setup Guide

A real-time flight board display for Raspberry Pi Zero 2W showing the closest aircraft detected by your RTL-SDR/readsb setup on a 2560x1080 ultrawide monitor.

## Requirements

- **Hardware**: Raspberry Pi Zero 2W (or similar)
- **Running Service**: readsb with HTTP API enabled (port 8080)
- **Display**: LG ultrawide (2560x1080) or similar
- **OS**: Raspberry Pi OS Lite or Desktop

## Installation

### 1. Install Python Dependencies

```bash
sudo apt-get update
sudo apt-get install python3-pip python3-venv

# Create virtual environment
python3 -m venv ~/flight-board-env
source ~/flight-board-env/bin/activate

# Install requirements
pip install -r requirements.txt
```

### 2. Configure readsb

Ensure readsb is running with the HTTP API enabled. Edit `/etc/default/readsb`:

```bash
sudo nano /etc/default/readsb
```

Make sure these options are set:
```
RECEIVER_OPTIONS="--net-only"
DECODER_OPTIONS=""
NET_OPTIONS="--net --net-heartbeat 60 --net-ro-size 1300 --net-ro-interval 1 --net-api-port 8080"
```

Then restart:
```bash
sudo systemctl restart readsb
```

Check it's running:
```bash
curl http://localhost:8080/aircraft.json | head -20
```

### 3. Update Flight Board Configuration

Edit `flight_board.py` and update your receiver location:

```python
RECEIVER_LAT = 52.0116   # Your latitude
RECEIVER_LON = 4.7093    # Your longitude
RECEIVER_ALT = 0         # Your altitude in meters
```

You can find your coordinates using Google Maps or similar tools.

### 4. Test Locally

```bash
source ~/flight-board-env/bin/activate
python3 flight_board.py
```

Then open a browser to:
- **From Pi**: `http://localhost:5000`
- **From another computer**: `http://pi-ip-address:5000`

## Auto-Start on Boot

### Option A: Systemd Service (Recommended)

Create a systemd service file:

```bash
sudo nano /etc/systemd/system/flight-board.service
```

Paste this content (adjust paths as needed):

```ini
[Unit]
Description=Flight Board Display
After=network-online.target readsb.service
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/home/pi/flight-board
Environment="PATH=/home/pi/flight-board-env/bin"
ExecStart=/home/pi/flight-board-env/bin/python3 /home/pi/flight-board/flight_board.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable flight-board.service
sudo systemctl start flight-board.service

# Check status
sudo systemctl status flight-board.service
```

### Option B: Cron (Alternative)

Add to crontab:
```bash
crontab -e
```

Add this line:
```
@reboot /home/pi/flight-board-env/bin/python3 /home/pi/flight-board/flight_board.py
```

## Display Setup

### Fullscreen Browser on Raspberry Pi OS Desktop

1. Install Chromium (if not already installed):
```bash
sudo apt-get install chromium-browser
```

2. Create a startup script `/home/pi/start-flightboard.sh`:

```bash
#!/bin/bash
sleep 5  # Wait for network and services
DISPLAY=:0 /usr/bin/chromium-browser --kiosk --no-sandbox http://localhost:5000
```

Make it executable:
```bash
chmod +x /home/pi/start-flightboard.sh
```

3. Add to autostart in `/home/pi/.config/lxsession/LXDE-pi/autostart`:

```
@/home/pi/start-flightboard.sh
```

### Keyboard Shortcuts

- **F**: Toggle fullscreen
- **ESC**: Exit fullscreen (if in kiosk mode, restart the browser)

## Troubleshooting

### No aircraft showing

1. Check readsb is running:
```bash
sudo systemctl status readsb
```

2. Check API is responding:
```bash
curl http://localhost:8080/aircraft.json
```

3. Verify location coordinates are set correctly in `flight_board.py`

### Logos not loading

- Check internet connection on Pi
- Verify the airline code extraction is working (check browser console logs)
- Logos are fetched from GitHub - if offline, they won't display but data will still show

### Port 5000 already in use

Change the port in `flight_board.py`:
```python
app.run(host='0.0.0.0', port=5001, debug=False)
```

### Pi Zero 2W is slow

- Reduce update frequency in HTML (change `UPDATE_INTERVAL` to 5000+)
- Run without desktop environment (Lite version)
- Monitor CPU usage: `top`

## Performance Tips

1. **Disable desktop**: Use Raspberry Pi OS Lite version for better performance
2. **Optimize display**: Use native resolution (2560x1080)
3. **Update interval**: Adjust `UPDATE_INTERVAL` in `flight_board.html` (default 2000ms)
4. **Browser**: Chromium in kiosk mode is lightweight

## Project Structure

```
flight-board/
├── flight_board.py          # Main Flask application
├── requirements.txt         # Python dependencies
├── templates/
│   └── flight_board.html   # Web interface
├── README.md               # This file
└── LICENSE
```

## Customization

### Change Colors

Edit the CSS in `flight_board.html`:
- `#00ff00` = green text (data values)
- `#64c8ff` = cyan text (route)
- `#ffaa00` = orange text (status)
- `#ff66ff` = magenta text (location)

### Change Logo Sources

The HTML has a mapping of airline codes to logo paths:

```javascript
const AIRLINE_LOGO_MAP = {
    'BAW': 'flightaware_logos/BA.png',  // British Airways
    'DLH': 'flightaware_logos/LH.png',  // Lufthansa
    // Add more mappings here
};
```

Choose from these sources in the airline-logos repo:
- `flightaware_logos/` - FlightAware logos
- `fr24_banners/` - Flightradar24 banners
- `radarbox_banners/` - RadarBox banners
- `custom_logos/` - Community logos

### Change Update Frequency

In `flight_board.html`, adjust:
```javascript
const UPDATE_INTERVAL = 2000; // milliseconds
```

## API Reference

### GET /api/closest-aircraft

Returns JSON with the closest aircraft:

```json
{
  "callsign": "BAW112",
  "icao": "C02234",
  "airline_code": "BAW",
  "altitude": 35000,
  "speed": 450,
  "distance": 12.3,
  "aircraft_type": "B777-300",
  "status": "Cruise",
  "latitude": 52.1234,
  "longitude": 4.5678,
  "timestamp": "2024-01-15T14:30:45.123456"
}
```

## License

See LICENSE file

## Support

For issues with:
- **readsb**: Check [readsb GitHub](https://github.com/Mictronics/readsb)
- **RTL-SDR**: Check [RTL-SDR guide](https://www.rtl-sdr.com/about-rtl-sdr/)
- **Raspberry Pi**: Check [Raspberry Pi docs](https://www.raspberrypi.com/documentation/)

## Credits

- Airline logos from [Jxck-S/airline-logos](https://github.com/Jxck-S/airline-logos)
- Flight data from [readsb](https://github.com/Mictronics/readsb)
- RTL-SDR hardware and tutorials

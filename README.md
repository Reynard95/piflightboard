# ✈️ Flight Board Display

A real-time flight board for your Raspberry Pi that displays the closest aircraft detected by your RTL-SDR/readsb setup on a 2560x1080 ultrawide monitor. Features LED board styling with live airline logos.

## Features

- 🛩️ **Real-time aircraft tracking** - displays closest aircraft to your location
- 🎨 **LED board styling** - matches the aesthetic from your inspiration image
- 🏢 **Airline logos** - integrates logos from the airline-logos repository
- 📡 **RTL-SDR integration** - connects directly to your readsb instance
- 📊 **Ultrawide optimized** - designed for 2560x1080 displays
- ⚡ **Lightweight** - runs efficiently on Raspberry Pi Zero 2W
- 🌐 **Web-based** - access from any browser on your network

## What It Shows

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  [AIRLINE LOGO]     QFA2                                            │
│                     ROUTE: 52.1234°N 4.5678°E                       │
│                     AIRCRAFT: A330-300                              │
│                     STATUS: Climbing                                │
│                     DISTANCE: 12.3 km                               │
│                     ALT: 35000 ft    SPD: 450 kt                    │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Hardware Requirements
- Raspberry Pi Zero 2W (or any Pi with network/GPIO capability)
- LG Ultrawide display (2560x1080) or HDMI monitor
- RTL-SDR dongle with readsb running
- Network connection

### Installation (5 minutes)

1. **Clone/download the project** to your Pi:
   ```bash
   cd ~
   git clone <repo> flight-board
   cd flight-board
   ```

2. **Run the setup script**:
   ```bash
   sudo bash install.sh
   ```

3. **Edit your location** in `flight_board.py`:
   ```python
   RECEIVER_LAT = 52.0116   # Your latitude
   RECEIVER_LON = 4.7093    # Your longitude
   ```

4. **Start the service**:
   ```bash
   sudo systemctl start flight-board
   ```

5. **Open in browser**:
   ```
   http://localhost:5000
   http://<your-pi-ip>:5000
   ```

## Configuration

### Basic Settings (flight_board.py)

```python
RECEIVER_LAT = 52.0116          # Your latitude
RECEIVER_LON = 4.7093           # Your longitude
RECEIVER_ALT = 0                # Your altitude in meters
READSB_HOST = "localhost"       # readsb host
READSB_PORT = 8080              # readsb API port
```

### Display Settings (flight_board.html)

```javascript
UPDATE_INTERVAL = 2000;         // Update frequency (milliseconds)
```

### Colors and Styling

Edit CSS variables in `flight_board.html`:
- Green (`#00ff00`) - Data values
- Cyan (`#64c8ff`) - Route
- Orange (`#ffaa00`) - Status
- Magenta (`#ff66ff`) - Location

## Systemd Service Management

```bash
# Start the service
sudo systemctl start flight-board

# Stop the service
sudo systemctl stop flight-board

# Restart
sudo systemctl restart flight-board

# Check status
sudo systemctl status flight-board

# View logs
journalctl -u flight-board -f

# Enable on boot (already done by install.sh)
sudo systemctl enable flight-board
```

## Full Screen Browser Display

For automatic fullscreen browser on boot:

1. **Using startx** (recommended for Lite):
   ```bash
   startx ~/start-flightboard.sh
   ```

2. **Using LXDE autostart** (Desktop):
   Add to `~/.config/lxsession/LXDE-pi/autostart`:
   ```
   @~/start-flightboard.sh
   ```

3. **Manual launch**:
   ```bash
   DISPLAY=:0 chromium-browser --kiosk http://localhost:5000
   ```

## Keyboard Shortcuts

- **F** - Toggle fullscreen
- **Esc** - Exit fullscreen

## Troubleshooting

### "No aircraft detected"
- Check readsb is running: `sudo systemctl status readsb`
- Test API: `curl http://localhost:8080/aircraft.json`
- Verify RTL-SDR dongle is plugged in
- Check receiver coordinates are correct

### Logos not loading
- Check internet connection (GitHub access needed)
- Check browser console for errors (F12)
- Logos will fail gracefully; data still displays

### Service won't start
```bash
# Check logs
journalctl -u flight-board -n 50

# Check Python errors
/home/pi/flight-board/venv/bin/python3 /home/pi/flight-board/flight_board.py
```

### Performance issues on Pi Zero 2W
- Increase `UPDATE_INTERVAL` to 5000+ (5+ seconds)
- Use Raspberry Pi OS Lite instead of Desktop
- Check CPU usage: `top`

## API Endpoint

### GET /api/closest-aircraft

Returns JSON with current closest aircraft:

```json
{
  "callsign": "BAW112",
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

## Project Structure

```
flight-board/
├── flight_board.py              # Main Flask application
├── requirements.txt             # Python dependencies
├── config.ini                   # Configuration file
├── install.sh                   # Automated setup script
├── start-flightboard.sh         # Browser startup script
├── flight-board.service         # Systemd service file
├── templates/
│   └── flight_board.html       # Web interface
├── SETUP.md                    # Detailed setup guide
└── README.md                   # This file
```

## Customization

### Change Logo Source

Edit the path in `flight_board.html`:

```javascript
const AIRLINE_LOGO_MAP = {
    'BAW': 'flightaware_logos/BA.png',  // or
    'BAW': 'fr24_banners/ba.svg',       // or
    'BAW': 'radarbox_banners/ba.png',   // or
    'BAW': 'custom_logos/ba.png',
};
```

Available sources from [Jxck-S/airline-logos](https://github.com/Jxck-S/airline-logos):
- `flightaware_logos/` - Best for logos
- `fr24_banners/` - Rectangular banners
- `radarbox_banners/` - RadarBox style
- `custom_logos/` - Community submissions

### Change Update Frequency

Slower Pi? Increase update time:

```javascript
// In flight_board.html
const UPDATE_INTERVAL = 5000;  // 5 seconds instead of 2
```

### Change Display Colors

Edit CSS in `flight_board.html`:

```css
.info-value {
    color: #00ff00;  /* Change this hex code */
    text-shadow: 0 0 8px rgba(0, 255, 0, 0.8);
}
```

## Performance Notes

| Hardware | Update Interval | Notes |
|----------|-----------------|-------|
| Pi Zero 2W | 2000-3000ms | Default, good balance |
| Pi Zero 2W Lite | 1000ms | Can handle faster updates |
| Pi 4 | 500ms | Much faster possible |
| Pi 5 | 200ms | Very responsive |

## Requirements

- Python 3.7+
- Flask 3.0.0
- Requests 2.31.0
- readsb with HTTP API on port 8080

## Antenna Tips

For best results with your RTL-SDR:
- Use a quarter-wave antenna (~30cm for 1090 MHz)
- Place antenna as high as possible
- Minimize metal obstructions
- Point antenna skyward at an angle

## Links

- [readsb Documentation](https://github.com/Mictronics/readsb)
- [RTL-SDR Project](https://www.rtl-sdr.com/)
- [Airline Logos Repo](https://github.com/Jxck-S/airline-logos)
- [Raspberry Pi Documentation](https://www.raspberrypi.com/documentation/)

## License

MIT License - Feel free to modify and use as needed.

## Support & Contributions

For issues or suggestions:
1. Check the SETUP.md troubleshooting section
2. Review the systemd logs: `journalctl -u flight-board`
3. Test the API directly: `curl http://localhost:8080/aircraft.json`

---

**Enjoy tracking aircraft in style! ✈️**

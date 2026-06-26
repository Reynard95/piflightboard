# ESP32-S3 AMOLED Radar Configuration

# WiFi Settings
WIFI_SSID = "Erasmus Huis"  # Change me
WIFI_PASSWORD = "Erasmus@Gouda"  # Change me
WIFI_TIMEOUT = 30  # seconds

# Receiver Settings (Pi with readsb)
PI_IP = "192.168.2.42"  # Change to your Pi's local IP
PI_PORT = 80  # lighttpd port
AIRCRAFT_ENDPOINT = "/data/aircraft.json"

# Receiver Location (from config/readsb.conf)
# These must match your receiver's actual location!
RECEIVER_LAT = 52.0116  # Change if your receiver location is different
RECEIVER_LON = 4.7683

# Display Settings
DISPLAY_WIDTH = 368
DISPLAY_HEIGHT = 448
DISPLAY_ROTATION = 0  # 0, 1, 2, or 3
BACKLIGHT_PIN = 46
SPI_FREQ = 40_000_000  # Hz

# Radar Display
RADAR_RANGE_NM = 5  # Nautical miles to show (range ring)
RADAR_CENTER_X = DISPLAY_WIDTH // 2
RADAR_CENTER_Y = DISPLAY_HEIGHT // 2 - 30
RADAR_RADIUS_PX = 90  # Physical radius in pixels

# Colors (16-bit RGB565)
COLOR_BG = 0x0000  # Black
COLOR_GRID = 0x2104  # Dark gray
COLOR_TEXT = 0xFFFF  # White
COLOR_AIRCRAFT = 0xF800  # Red
COLOR_SELECTED = 0x07E0  # Green
COLOR_COMPASS = 0x7E0  # Green

# Update Timing
FETCH_INTERVAL = 2  # seconds between aircraft data fetches
RENDER_INTERVAL = 50  # milliseconds between screen redraws
INACTIVITY_TIMEOUT = 60  # seconds before clearing selected aircraft

# Feature Flags
SHOW_COMPASS = True
SHOW_RANGE_RINGS = True
SHOW_GRID_LINES = True
SHOW_CALLSIGNS = True  # Show callsign text on aircraft
TOUCH_ENABLED = True
DEBUG_MODE = False  # Print HTTP response times and data

# Network Retry
FETCH_RETRIES = 3
FETCH_TIMEOUT = 5  # seconds

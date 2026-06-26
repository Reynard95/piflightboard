# ESP32-S3 AMOLED — Configuration
# Copy this file to config.py and fill in your values.

# ── WiFi ─────────────────────────────────────────────────────────────────────
WIFI_SSID     = "YourNetworkName"
WIFI_PASSWORD = "YourNetworkPassword"
WIFI_TIMEOUT  = 30  # seconds

# ── Pi (running readsb + lighttpd) ───────────────────────────────────────────
PI_IP              = "192.168.x.x"   # local IP of your Pi
PI_PORT            = 80
AIRCRAFT_ENDPOINT  = "/data/aircraft.json"

# ── Receiver location (keep in sync with config/readsb.conf --lat / --lon) ───
RECEIVER_LAT = 0.0    # decimal degrees, e.g. 52.00818
RECEIVER_LON = 0.0    # decimal degrees, e.g. 4.71261

# ── Display ───────────────────────────────────────────────────────────────────
DISPLAY_WIDTH    = 368
DISPLAY_HEIGHT   = 448
DISPLAY_ROTATION = 0
BACKLIGHT_PIN    = 46
SPI_FREQ         = 40_000_000

# ── Radar ─────────────────────────────────────────────────────────────────────
RADAR_RANGE_NM  = 5
RADAR_CENTER_X  = DISPLAY_WIDTH // 2
RADAR_CENTER_Y  = DISPLAY_HEIGHT // 2 - 30
RADAR_RADIUS_PX = 90

# ── Colors (RGB565) ───────────────────────────────────────────────────────────
COLOR_BG       = 0x0000
COLOR_GRID     = 0x2104
COLOR_TEXT     = 0xFFFF
COLOR_AIRCRAFT = 0xF800
COLOR_SELECTED = 0x07E0
COLOR_COMPASS  = 0x07E0

# ── Timing ────────────────────────────────────────────────────────────────────
FETCH_INTERVAL      = 2
RENDER_INTERVAL     = 50
INACTIVITY_TIMEOUT  = 60
FETCH_RETRIES       = 3
FETCH_TIMEOUT       = 5

# ── Features ──────────────────────────────────────────────────────────────────
SHOW_COMPASS    = True
SHOW_RANGE_RINGS = True
SHOW_GRID_LINES = True
SHOW_CALLSIGNS  = True
TOUCH_ENABLED   = True
DEBUG_MODE      = False

# Pico Radar — Configuration
# Copy this file to config.py and fill in your values.

# ── WiFi ─────────────────────────────────────────────────────────────────────
WIFI_SSID     = "YourNetworkName"
WIFI_PASSWORD = "YourNetworkPassword"
WIFI_TIMEOUT  = 20  # seconds

# ── Pi flight board ───────────────────────────────────────────────────────────
PI_IP              = "192.168.x.x"   # local IP of your Pi
PI_PORT            = 80
AIRCRAFT_ENDPOINT  = "/data/aircraft.json"
FETCH_INTERVAL     = 5               # seconds between data fetches
FETCH_TIMEOUT      = 5               # request timeout in seconds

# ── Receiver location (keep in sync with config/readsb.conf --lat / --lon) ───
RECEIVER_LAT = 0.0    # decimal degrees, e.g. 52.00818
RECEIVER_LON = 0.0    # decimal degrees, e.g. 4.71261

# ── Radar ─────────────────────────────────────────────────────────────────────
RANGE_OPTIONS = [10, 25, 50, 100, 200, 400]

# ── Waveshare Pico LCD 1.44" (ST7735S, 128×128) ──────────────────────────────
LCD_SPI_ID = 1
LCD_SCK    = 10
LCD_MOSI   = 11
LCD_CS     = 9
LCD_DC     = 8
LCD_RST    = 12
LCD_BL     = 13

LCD_WIDTH  = 128
LCD_HEIGHT = 128
LCD_SPI_FREQ = 40_000_000

LCD_X_OFFSET = 2
LCD_Y_OFFSET = 1
LCD_MADCTL = 0x08

# ── Buttons (active LOW) ──────────────────────────────────────────────────────
BTN_RANGE = 15
BTN_MODE  = 17
BTN_PREV  = 2
BTN_NEXT  = 18

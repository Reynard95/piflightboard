"""
portal.py — ESP32 captive portal for first-run WiFi + location setup.

Boots the ESP32 as a WiFi access point named "FlightBoard-Setup", serves a
small HTML form at http://192.168.4.1, and writes the submitted values to
config.py before rebooting into normal station mode.

Called by boot.py when WIFI_SSID is empty or unconfigured.
"""

import network
import socket
import time
import machine

# Display is optional — if it fails (wrong board / missing driver) portal still works
def _try_show_portal_qr():
    try:
        from machine import Pin, SPI
        import st7789
        import config
        import qr as _qr
        spi = SPI(1, baudrate=config.SPI_FREQ, polarity=1, phase=1)
        tft = st7789.ST7789(
            spi, config.DISPLAY_WIDTH, config.DISPLAY_HEIGHT,
            reset=Pin(5, Pin.OUT), cs=Pin(6, Pin.OUT),
            dc=Pin(4, Pin.OUT), backlight=Pin(config.BACKLIGHT_PIN, Pin.OUT),
        )
        tft.init()
        tft.rotation = config.DISPLAY_ROTATION

        url = f"http://{AP_IP}"
        matrix = _qr.generate(url)
        size = len(matrix)
        scale = max(1, (min(config.DISPLAY_WIDTH, config.DISPLAY_HEIGHT) - 60) // size)
        qr_px = size * scale
        x0 = (config.DISPLAY_WIDTH  - qr_px) // 2
        y0 = (config.DISPLAY_HEIGHT - qr_px) // 2 + 24

        tft.fill(0xFFFF)  # white
        label = "FlightBoard-Setup"
        tft.text(label, (config.DISPLAY_WIDTH - len(label) * 8) // 2, y0 - 22, 0x0000)
        sub = f"Wi-Fi: {AP_SSID}"
        tft.text(sub, (config.DISPLAY_WIDTH - len(sub) * 8) // 2, y0 - 12, 0x4208)

        for r, row in enumerate(matrix):
            for c, dark in enumerate(row):
                color = 0x0000 if dark else 0xFFFF
                tft.fill_rect(x0 + c * scale, y0 + r * scale, scale, scale, color)
    except Exception as e:
        print(f"[Portal] Display init skipped: {e}")

AP_SSID    = "FlightBoard-Setup"
AP_IP      = "192.168.4.1"
LISTEN_PORT = 80

# Minimal inline CSS — kept small to fit in RAM
_CSS = """
body{font-family:monospace;background:#111;color:#eee;margin:0;padding:16px}
h1{font-size:1.1rem;margin:0 0 4px}
p.sub{color:#888;font-size:.8rem;margin:0 0 20px}
label{display:block;font-size:.8rem;color:#aaa;margin:8px 0 2px}
input{width:100%;box-sizing:border-box;background:#222;border:1px solid #444;
  color:#fff;padding:8px;font-family:monospace;font-size:.9rem;border-radius:4px}
input:focus{outline:none;border-color:#0af}
.row{display:flex;gap:8px}
.row input{flex:1}
button{margin-top:20px;width:100%;padding:12px;background:#0af;color:#000;
  border:none;font-family:monospace;font-size:1rem;font-weight:bold;
  border-radius:4px;cursor:pointer}
button:active{background:#08c}
.hint{font-size:.75rem;color:#666;margin-top:6px}
"""

_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>FlightBoard Setup</title>
<style>{css}</style>
</head>
<body>
<h1>&#9992; FlightBoard Setup</h1>
<p class="sub">Connect once — the device will reboot and join your network.</p>
<form method="POST" action="/save">
  <label>WiFi Network (SSID)</label>
  <input name="ssid" type="text" placeholder="MyNetwork" required autocomplete="off">

  <label>WiFi Password</label>
  <input name="password" type="password" placeholder="leave blank if open" autocomplete="off">

  <label>Pi IP Address</label>
  <input name="pi_ip" type="text" placeholder="192.168.1.x" value="flighttracker.local" required>
  <p class="hint">Hostname or IP of the Pi running readsb + lighttpd.</p>

  <label>Receiver Location (optional — auto-fetched from Pi if left as 0)</label>
  <div class="row">
    <input name="lat" type="number" step="0.00001" placeholder="Latitude" value="0">
    <input name="lon" type="number" step="0.00001" placeholder="Longitude" value="0">
  </div>
  <p class="hint">Leave 0,0 to auto-fetch from the Pi after connecting.</p>

  <button type="submit">Save &amp; Reboot</button>
</form>
</body>
</html>
""".replace("{css}", _CSS)

_SAVED_HTML = """\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Saved</title>
<style>body{font-family:monospace;background:#111;color:#eee;
  display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{text-align:center}h2{color:#0f0}</style>
</head>
<body><div class="box"><h2>&#10003; Saved!</h2><p>Rebooting into your network&hellip;</p></div></body>
</html>
"""


def _parse_qs(body: str) -> dict:
    """Parse application/x-www-form-urlencoded body into a dict."""
    params = {}
    for pair in body.split("&"):
        if "=" in pair:
            k, _, v = pair.partition("=")
            params[_unquote(k)] = _unquote(v)
    return params


def _unquote(s: str) -> str:
    """Minimal URL percent-decode + plus-to-space."""
    s = s.replace("+", " ")
    out = []
    i = 0
    while i < len(s):
        if s[i] == "%" and i + 2 < len(s):
            try:
                out.append(chr(int(s[i+1:i+3], 16)))
                i += 3
                continue
            except ValueError:
                pass
        out.append(s[i])
        i += 1
    return "".join(out)


def _write_config(params: dict) -> None:
    """Write a fresh config.py from the submitted form values."""
    ssid     = params.get("ssid", "").replace('"', '\\"')
    password = params.get("password", "").replace('"', '\\"')
    pi_ip    = params.get("pi_ip", "flighttracker.local").replace('"', '\\"')
    lat      = params.get("lat", "0.0")
    lon      = params.get("lon", "0.0")

    try:
        lat = float(lat)
        lon = float(lon)
    except ValueError:
        lat = 0.0
        lon = 0.0

    content = f'''# ESP32-S3 AMOLED Configuration (written by setup portal)

# WiFi Settings
WIFI_SSID     = "{ssid}"
WIFI_PASSWORD = "{password}"
WIFI_TIMEOUT  = 30

# Receiver Settings (Pi with readsb)
PI_IP             = "{pi_ip}"
PI_PORT           = 80
AIRCRAFT_ENDPOINT = "/data/aircraft.json"

# Receiver Location
# Set to 0.0 to auto-fetch from the Pi on startup.
RECEIVER_LAT = {lat}
RECEIVER_LON = {lon}

# Display Settings
DISPLAY_WIDTH    = 368
DISPLAY_HEIGHT   = 448
DISPLAY_ROTATION = 0
BACKLIGHT_PIN    = 46
SPI_FREQ         = 40_000_000

# Radar Display
RADAR_RANGE_NM  = 5
RADAR_CENTER_X  = DISPLAY_WIDTH // 2
RADAR_CENTER_Y  = DISPLAY_HEIGHT // 2 - 30
RADAR_RADIUS_PX = 90

# Colors (RGB565)
COLOR_BG       = 0x0000
COLOR_GRID     = 0x2104
COLOR_TEXT     = 0xFFFF
COLOR_AIRCRAFT = 0xF800
COLOR_SELECTED = 0x07E0
COLOR_COMPASS  = 0x07E0

# Update Timing
FETCH_INTERVAL     = 2
RENDER_INTERVAL    = 50
INACTIVITY_TIMEOUT = 60
FETCH_RETRIES      = 3
FETCH_TIMEOUT      = 5

# Features
SHOW_COMPASS     = True
SHOW_RANGE_RINGS = True
SHOW_GRID_LINES  = True
SHOW_CALLSIGNS   = True
TOUCH_ENABLED    = True
DEBUG_MODE       = False
'''
    with open("config.py", "w") as f:
        f.write(content)


def _send(conn, status: str, body: str, content_type: str = "text/html") -> None:
    response = (
        f"HTTP/1.1 {status}\r\n"
        f"Content-Type: {content_type}; charset=utf-8\r\n"
        f"Content-Length: {len(body.encode())}\r\n"
        "Connection: close\r\n"
        "\r\n"
    )
    conn.sendall(response.encode() + body.encode())


def _handle(conn) -> bool:
    """Handle one HTTP request. Returns True if we should reboot."""
    conn.settimeout(5.0)
    data = b""
    try:
        while True:
            chunk = conn.recv(1024)
            if not chunk:
                break
            data += chunk
            if b"\r\n\r\n" in data:
                break
    except OSError:
        pass

    text = data.decode("utf-8", "replace")
    first_line = text.split("\r\n", 1)[0]

    if first_line.startswith("POST /save"):
        # Parse Content-Length to read the body
        body = ""
        if "\r\n\r\n" in text:
            headers_part, body = text.split("\r\n\r\n", 1)
        params = _parse_qs(body)
        _write_config(params)
        _send(conn, "200 OK", _SAVED_HTML)
        return True  # signal reboot
    else:
        _send(conn, "200 OK", _HTML)
        return False


def start():
    """Start the AP + HTTP server. Blocks until config is saved, then reboots."""
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    ap.config(essid=AP_SSID, authmode=network.AUTH_OPEN)

    deadline = time.time() + 3
    while not ap.active() and time.time() < deadline:
        time.sleep(0.1)

    print(f"[Portal] AP '{AP_SSID}' started. Connect and open http://{AP_IP}")
    _try_show_portal_qr()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    server.bind(("", LISTEN_PORT))
    server.listen(2)
    server.settimeout(1.0)

    while True:
        try:
            conn, addr = server.accept()
        except OSError:
            continue
        try:
            should_reboot = _handle(conn)
        finally:
            conn.close()
        if should_reboot:
            print("[Portal] Config saved — rebooting in 1s...")
            time.sleep(1)
            machine.reset()

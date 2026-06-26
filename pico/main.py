"""Pico radar — live ADS-B radar on Waveshare Pico LCD 1.44"."""

import gc
import math
import time
import network

time.sleep(3)   # interrupt window — lets mpremote cp run before the main loop starts
import urequests
import ujson
import framebuf
from machine import Pin

import config
from st7735 import ST7735, c16

# ── Colours ───────────────────────────────────────────────────────────────────
# All standard RGB565 values, byte-swapped via c16() for framebuf compatibility.

BLACK    = c16(0x0000)
AMBER    = c16(0xFD08)   # level flight / fg       #FFA040
RED      = c16(0xFAAA)   # descending               #FF5555
GREEN    = c16(0x376A)   # climbing                 #33EE55
BLUE     = c16(0x44DF)   # on ground                #4499FF
YELLOW   = c16(0xFFE0)   # selected aircraft
AMBERM   = c16(0xCB84)   # mid amber — rings        #CC7020
AMBERD   = c16(0x7A02)   # dim amber — grid/labels  #7A4010
AMBERDD  = c16(0x4101)   # very dim amber
DKGRAY   = c16(0x0841)   # status bar background


# ── Geometry ──────────────────────────────────────────────────────────────────
_KM_PER_LAT = 111.32
_KM_PER_LON = _KM_PER_LAT * math.cos(math.radians(config.RECEIVER_LAT))

# Radar circle geometry (pixels, within 128×128 canvas)
_CX = 64   # centre X
_CY = 64   # centre Y
_R  = 54   # full-range radius

# ── Hardware setup ────────────────────────────────────────────────────────────
lcd = ST7735(config)

_buf = bytearray(128 * 128 * 2)
_fb  = framebuf.FrameBuffer(_buf, 128, 128, framebuf.RGB565)

_btn_range = Pin(config.BTN_RANGE, Pin.IN, Pin.PULL_UP)
_btn_mode  = Pin(config.BTN_MODE,  Pin.IN, Pin.PULL_UP)
_btn_prev  = Pin(config.BTN_PREV,  Pin.IN, Pin.PULL_UP)
_btn_next  = Pin(config.BTN_NEXT,  Pin.IN, Pin.PULL_UP)
_BUTTONS   = (_btn_range, _btn_mode, _btn_prev, _btn_next)
_btn_last  = [True, True, True, True]   # True = not pressed (active-LOW)

# ── Application state ─────────────────────────────────────────────────────────
_mode       = 'radar'   # 'radar' | 'list'
_range_idx  = 0         # index into RANGE_OPTIONS
_sel_idx    = 0         # selected aircraft index
_aircraft   = []        # current aircraft list, sorted by distance
_wifi_ok    = False
_last_fetch = None      # None → fetch immediately on first loop

# ── WiFi ──────────────────────────────────────────────────────────────────────
_wlan = network.WLAN(network.STA_IF)
_wlan.active(True)


def _connect_wifi():
    global _wifi_ok
    if _wlan.isconnected():
        _wifi_ok = True
        return
    print("WiFi: connecting to", config.WIFI_SSID)
    _wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
    deadline = time.time() + config.WIFI_TIMEOUT
    while not _wlan.isconnected():
        if time.time() > deadline:
            print("WiFi: timeout")
            _wifi_ok = False
            return
        time.sleep_ms(200)
    _wifi_ok = True
    print("WiFi: connected,", _wlan.ifconfig()[0])


# ── Drawing helpers ───────────────────────────────────────────────────────────

def _circle(cx, cy, r, color):
    """Bresenham midpoint circle — clips to 128×128."""
    x, y, d = 0, r, 1 - r
    while x <= y:
        for px, py in ((cx+x, cy+y), (cx-x, cy+y), (cx+x, cy-y), (cx-x, cy-y),
                       (cx+y, cy+x), (cx-y, cy+x), (cx+y, cy-x), (cx-y, cy-x)):
            if 0 <= px < 128 and 0 <= py < 128:
                _fb.pixel(px, py, color)
        if d < 0:
            d += 2*x + 3
        else:
            d += 2*(x - y) + 5
            y -= 1
        x += 1


def _geo_to_px(lat, lon, range_km):
    dx = (lon - config.RECEIVER_LON) * _KM_PER_LON
    dy = (lat - config.RECEIVER_LAT) * _KM_PER_LAT
    x = int(_CX + (dx / range_km) * _R)
    y = int(_CY - (dy / range_km) * _R)
    return x, y


def _blip_color(ac):
    if ac.get('alt_baro') == 'ground':
        return BLUE
    vr = ac.get('baro_rate') or 0
    if vr > 300:
        return GREEN
    if vr < -300:
        return RED
    return AMBER


def _alt_str(alt):
    if alt == 'ground':
        return 'GND'
    if isinstance(alt, (int, float)):
        return str(int(alt // 100) * 100)
    return '?'


def _cs_str(ac):
    return ((ac.get('flight') or ac.get('hex') or '?').strip())


def _pad(s, n):
    s = s[:n]
    return s + ' ' * (n - len(s))


# ── Views ─────────────────────────────────────────────────────────────────────

def _draw_radar():
    range_km = config.RANGE_OPTIONS[_range_idx]
    _fb.fill(BLACK)

    # Range rings (1/3, 2/3, full)
    _circle(_CX, _CY, _R // 3,       AMBERD)
    _circle(_CX, _CY, (_R * 2) // 3, AMBERD)
    _circle(_CX, _CY, _R,            AMBERM)

    # Crosshairs
    _fb.hline(_CX - _R, _CY, _R * 2 + 1, AMBERD)
    _fb.vline(_CX, _CY - _R, _R * 2 + 1, AMBERD)

    # Cardinal labels (just inside the canvas edges)
    _fb.text('N', 61,   2,  AMBERD)
    _fb.text('S', 61, 118,  AMBERD)
    _fb.text('E', 118,  60, AMBERD)
    _fb.text('W',   2,  60, AMBERD)

    # Aircraft blips + heading vectors
    n_shown = 0
    for i, ac in enumerate(_aircraft):
        if ac.get('_dist', 9999) > range_km:
            continue
        x, y = _geo_to_px(ac['lat'], ac['lon'], range_km)
        if not (0 <= x < 128 and 0 <= y < 128):
            continue
        n_shown += 1
        color = YELLOW if i == _sel_idx else _blip_color(ac)

        # Heading vector — short line from blip in direction of travel
        track = ac.get('track')
        if track is not None and (ac.get('gs') or 0) > 10:
            trad = math.radians(track)
            vx = int(math.sin(trad) * 9)
            vy = int(-math.cos(trad) * 9)
            ex, ey = x + vx, y + vy
            if 0 <= ex < 128 and 0 <= ey < 128:
                _fb.line(x, y, ex, ey, AMBERM)

        if i == _sel_idx:
            _circle(x, y, 5, YELLOW)
        _fb.fill_rect(x - 1, y - 1, 3, 3, color)



def _draw_list():
    range_km = config.RANGE_OPTIONS[_range_idx]
    _fb.fill(BLACK)

    # Header
    _fb.text(_pad('LIST ' + str(range_km) + 'KM', 15), 0, 0, AMBER)
    _fb.text('W' if _wifi_ok else '!', 120, 0, GREEN if _wifi_ok else RED)

    visible = [(i, ac) for i, ac in enumerate(_aircraft)
               if ac.get('_dist', 9999) <= range_km]

    for row, (orig_i, ac) in enumerate(visible[:11]):
        y = 10 + row * 11
        cs   = _pad(_cs_str(ac), 8)
        alt  = _pad(_alt_str(ac.get('alt_baro')), 5)
        dist = str(int(ac.get('_dist', 0))) + 'K'
        line = (cs + alt + _pad(dist, 3))[:16]
        if orig_i == _sel_idx:
            color = YELLOW
        elif row % 2 == 0:
            color = AMBER
        else:
            color = AMBERD
        _fb.text(line, 0, y, color)


def _draw_splash(msg):
    _fb.fill(BLACK)
    x = max(0, (128 - len(msg) * 8) // 2)
    _fb.text(msg[:16], x, 60, AMBER)
    lcd.show(_buf)


# ── Data fetch ────────────────────────────────────────────────────────────────

def _fetch():
    global _aircraft, _wifi_ok, _sel_idx
    if not _wlan.isconnected():
        _connect_wifi()
    if not _wifi_ok:
        return

    gc.collect()
    url = 'http://{}:{}{}'.format(config.PI_IP, config.PI_PORT, config.AIRCRAFT_ENDPOINT)
    try:
        r = urequests.get(url, timeout=config.FETCH_TIMEOUT)
        raw = r.text
        r.close()
    except Exception as e:
        print('fetch error:', e)
        _wifi_ok = False
        return

    gc.collect()
    try:
        data = ujson.loads(raw)
    except Exception as e:
        print('json error:', e)
        return
    finally:
        del raw
        gc.collect()

    new_list = []
    max_range = max(config.RANGE_OPTIONS)
    for ac in data.get('aircraft', []):
        if not (ac.get('lat') and ac.get('lon')):
            continue
        dx = (ac['lon'] - config.RECEIVER_LON) * _KM_PER_LON
        dy = (ac['lat'] - config.RECEIVER_LAT) * _KM_PER_LAT
        ac['_dist'] = math.sqrt(dx * dx + dy * dy)
        if ac['_dist'] <= max_range:
            new_list.append(ac)

    new_list.sort(key=lambda a: a['_dist'])
    _aircraft = new_list
    _wifi_ok  = True
    if _sel_idx >= len(_aircraft):
        _sel_idx = max(0, len(_aircraft) - 1)
    print('fetch ok:', len(_aircraft), 'aircraft')


# ── Main loop ─────────────────────────────────────────────────────────────────

_draw_splash('CONNECTING...')
_connect_wifi()
if not _wifi_ok:
    _draw_splash('NO WIFI')

while True:
    now = time.ticks_ms()

    # ── Button edges (falling = press, active-LOW) ───────────────────────────
    states  = [not b.value() for b in _BUTTONS]
    pressed = [states[i] and not _btn_last[i] for i in range(4)]
    _btn_last[:] = states

    redraw = False

    if pressed[0]:   # RANGE — cycle range
        _range_idx = (_range_idx + 1) % len(config.RANGE_OPTIONS)
        redraw = True

    if pressed[1]:   # MODE — toggle radar / list
        _mode = 'list' if _mode == 'radar' else 'radar'
        redraw = True

    if pressed[2]:   # PREV — select previous aircraft
        if _aircraft:
            _sel_idx = max(0, _sel_idx - 1)
            redraw = True

    if pressed[3]:   # NEXT — select next aircraft
        if _aircraft:
            _sel_idx = min(len(_aircraft) - 1, _sel_idx + 1)
            redraw = True

    # ── Periodic fetch ────────────────────────────────────────────────────────
    if _last_fetch is None or time.ticks_diff(now, _last_fetch) >= config.FETCH_INTERVAL * 1000:
        _fetch()
        _last_fetch = now
        redraw = True

    # ── Render ────────────────────────────────────────────────────────────────
    if redraw:
        if _mode == 'radar':
            _draw_radar()
        else:
            _draw_list()
        lcd.show(_buf)

    time.sleep_ms(20)   # ~50 Hz

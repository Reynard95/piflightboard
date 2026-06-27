#!/usr/bin/env python3
"""
ESP32-S3 AMOLED Real-Time Radar
Displays live ADS-B radar from Raspberry Pi readsb
"""

import json
import math
import time
import gc
import network
import urequests as requests
from machine import Pin, SPI, I2C
import st7789
import config

# Global state
class RadarState:
    aircraft = []
    selected_aircraft = None
    last_fetch = 0
    last_render = 0
    selected_timeout = 0
    frame_count = 0
    
state = RadarState()

# ==================== Display Setup ====================

def init_display():
    """Initialize SPI and st7789 display driver"""
    # SPI pins for ESP32-S3
    spi = SPI(1, baudrate=config.SPI_FREQ, polarity=1, phase=1)
    tft = st7789.ST7789(
        spi,
        config.DISPLAY_WIDTH,
        config.DISPLAY_HEIGHT,
        reset=Pin(5, Pin.OUT),
        cs=Pin(6, Pin.OUT),
        dc=Pin(4, Pin.OUT),
        backlight=Pin(config.BACKLIGHT_PIN, Pin.OUT),
    )
    tft.init()
    tft.rotation = config.DISPLAY_ROTATION
    tft.fill(config.COLOR_BG)
    return tft

# ==================== Network ====================

def connect_wifi():
    """Connect to WiFi network"""
    print(f"[WiFi] Connecting to {config.WIFI_SSID}...")
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(config.WIFI_SSID, config.WIFI_PASSWORD)
    
    start = time.time()
    while not wlan.isconnected():
        if time.time() - start > config.WIFI_TIMEOUT:
            print("[WiFi] Connection timeout!")
            return False
        print(".", end="")
        time.sleep(0.5)
    
    print(f"\n[WiFi] Connected! IP: {wlan.ifconfig()[0]}")
    return True

def fetch_location_from_pi():
    """Fetch receiver lat/lon from the Pi's /api/location endpoint.
    Mutates config.RECEIVER_LAT/LON so the rest of the code picks it up.
    Called once after WiFi connects when the config has 0,0 coordinates.
    """
    url = f"http://{config.PI_IP}:{config.PI_PORT}/api/location"
    try:
        resp = requests.get(url, timeout=config.FETCH_TIMEOUT)
        if resp.status_code == 200:
            data = resp.json()
            lat = float(data.get("lat", 0.0))
            lon = float(data.get("lon", 0.0))
            resp.close()
            if lat != 0.0 or lon != 0.0:
                config.RECEIVER_LAT = lat
                config.RECEIVER_LON = lon
                print(f"[Location] Got from Pi: {lat:.5f}, {lon:.5f}")
                return True
        resp.close()
    except Exception as e:
        print(f"[Location] Fetch failed: {e}")
    return False


def fetch_aircraft():
    """Fetch aircraft data from Pi's readsb JSON endpoint"""
    url = f"http://{config.PI_IP}:{config.PI_PORT}{config.AIRCRAFT_ENDPOINT}"
    
    try:
        start_ms = time.ticks_ms()
        resp = requests.get(url, timeout=config.FETCH_TIMEOUT)
        elapsed_ms = time.ticks_diff(time.ticks_ms(), start_ms)
        
        if resp.status_code == 200:
            data = resp.json()
            state.aircraft = data.get("aircraft", [])
            
            if config.DEBUG_MODE:
                print(f"[API] Fetched {len(state.aircraft)} aircraft in {elapsed_ms}ms")
            
            resp.close()
            return True
        else:
            print(f"[API] HTTP {resp.status_code}")
            resp.close()
            return False
            
    except Exception as e:
        print(f"[API] Error: {e}")
        return False

# ==================== Geo Calculations ====================

def deg_to_rad(deg):
    return deg * math.pi / 180.0

def haversine_distance(lat1, lon1, lat2, lon2):
    """Distance in nautical miles"""
    R_NM = 3440.65  # Earth radius in nautical miles
    
    lat1_r = deg_to_rad(lat1)
    lat2_r = deg_to_rad(lat2)
    dlat = deg_to_rad(lat2 - lat1)
    dlon = deg_to_rad(lon2 - lon1)
    
    a = math.sin(dlat / 2)**2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R_NM * c

def initial_bearing(lat1, lon1, lat2, lon2):
    """Bearing from point 1 to point 2, in degrees (0=North)"""
    lat1_r = deg_to_rad(lat1)
    lat2_r = deg_to_rad(lat2)
    dlon = deg_to_rad(lon2 - lon1)
    
    y = math.sin(dlon) * math.cos(lat2_r)
    x = math.cos(lat1_r) * math.sin(lat2_r) - math.sin(lat1_r) * math.cos(lat2_r) * math.cos(dlon)
    bearing = math.atan2(y, x)
    bearing_deg = (bearing * 180.0 / math.pi + 360) % 360
    return bearing_deg

def radar_coords(dist_nm, bearing_deg):
    """Convert distance & bearing to radar display X,Y"""
    if config.RADAR_RANGE_NM == 0:
        return None
    
    # Clamp distance to range
    if dist_nm > config.RADAR_RANGE_NM:
        return None
    
    # Scale distance to pixels
    r = (dist_nm / config.RADAR_RANGE_NM) * config.RADAR_RADIUS_PX
    
    # Convert bearing to radians (0° = North = -pi/2 in standard coords)
    angle_rad = deg_to_rad(bearing_deg - 90)  # Rotate so North is up
    
    x = config.RADAR_CENTER_X + r * math.cos(angle_rad)
    y = config.RADAR_CENTER_Y + r * math.sin(angle_rad)
    
    return (int(x), int(y))

# ==================== Drawing ====================

def draw_radar_frame(tft):
    """Draw static radar elements"""
    tft.fill(config.COLOR_BG)
    
    # Title
    tft.text("RADAR  {:d}NM".format(config.RADAR_RANGE_NM), 10, 8, config.COLOR_TEXT)
    
    # Center point (receiver)
    center_x, center_y = config.RADAR_CENTER_X, config.RADAR_CENTER_Y
    tft.fill_circle(center_x, center_y, 4, config.COLOR_AIRCRAFT)
    tft.circle(center_x, center_y, 6, config.COLOR_GRID)
    
    # Range rings
    if config.SHOW_RANGE_RINGS:
        for i in range(1, 4):
            r = (i / 3) * config.RADAR_RADIUS_PX
            tft.circle(center_x, int(center_y), int(r), config.COLOR_GRID)
    
    # Compass (N marker at top)
    if config.SHOW_COMPASS:
        tft.text("N", center_x - 2, center_y - config.RADAR_RADIUS_PX - 12, config.COLOR_COMPASS)

def draw_aircraft(tft):
    """Draw aircraft blips"""
    for ac in state.aircraft:
        # Must have position
        if "lat" not in ac or "lon" not in ac:
            continue
        
        # Calculate distance and bearing
        try:
            dist_nm = haversine_distance(
                config.RECEIVER_LAT, config.RECEIVER_LON,
                ac["lat"], ac["lon"]
            )
            bearing = initial_bearing(
                config.RECEIVER_LAT, config.RECEIVER_LON,
                ac["lat"], ac["lon"]
            )
        except:
            continue
        
        # Convert to radar coords
        coords = radar_coords(dist_nm, bearing)
        if coords is None:
            continue
        
        x, y = coords
        
        # Determine color
        is_selected = (state.selected_aircraft and 
                      ac.get("hex") == state.selected_aircraft.get("hex"))
        color = config.COLOR_SELECTED if is_selected else config.COLOR_AIRCRAFT
        
        # Draw aircraft as small circle
        tft.fill_circle(x, y, 2, color)
        
        # Draw callsign label if enabled and nearby
        if config.SHOW_CALLSIGNS and "flight" in ac:
            callsign = ac["flight"].strip() if isinstance(ac["flight"], str) else ""
            if callsign and dist_nm < 2:  # Only show label for nearby aircraft
                tft.text(callsign[:4], x + 4, y - 4, config.COLOR_TEXT)

def draw_status_bar(tft):
    """Draw bottom info bar"""
    y_base = config.DISPLAY_HEIGHT - 35
    
    if state.selected_aircraft:
        ac = state.selected_aircraft
        
        # Callsign
        flight = ac.get("flight", "").strip() if isinstance(ac.get("flight"), str) else "?????"
        alt = ac.get("alt_baro", "---")
        
        tft.text(f"Flight: {flight}", 10, y_base, config.COLOR_TEXT)
        tft.text(f"Alt: {alt}ft | Spd: {ac.get('gs', '---')}kts", 10, y_base + 15, config.COLOR_TEXT)
    else:
        tft.text(f"Aircraft: {len(state.aircraft)}", 10, y_base, config.COLOR_TEXT)
        tft.text("Tap aircraft for info", 10, y_base + 15, config.COLOR_TEXT)

def render_frame(tft):
    """Render complete frame"""
    draw_radar_frame(tft)
    draw_aircraft(tft)
    draw_status_bar(tft)
    state.frame_count += 1

# ==================== Main Loop ====================

def main():
    """Main application loop"""
    print("[Init] Initializing display...")
    tft = init_display()
    
    print("[Init] Connecting WiFi...")
    if not connect_wifi():
        tft.text("WiFi Failed", 10, 10, 0xF800)
        time.sleep(5)
        return
    
    # Auto-fetch receiver location from Pi if not configured
    if config.RECEIVER_LAT == 0.0 and config.RECEIVER_LON == 0.0:
        print("[Init] No location configured — fetching from Pi...")
        if not fetch_location_from_pi():
            tft.text("No location!", 10, 10, 0xF800)

    print("[Init] Starting radar loop...")
    state.last_fetch = time.time()
    
    while True:
        now = time.time()
        
        # Fetch aircraft data
        if now - state.last_fetch >= config.FETCH_INTERVAL:
            fetch_aircraft()
            state.last_fetch = now
            gc.collect()  # Clean up memory
        
        # Render display
        if time.ticks_ms() - state.last_render >= config.RENDER_INTERVAL:
            render_frame(tft)
            state.last_render = time.ticks_ms()
        
        # Clear selected aircraft after timeout
        if (state.selected_aircraft and 
            now - state.selected_timeout > config.INACTIVITY_TIMEOUT):
            state.selected_aircraft = None
        
        time.sleep(0.01)

if __name__ == "__main__":
    main()

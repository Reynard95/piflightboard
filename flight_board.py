#!/usr/bin/env python3
"""
Flight Board Display
Connects to readsb API and displays the closest aircraft on an LED board-style interface.
Optimized for 2560x1080 ultrawide displays on Raspberry Pi Zero 2W.
"""

from flask import Flask, render_template, jsonify
import requests
import math
import json
from datetime import datetime
import logging

app = Flask(__name__)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration
READSB_HOST = "localhost"
READSB_PORT = 30003  # Change to 8080 if using HTTP API
READSB_API_URL = f"http://{READSB_HOST}:8080"

# Your location (set to where your receiver is)
# Update these with your actual coordinates
RECEIVER_LAT = 52.0116  # Gouda, NL
RECEIVER_LON = 4.7093
RECEIVER_ALT = 0  # meters

# Airline ICAO to code mapping (common ones)
AIRLINE_MAPPING = {
    '43F95D': 'BAW',  # British Airways example
    '406E34': 'DLH',  # Lufthansa
}

def haversine_distance(lat1, lon1, lat2, lon2):
    """Calculate distance in kilometers between two coordinates."""
    R = 6371  # Earth's radius in km
    
    lat1_rad = math.radians(lat1)
    lon1_rad = math.radians(lon1)
    lat2_rad = math.radians(lat2)
    lon2_rad = math.radians(lon2)
    
    dlat = lat2_rad - lat1_rad
    dlon = lon2_rad - lon1_rad
    
    a = math.sin(dlat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(dlon/2)**2
    c = 2 * math.asin(math.sqrt(a))
    
    return R * c

def get_airline_code_from_callsign(callsign):
    """Extract airline ICAO code from callsign."""
    if not callsign:
        return None
    
    # Most callsigns start with 2-3 letter airline code
    code = callsign[:3].upper() if len(callsign) >= 3 else callsign.upper()
    return code

def get_aircraft_data():
    """Fetch aircraft data from readsb."""
    try:
        response = requests.get(f"{READSB_API_URL}/aircraft.json", timeout=5)
        if response.status_code == 200:
            return response.json()
    except Exception as e:
        logger.error(f"Error fetching from readsb: {e}")
    return None

def find_closest_aircraft():
    """Find the closest aircraft to the receiver."""
    data = get_aircraft_data()
    if not data or 'aircraft' not in data:
        return None
    
    closest = None
    closest_distance = float('inf')
    
    for aircraft in data['aircraft']:
        # Skip if no position data
        if 'lat' not in aircraft or 'lon' not in aircraft:
            continue
        
        distance = haversine_distance(
            RECEIVER_LAT, RECEIVER_LON,
            aircraft['lat'], aircraft['lon']
        )
        
        if distance < closest_distance:
            closest_distance = distance
            closest = aircraft
            closest['distance_km'] = round(distance, 1)
    
    return closest

def format_flight_info(aircraft):
    """Format aircraft data for display."""
    if not aircraft:
        return None
    
    callsign = aircraft.get('callsign', 'N/A').strip()
    icao = aircraft.get('icao', '').upper()
    altitude = aircraft.get('alt_geom', aircraft.get('altitude', 0))
    speed = aircraft.get('gs', aircraft.get('speed', 0))
    distance = aircraft.get('distance_km', 0)
    
    # Get airline code
    airline_code = get_airline_code_from_callsign(callsign)
    
    # Get aircraft type
    aircraft_type = aircraft.get('model', 'Unknown')
    
    # Get status (simplified)
    status = "Cruise"
    if altitude and altitude < 1000:
        status = "Landing"
    elif aircraft.get('baro_rate', 0) and aircraft['baro_rate'] > 500:
        status = "Climbing"
    elif aircraft.get('baro_rate', 0) and aircraft['baro_rate'] < -500:
        status = "Descending"
    
    return {
        'callsign': callsign,
        'icao': icao,
        'airline_code': airline_code,
        'altitude': int(altitude) if altitude else 0,
        'speed': int(speed) if speed else 0,
        'distance': distance,
        'aircraft_type': aircraft_type,
        'status': status,
        'latitude': round(aircraft.get('lat', 0), 4),
        'longitude': round(aircraft.get('lon', 0), 4),
        'timestamp': datetime.now().isoformat()
    }

@app.route('/')
def index():
    """Serve the main flight board page."""
    return render_template('flight_board.html')

@app.route('/api/closest-aircraft')
def api_closest_aircraft():
    """API endpoint that returns the closest aircraft."""
    aircraft = find_closest_aircraft()
    flight_info = format_flight_info(aircraft)
    
    return jsonify(flight_info if flight_info else {
        'error': 'No aircraft data available',
        'timestamp': datetime.now().isoformat()
    })

if __name__ == '__main__':
    logger.info(f"Starting Flight Board on {READSB_HOST}")
    logger.info(f"Receiver location: {RECEIVER_LAT}, {RECEIVER_LON}")
    logger.info("Ensure readsb API is running on http://localhost:8080")
    
    # Run on all interfaces so you can access from the ultrawide display
    app.run(host='0.0.0.0', port=5000, debug=False)

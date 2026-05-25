"""
mock_data.py — Simulated ADS-B aircraft feed

Generates a realistic aircraft.json that matches the readsb output format
exactly so all existing piflightboard HTML pages work without modification.

Aircraft fly real-ish routes, move each update tick, and have plausible
callsigns, squawks, altitudes, speeds, and headings.

Usage (standalone test):
    python3 mock_data.py
"""

import math
import random
import time
from dataclasses import dataclass, field
from typing import Optional


# ---------------------------------------------------------------------------
# Configurable centre point (receiver location)
# This is overridden by layout.json at runtime.
# Default: London Heathrow area
# ---------------------------------------------------------------------------
DEFAULT_LAT = 51.477
DEFAULT_LON = -0.461


# ---------------------------------------------------------------------------
# Aircraft type data
# ---------------------------------------------------------------------------

AIRCRAFT_TYPES = [
    # (ICAO type, category, typical cruise alt ft, typical speed kts)
    ("B738", "A3", 35000, 450),
    ("A320", "A3", 34000, 440),
    ("A321", "A3", 36000, 445),
    ("B77W", "A5", 38000, 490),
    ("A359", "A5", 39000, 500),
    ("B788", "A5", 40000, 490),
    ("E190", "A3", 31000, 410),
    ("AT76", "A2", 17000, 270),
    ("C208", "A1", 10000, 175),
    ("B734", "A3", 33000, 440),
    ("A319", "A3", 33000, 430),
    ("CRJ9", "A2", 28000, 390),
    ("DH8D", "A2", 22000, 300),
    ("GLF6", "A4", 43000, 510),
    ("C172", "A1",  4500,  95),
]

# Callsign prefixes → ICAO airline code, airline name
AIRLINES = [
    ("BAW", "SPEEDBIRD"),
    ("RYR", "RYANAIR"),
    ("EZY", "EASY"),
    ("TOM", "TOMJET"),
    ("VIR", "VIRGIN"),
    ("IBE", "IBERIA"),
    ("DLH", "LUFTHANSA"),
    ("AFR", "AIRFRANS"),
    ("UAE", "EMIRATES"),
    ("SWR", "SWISS"),
    ("KLM", "KLM"),
    ("NAX", "NORWEGIAN"),
    ("TUI", "TUI"),
    ("EIN", "SHAMROCK"),
    ("G-", ""),          # GA aircraft — letter-only reg
]

# ICAO hex prefixes by "country" block
HEX_PREFIXES = ["40", "43", "44", "4C", "4D", "4B", "3C", "38", "48", "49"]


# ---------------------------------------------------------------------------
# Helper geometry
# ---------------------------------------------------------------------------

def _move(lat: float, lon: float, heading_deg: float, dist_nm: float):
    """Move lat/lon by dist_nm nautical miles on heading_deg. Returns new lat, lon."""
    R_NM = 3440.065       # Earth radius in nautical miles
    d_rad = dist_nm / R_NM
    h_rad = math.radians(heading_deg)
    lat1 = math.radians(lat)
    lon1 = math.radians(lon)
    lat2 = math.asin(
        math.sin(lat1) * math.cos(d_rad) +
        math.cos(lat1) * math.sin(d_rad) * math.cos(h_rad)
    )
    lon2 = lon1 + math.atan2(
        math.sin(h_rad) * math.sin(d_rad) * math.cos(lat1),
        math.cos(d_rad) - math.sin(lat1) * math.sin(lat2)
    )
    return math.degrees(lat2), math.degrees(lon2)


def _bearing(lat1, lon1, lat2, lon2) -> float:
    """Initial bearing from (lat1,lon1) to (lat2,lon2) in degrees."""
    la1, lo1, la2, lo2 = map(math.radians, [lat1, lon1, lat2, lon2])
    x = math.sin(lo2 - lo1) * math.cos(la2)
    y = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(lo2 - lo1)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def _haversine_nm(lat1, lon1, lat2, lon2) -> float:
    """Distance in nautical miles between two points."""
    R = 3440.065
    la1, lo1, la2, lo2 = map(math.radians, [lat1, lon1, lat2, lon2])
    dlat = la2 - la1
    dlon = lo2 - lo1
    a = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlon / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ---------------------------------------------------------------------------
# Aircraft state
# ---------------------------------------------------------------------------

@dataclass
class Aircraft:
    hex: str
    callsign: str
    ac_type: str
    category: str
    lat: float
    lon: float
    track: float          # degrees true
    alt_baro: int         # feet
    gs: float             # knots ground speed
    squawk: str
    baro_rate: int        # fpm
    rssi: float
    messages: int = 0
    seen: float = 0.0
    seen_pos: float = 0.0

    # Phase: "cruise", "climb", "descend"
    phase: str = "cruise"
    # Target altitude for climb/descend
    target_alt: int = 35000
    # Destination point — aircraft turns back when it gets far enough away
    dest_lat: float = 0.0
    dest_lon: float = 0.0

    # Heading drift (slight meander for realism)
    _track_drift: float = field(default=0.0, repr=False)

    def step(self, dt_s: float, center_lat: float, center_lon: float):
        """Advance simulation by dt_s seconds."""
        self.messages += random.randint(1, 8)
        self.seen = round(random.uniform(0.0, 1.5), 1)
        self.seen_pos = round(random.uniform(0.0, 2.0), 1)
        self.rssi = round(random.uniform(-20, -5), 1)

        # Move along track
        dist_nm = self.gs * dt_s / 3600
        self.lat, self.lon = _move(self.lat, self.lon, self.track, dist_nm)

        # Slight heading meander
        self._track_drift += random.uniform(-0.3, 0.3)
        self._track_drift = max(-5, min(5, self._track_drift))
        self.track = (self.track + self._track_drift * 0.1) % 360

        # Altitude phase logic
        if self.phase == "climb":
            self.alt_baro = min(self.target_alt, int(self.alt_baro + abs(self.baro_rate) * dt_s / 60))
            self.baro_rate = random.randint(800, 1800)
            if self.alt_baro >= self.target_alt:
                self.phase = "cruise"
                self.baro_rate = random.choice([-64, -32, 0, 0, 0, 32, 64])
        elif self.phase == "descend":
            self.alt_baro = max(2000, int(self.alt_baro - abs(self.baro_rate) * dt_s / 60))
            self.baro_rate = -random.randint(600, 1600)
            if self.alt_baro <= 2000:
                # Respawn aircraft at edge of range
                self._respawn(center_lat, center_lon)
        else:
            # Cruise — occasional small rate adjustments
            if random.random() < 0.02:
                self.baro_rate = random.choice([-256, -128, -64, 0, 0, 0, 64, 128, 256])

        # Wrap-around: if too far away, head back toward center
        dist_to_center = _haversine_nm(self.lat, self.lon, center_lat, center_lon)
        if dist_to_center > 220:
            # Turn back toward centre ± 30°
            back_bearing = _bearing(self.lat, self.lon, center_lat, center_lon)
            self.track = (back_bearing + random.uniform(-30, 30)) % 360
            if self.phase == "cruise" and random.random() < 0.3:
                self.phase = "descend"
                self.baro_rate = -random.randint(800, 1400)

    def _respawn(self, center_lat: float, center_lon: float):
        """Reset aircraft to the edge of the radar range heading inward."""
        angle = random.uniform(0, 360)
        self.lat, self.lon = _move(center_lat, center_lon, angle, random.uniform(180, 220))
        # Head inward ± 45°
        inward = (_bearing(self.lat, self.lon, center_lat, center_lon) + random.uniform(-45, 45)) % 360
        self.track = inward
        self.phase = "climb"
        self.alt_baro = random.randint(3000, 10000)
        self.target_alt = random.randint(25000, 42000)
        self.baro_rate = random.randint(1000, 2000)
        self.messages = 0

    def to_dict(self, center_lat: float, center_lon: float) -> dict:
        dist_nm = _haversine_nm(self.lat, self.lon, center_lat, center_lon)
        dir_to  = _bearing(center_lat, center_lon, self.lat, self.lon)
        return {
            "hex":         self.hex,
            "type":        "adsb_icao",
            "flight":      self.callsign.ljust(8),
            "alt_baro":    self.alt_baro,
            "alt_geom":    self.alt_baro + random.randint(-200, 200),
            "gs":          round(self.gs + random.uniform(-2, 2), 1),
            "ias":         round(self.gs * 0.82 + random.uniform(-3, 3), 1),
            "tas":         round(self.gs * 0.95 + random.uniform(-2, 2), 1),
            "mach":        round(self.gs / 580, 3),
            "track":       round(self.track, 1),
            "track_rate":  round(self._track_drift * 0.05, 2),
            "roll":        round(self._track_drift * 0.5, 1),
            "mag_heading": round((self.track - 5 + random.uniform(-1, 1)) % 360, 1),
            "baro_rate":   self.baro_rate,
            "geom_rate":   self.baro_rate + random.randint(-64, 64),
            "squawk":      self.squawk,
            "emergency":   "none",
            "category":    self.category,
            "nav_qnh":     round(1013.2 + random.uniform(-3, 3), 1),
            "nav_altitude_mcp": (self.alt_baro // 100) * 100,
            "nav_heading": round(self.track, 1),
            "lat":         round(self.lat, 6),
            "lon":         round(self.lon, 6),
            "nic":         8,
            "rc":          186,
            "seen_pos":    self.seen_pos,
            "version":     2,
            "nic_baro":    1,
            "nac_p":       10,
            "nac_v":       2,
            "sil":         3,
            "sil_type":    "perhour",
            "gva":         2,
            "sda":         2,
            "mlat":        [],
            "tisb":        [],
            "messages":    self.messages,
            "seen":        self.seen,
            "rssi":        self.rssi,
            "r_dst":       round(dist_nm * 1.852, 1),   # km
            "r_dir":       round(dir_to, 1),
        }


# ---------------------------------------------------------------------------
# Fleet generator
# ---------------------------------------------------------------------------

def _rand_hex() -> str:
    prefix = random.choice(HEX_PREFIXES)
    return prefix + format(random.randint(0, 0xFFFF), "04X")


def _rand_squawk() -> str:
    # Avoid 7500/7600/7700 emergency codes
    while True:
        s = f"{random.randint(0, 7):01}{random.randint(0, 7):01}{random.randint(0, 7):01}{random.randint(0, 7):01}"
        if s not in ("7500", "7600", "7700"):
            return s


def _rand_callsign() -> str:
    airline, _ = random.choice(AIRLINES)
    if airline == "G-":
        return "G-" + "".join(random.choices("ABCDEFGHJKLMNPQRSTUVWXYZ", k=3))
    return airline + str(random.randint(1, 9999)).zfill(random.choice([3, 4]))


def _spawn_aircraft(center_lat: float, center_lon: float) -> Aircraft:
    """Create one aircraft at a random position within radar range."""
    ac_type, category, cruise_alt, cruise_speed = random.choice(AIRCRAFT_TYPES)

    # Random starting position within ~200 nm
    angle   = random.uniform(0, 360)
    dist_nm = random.uniform(10, 200)
    lat, lon = _move(center_lat, center_lon, angle, dist_nm)

    # Random track — biased slightly toward cross-traffic
    track = random.uniform(0, 360)

    # Randomise altitude and phase
    phase = random.choices(
        ["cruise", "climb", "descend"],
        weights=[0.70, 0.15, 0.15]
    )[0]

    if phase == "cruise":
        alt = cruise_alt + random.randint(-2000, 2000)
        alt = (alt // 1000) * 1000
        baro_rate = random.choice([-256, -128, -64, 0, 0, 0, 64, 128, 256])
    elif phase == "climb":
        alt = random.randint(3000, cruise_alt - 5000)
        baro_rate = random.randint(800, 2000)
    else:
        alt = cruise_alt - random.randint(5000, 15000)
        baro_rate = -random.randint(600, 1500)

    # GA aircraft are much slower and lower
    if category == "A1":
        alt = min(alt, 8000)
        cruise_speed = random.randint(80, 130)
        baro_rate = random.choice([0, 0, 200, -200])

    speed = cruise_speed + random.randint(-20, 20)

    return Aircraft(
        hex=_rand_hex(),
        callsign=_rand_callsign(),
        ac_type=ac_type,
        category=category,
        lat=lat,
        lon=lon,
        track=track,
        alt_baro=max(500, alt),
        gs=max(60, speed),
        squawk=_rand_squawk(),
        baro_rate=baro_rate,
        rssi=round(random.uniform(-20, -5), 1),
        phase=phase,
        target_alt=cruise_alt,
        dest_lat=center_lat + random.uniform(-3, 3),
        dest_lon=center_lon + random.uniform(-3, 3),
    )


# ---------------------------------------------------------------------------
# Main generator class
# ---------------------------------------------------------------------------

class MockDataGenerator:
    """
    Maintains a simulated fleet of aircraft and generates aircraft.json
    snapshots on demand.

    Usage:
        gen = MockDataGenerator(lat=51.477, lon=-0.461, count=15)
        while True:
            data = gen.snapshot()   # dict matching readsb aircraft.json
            time.sleep(1)
    """

    def __init__(
        self,
        lat: float = DEFAULT_LAT,
        lon: float = DEFAULT_LON,
        count: int = 15,
        seed: Optional[int] = None,
    ):
        self.center_lat = lat
        self.center_lon = lon
        self._total_messages = random.randint(50000, 200000)
        self._last_tick = time.time()

        if seed is not None:
            random.seed(seed)

        self._fleet: list[Aircraft] = [
            _spawn_aircraft(lat, lon) for _ in range(count)
        ]

    def tick(self):
        """Advance simulation. Called automatically by snapshot()."""
        now = time.time()
        dt  = now - self._last_tick
        self._last_tick = now

        for ac in self._fleet:
            ac.step(dt, self.center_lat, self.center_lon)

        self._total_messages += random.randint(10, 80)

    def snapshot(self) -> dict:
        """Return a dict matching the readsb aircraft.json format."""
        self.tick()
        return {
            "now":      round(time.time(), 1),
            "messages": self._total_messages,
            "aircraft": [
                ac.to_dict(self.center_lat, self.center_lon)
                for ac in self._fleet
            ],
        }


# ---------------------------------------------------------------------------
# Standalone test
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import json

    gen = MockDataGenerator(count=5)
    print("Generating 3 snapshots (1s apart)...")
    for i in range(3):
        snap = gen.snapshot()
        print(f"\n--- Snapshot {i + 1} ---")
        print(f"  now={snap['now']}  messages={snap['messages']}  aircraft={len(snap['aircraft'])}")
        for ac in snap["aircraft"]:
            print(
                f"  {ac['flight'].strip():8s}  alt={ac['alt_baro']:6d}ft  "
                f"gs={ac['gs']:5.0f}kt  track={ac['track']:5.1f}deg  "
                f"lat={ac['lat']:.3f}  lon={ac['lon']:.3f}"
            )
        if i < 2:
            time.sleep(1)

"""
server.py — Cyberdeck local HTTP server

Serves the piflightboard web pages and all API endpoints they depend on.

Two modes, selected automatically from layout.json (or CLI flags):

  LIVE mode  (default when pi_zero_url is set in layout.json)
    /data/aircraft.json  ← proxied from Pi Zero readsb
    /api/spectrum        ← proxied from Pi Zero settings-api.py (port 8089)
    /api/vitals          ← real local stats via psutil
    /api/weather         ← Open-Meteo (free, no key)

  MOCK mode  (fallback when Pi Zero is unreachable, or --mock forced)
    /data/aircraft.json  ← MockDataGenerator (simulated aircraft)
    /api/spectrum        ← simulated RF spectrum
    /api/vitals          ← real local stats via psutil
    /api/weather         ← Open-Meteo (free, no key)

Endpoints:
  GET  /                        → main.html
  GET  /<page>.html             → www/<page>.html (static)
  GET  /data/aircraft.json      → ADS-B feed (live or mock)
  GET  /api/vitals              → CPU / memory / disk / net stats
  GET  /api/weather             → current weather + 24h forecast
  GET  /api/spectrum            → RF spectrum (live or simulated)
  GET  /api/ping                → health check + mode indicator
  GET  /db/<file>               → aircraft hex DB stubs
  POST :8088/                   → CORS proxy for adsb.lol route lookups

Usage:
  python3 server.py                         # reads layout.json for config
  python3 server.py --mock                  # force mock mode
  python3 server.py --pi-zero flighttracker.local   # override Pi Zero hostname
"""

import argparse
import json
import math
import os
import random
import re
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

from flask import Flask, Response, jsonify, request, send_file
from flask_cors import CORS
import psutil

from mock_data import MockDataGenerator


# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

HERE    = Path(__file__).parent
WWW_DIR = HERE.parent / "www"
DB_DIR  = HERE.parent / "db"


# ---------------------------------------------------------------------------
# Flask app
# ---------------------------------------------------------------------------

app = Flask(__name__, static_folder=None)
CORS(app, resources={r"/*": {"origins": "*"}})

# Populated by main() before the server starts
_config: dict = {}
_mock_gen: MockDataGenerator | None = None   # None = live mode
_pi_zero_url: str = ""                       # e.g. "http://flighttracker.local"


# ---------------------------------------------------------------------------
# Live data fetcher — pulls from Pi Zero with a short TTL cache
# ---------------------------------------------------------------------------

class _LiveCache:
    """Simple TTL cache for proxied Pi Zero responses."""

    def __init__(self, url: str, ttl_s: float = 2.0):
        self.url   = url
        self.ttl_s = ttl_s
        self._data: bytes | None = None
        self._ts   = 0.0
        self._lock = threading.Lock()

    def get(self) -> bytes | None:
        with self._lock:
            now = time.time()
            if self._data and now - self._ts < self.ttl_s:
                return self._data
            try:
                req = urllib.request.Request(
                    self.url,
                    headers={"User-Agent": "cyberdeck/1.0"},
                )
                with urllib.request.urlopen(req, timeout=4) as resp:
                    self._data = resp.read()
                    self._ts   = time.time()
                    return self._data
            except Exception as e:
                # Return stale data if available, otherwise None
                return self._data


_aircraft_cache: _LiveCache | None = None
_spectrum_cache: _LiveCache | None = None


# ---------------------------------------------------------------------------
# Static file serving
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return _serve_www("main.html")


@app.route("/<path:filename>")
def serve_static(filename):
    target = (WWW_DIR / filename).resolve()
    if not str(target).startswith(str(WWW_DIR.resolve())):
        return "Forbidden", 403
    if target.exists() and target.is_file():
        return _serve_www(filename)
    return f"Not found: {filename}", 404


def _serve_www(filename: str) -> Response:
    path = WWW_DIR / filename
    if not path.exists():
        return Response(f"Not found: {filename}", status=404)

    content_type = _mime(filename)

    if filename == "main.js":
        # Redirect the route proxy to localhost so it works without /etc/hosts tricks
        text = path.read_text(encoding="utf-8")
        text = re.sub(
            r"http://flighttracker\.local:8088",
            "http://localhost:8088",
            text,
        )
        return Response(text, content_type="application/javascript")

    if content_type.startswith("text") or "javascript" in content_type:
        return Response(path.read_bytes(), content_type=content_type)

    return send_file(path, mimetype=content_type)


def _mime(filename: str) -> str:
    return {
        ".html": "text/html; charset=utf-8",
        ".css":  "text/css",
        ".js":   "application/javascript",
        ".json": "application/json",
        ".png":  "image/png",
        ".jpg":  "image/jpeg",
        ".svg":  "image/svg+xml",
        ".ico":  "image/x-icon",
    }.get(Path(filename).suffix.lower(), "application/octet-stream")


# ---------------------------------------------------------------------------
# /data/aircraft.json
# ---------------------------------------------------------------------------

@app.route("/data/aircraft.json")
def aircraft_json():
    if _aircraft_cache is not None:
        # Live mode — proxy from Pi Zero
        data = _aircraft_cache.get()
        if data:
            return Response(data, content_type="application/json")
        return jsonify({"error": "Pi Zero unreachable", "now": time.time(),
                        "messages": 0, "aircraft": []}), 503

    # Mock mode
    if _mock_gen is not None:
        return jsonify(_mock_gen.snapshot())

    return jsonify({"now": time.time(), "messages": 0, "aircraft": []}), 503


# ---------------------------------------------------------------------------
# /db/ — aircraft hex DB
# ---------------------------------------------------------------------------

@app.route("/db/<path:filename>")
def serve_db(filename):
    if DB_DIR.exists():
        target = (DB_DIR / filename).resolve()
        if str(target).startswith(str(DB_DIR.resolve())) and target.exists():
            return send_file(target, mimetype="application/javascript")
    return Response("var _A={};", content_type="application/javascript")


# ---------------------------------------------------------------------------
# /api/vitals — real local system stats via psutil
# ---------------------------------------------------------------------------

_vitals_prev_net = None
_vitals_prev_ts  = None


@app.route("/api/vitals")
def api_vitals():
    global _vitals_prev_net, _vitals_prev_ts

    now = time.time()

    cpu_pct   = psutil.cpu_percent(interval=None)
    cpu_cores = psutil.cpu_count(logical=True) or 1

    cpu_temp = None
    try:
        temps = psutil.sensors_temperatures()
        for key in ("coretemp", "cpu_thermal", "cpu-thermal", "k10temp", "acpitz"):
            if key in temps and temps[key]:
                cpu_temp = round(temps[key][0].current, 1)
                break
    except Exception:
        pass

    mem = psutil.virtual_memory()
    disk = psutil.disk_usage("/")

    net_rx_bps = net_tx_bps = 0
    net_now = psutil.net_io_counters()
    if _vitals_prev_net and _vitals_prev_ts:
        dt = now - _vitals_prev_ts
        if dt > 0:
            net_rx_bps = max(0, round((net_now.bytes_recv - _vitals_prev_net.bytes_recv) / dt))
            net_tx_bps = max(0, round((net_now.bytes_sent - _vitals_prev_net.bytes_sent) / dt))
    _vitals_prev_net = net_now
    _vitals_prev_ts  = now

    uptime_s = now - psutil.boot_time()
    try:
        load = list(os.getloadavg())
    except (AttributeError, OSError):
        load = [cpu_pct / 100] * 3

    try:
        hostname = socket.gethostname()
    except Exception:
        hostname = "cyberdeck"

    return jsonify({
        "cpu_pct":       cpu_pct,
        "cpu_temp":      cpu_temp,
        "cpu_cores":     cpu_cores,
        "mem_total_mb":  round(mem.total / 1024 / 1024, 1),
        "mem_used_mb":   round(mem.used  / 1024 / 1024, 1),
        "mem_pct":       round(mem.percent, 1),
        "disk_total_gb": round(disk.total / 1e9, 1),
        "disk_used_gb":  round(disk.used  / 1e9, 1),
        "disk_pct":      round(disk.percent, 1),
        "net_rx_bps":    net_rx_bps,
        "net_tx_bps":    net_tx_bps,
        "uptime":        _fmt_uptime(uptime_s),
        "load":          load,
        "hostname":      hostname,
    })


def _fmt_uptime(seconds: float) -> str:
    s = int(seconds)
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, _ = divmod(s, 60)
    return f"{d}d {h:02d}:{m:02d}" if d else f"{h:02d}:{m:02d}"


# ---------------------------------------------------------------------------
# /api/weather — Open-Meteo (free, no key)
# ---------------------------------------------------------------------------

_WMO_CODES = {
    0: "CLEAR", 1: "MOSTLY CLEAR", 2: "PARTLY CLOUDY", 3: "OVERCAST",
    45: "FOG", 48: "RIME FOG",
    51: "LIGHT DRIZZLE", 53: "DRIZZLE", 55: "HEAVY DRIZZLE",
    61: "LIGHT RAIN", 63: "RAIN", 65: "HEAVY RAIN",
    71: "LIGHT SNOW", 73: "SNOW", 75: "HEAVY SNOW",
    80: "LIGHT SHOWERS", 81: "SHOWERS", 82: "HEAVY SHOWERS",
    95: "THUNDERSTORM", 96: "THUNDER + HAIL", 99: "THUNDER + HVY HAIL",
}

_weather_cache: dict = {"data": None, "ts": 0.0}
WEATHER_TTL = 600


@app.route("/api/weather")
def api_weather():
    now = time.time()
    if _weather_cache["data"] and now - _weather_cache["ts"] < WEATHER_TTL:
        return jsonify(_weather_cache["data"])

    lat = _config.get("location", {}).get("lat", 0.0)
    lon = _config.get("location", {}).get("lon", 0.0)
    if lat == 0.0 and lon == 0.0:
        return jsonify({"error": "Set location.lat/lon in layout.json"}), 503

    url = (
        "https://api.open-meteo.com/v1/forecast"
        f"?latitude={lat}&longitude={lon}"
        "&current=temperature_2m,relative_humidity_2m,apparent_temperature,"
        "dew_point_2m,precipitation,weather_code,cloud_cover,pressure_msl,"
        "wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,uv_index"
        "&hourly=temperature_2m,precipitation_probability,precipitation,"
        "wind_speed_10m,wind_direction_10m,weather_code"
        "&forecast_days=2&timezone=auto"
    )

    try:
        req = urllib.request.Request(url, headers={"User-Agent": "cyberdeck/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            raw = json.loads(resp.read())
    except Exception as exc:
        return jsonify({"error": f"Weather fetch failed: {exc}"}), 503

    c = raw["current"]
    h = raw["hourly"]
    cur_time = c["time"]
    times    = h["time"]
    cur_idx  = next((i for i, t in enumerate(times) if t >= cur_time), 0)
    sl       = slice(cur_idx, cur_idx + 25)

    data = {
        "temperature":   c["temperature_2m"],
        "feels_like":    c["apparent_temperature"],
        "dew_point":     c.get("dew_point_2m"),
        "humidity":      c["relative_humidity_2m"],
        "precipitation": c["precipitation"],
        "weather_code":  c["weather_code"],
        "condition":     _WMO_CODES.get(c["weather_code"], "UNKNOWN"),
        "cloud_cover":   c["cloud_cover"],
        "pressure":      c["pressure_msl"],
        "wind_speed":    c["wind_speed_10m"],
        "wind_dir":      c["wind_direction_10m"],
        "wind_gusts":    c["wind_gusts_10m"],
        "visibility":    c.get("visibility"),
        "uv_index":      c.get("uv_index"),
        "lat":           lat,
        "lon":           lon,
        "timezone":      raw.get("timezone", "UTC"),
        "updated":       cur_time,
        "forecast": {
            "times":        times[sl],
            "temps":        h["temperature_2m"][sl],
            "precip_prob":  h["precipitation_probability"][sl],
            "precip":       h["precipitation"][sl],
            "wind_speed":   h["wind_speed_10m"][sl],
            "wind_dir":     h["wind_direction_10m"][sl],
            "weather_code": h["weather_code"][sl],
        },
    }

    _weather_cache["data"] = data
    _weather_cache["ts"]   = now
    return jsonify(data)


# ---------------------------------------------------------------------------
# /api/spectrum — live from Pi Zero, or simulated fallback
# ---------------------------------------------------------------------------

_FM_STATIONS = [88.5, 90.9, 92.3, 94.7, 96.1, 97.9, 99.5, 101.1, 103.5, 105.7, 107.9]


def _simulate_spectrum(freqs_mhz: list) -> list:
    """Fallback: synthesise a realistic-looking RF spectrum."""
    t = time.time()
    powers = []
    for f in freqs_mhz:
        p = -78.0 + random.gauss(0, 1.8)
        for sf in _FM_STATIONS:
            dist = abs(f - sf)
            if dist < 0.8:
                p = max(p, -42.0 + random.gauss(0, 0.8) - 12.0 * dist * dist)
        if 118.0 <= f <= 137.0:
            if 0.5 + 0.5 * math.sin(t * 0.3 + f * 0.7) > 0.85:
                p = max(p, -54.0 + random.gauss(0, 2.0))
        for wf in [162.4, 162.55]:
            if abs(f - wf) < 0.5:
                p = max(p, -50.0 + random.gauss(0, 0.6) - 10.0 * abs(f - wf))
        if 433.0 <= f <= 435.0 and math.sin(t * 2.0 + f) > 0.7:
            p = max(p, -58.0 + random.gauss(0, 2.5))
        if 868.0 <= f <= 869.0:
            p = max(p, -65.0 + random.gauss(0, 2.0))
        dist = abs(f - 1090.0)
        if dist < 1.5:
            pulse = 0.6 + 0.4 * abs(math.sin(t * 4.1))
            p = max(p, -32.0 * pulse + random.gauss(0, 1.5) - 8.0 * dist)
        powers.append(round(p, 1))
    return powers


@app.route("/api/spectrum")
def api_spectrum():
    start = float(request.args.get("start", 88))
    end   = float(request.args.get("end",   1100))
    step  = float(request.args.get("step",  2))
    if step <= 0:
        step = 2

    # Live mode — proxy to Pi Zero's settings-api.py on port 8089
    if _spectrum_cache is not None:
        params = f"?start={start}&end={end}&step={step}"
        # Build a fresh URL with the requested params each time
        pi_url = f"{_pi_zero_url}:8089/api/spectrum{params}"
        try:
            req = urllib.request.Request(pi_url, headers={"User-Agent": "cyberdeck/1.0"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = resp.read()
            return Response(data, content_type="application/json")
        except Exception:
            pass  # Fall through to simulation if Pi unreachable

    # Simulation fallback
    freqs = []
    f = start
    while f <= end:
        freqs.append(round(f, 3))
        f += step

    return jsonify({
        "freq_start_mhz": start,
        "freq_end_mhz":   end,
        "freq_step_mhz":  step,
        "freqs_mhz":      freqs,
        "powers_dbm":     _simulate_spectrum(freqs),
        "source":         "simulated",
        "ts":             round(time.time(), 3),
    })


# ---------------------------------------------------------------------------
# /api/ping
# ---------------------------------------------------------------------------

@app.route("/api/ping")
def api_ping():
    mode = "mock" if _mock_gen is not None else "live"
    pi   = _pi_zero_url or "none"
    return jsonify({"ok": True, "mode": mode, "pi_zero": pi})


# ---------------------------------------------------------------------------
# Route proxy — port 8088
# ---------------------------------------------------------------------------

class _RouteProxyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body   = self.rfile.read(length)
        try:
            req = urllib.request.Request(
                "https://api.adsb.lol/api/0/routeset",
                data=body,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                data = resp.read()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_response(502)
            self.end_headers()

    def log_message(self, *args):
        pass


def _start_route_proxy(port: int = 8088):
    try:
        server = HTTPServer(("0.0.0.0", port), _RouteProxyHandler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        print(f"  Route proxy      → :8088")
    except OSError as e:
        print(f"  Route proxy FAILED on :{port} — {e}")


# ---------------------------------------------------------------------------
# Connectivity check
# ---------------------------------------------------------------------------

def _check_pi_zero(base_url: str) -> bool:
    """Return True if the Pi Zero's readsb endpoint is reachable."""
    try:
        url = f"{base_url}/data/aircraft.json"
        req = urllib.request.Request(url, headers={"User-Agent": "cyberdeck/1.0"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            resp.read(64)   # just enough to confirm it's alive
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main():
    global _config, _mock_gen, _pi_zero_url, _aircraft_cache, _spectrum_cache

    parser = argparse.ArgumentParser(description="Cyberdeck local data server")
    parser.add_argument("--port",     type=int,   default=5000)
    parser.add_argument("--lat",      type=float, default=0.0)
    parser.add_argument("--lon",      type=float, default=0.0)
    parser.add_argument("--count",    type=int,   default=15,
                        help="Number of simulated aircraft (mock mode only)")
    parser.add_argument("--pi-zero",  default="",
                        help="Pi Zero hostname or IP, e.g. flighttracker.local or 192.168.1.42")
    parser.add_argument("--mock",     action="store_true",
                        help="Force mock mode even if Pi Zero is reachable")
    args = parser.parse_args()

    # Load layout.json
    layout_path = HERE / "layout.json"
    if layout_path.exists():
        try:
            with open(layout_path) as fh:
                _config = json.load(fh)
            loc = _config.get("location", {})
            if loc.get("lat") and not args.lat:
                args.lat = loc["lat"]
            if loc.get("lon") and not args.lon:
                args.lon = loc["lon"]
            if not args.pi_zero and _config.get("pi_zero"):
                args.pi_zero = _config["pi_zero"]
        except Exception as e:
            print(f"  Warning: could not read layout.json — {e}")

    _config.setdefault("location", {"lat": args.lat, "lon": args.lon})

    # Normalise Pi Zero URL
    if args.pi_zero:
        if not args.pi_zero.startswith("http"):
            args.pi_zero = f"http://{args.pi_zero}"
        _pi_zero_url = args.pi_zero.rstrip("/")

    print()
    print("=" * 55)
    print("  Cyberdeck Aviation Console — Data Server")
    print("=" * 55)

    # Decide mode
    use_live = False
    if not args.mock and _pi_zero_url:
        print(f"  Checking Pi Zero at {_pi_zero_url} ...", end=" ", flush=True)
        if _check_pi_zero(_pi_zero_url):
            use_live = True
            print("online")
        else:
            print("UNREACHABLE -- falling back to mock")

    if use_live:
        print(f"  Mode:     LIVE")
        print(f"  Pi Zero:  {_pi_zero_url}")
        print(f"            aircraft.json  -> {_pi_zero_url}/data/aircraft.json")
        print(f"            spectrum       -> {_pi_zero_url}:8089/api/spectrum")
        _aircraft_cache = _LiveCache(f"{_pi_zero_url}/data/aircraft.json", ttl_s=2.0)
        _spectrum_cache  = True   # sentinel; spectrum fetched per-request with params
    else:
        print(f"  Mode:     MOCK (simulated aircraft)")
        print(f"  Aircraft: {args.count} simulated")
        _mock_gen = MockDataGenerator(
            lat=args.lat or 51.477,
            lon=args.lon or -0.461,
            count=args.count,
        )

    print(f"  Location: {args.lat:.3f}, {args.lon:.3f}")
    print(f"  www dir:  {WWW_DIR}")
    print()

    psutil.cpu_percent(interval=None)   # prime CPU sampler
    _start_route_proxy(8088)

    print(f"  Main server      -> http://localhost:{args.port}")
    print(f"  Open in browser:")
    for page in ("radar", "vitals", "weather", "spectrum"):
        print(f"    http://localhost:{args.port}/{page}.html")
    print()
    print("  Press Ctrl+C to stop.")
    print("=" * 55)

    app.run(host="0.0.0.0", port=args.port, debug=False, threaded=True)


if __name__ == "__main__":
    main()

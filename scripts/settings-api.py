#!/usr/bin/env python3
"""
settings-api.py — Flight Board Settings API
Runs on port 8089. Manages PIN auth, location config, feeder install/config,
and service restarts for the Pi flight board setup page.

Run with:
    sudo python3 /opt/flighttracker/scripts/settings-api.py

Or as a systemd service (settings-api.service).
"""

import hashlib
import json
import os
import re
import secrets
import subprocess
import time
from functools import wraps

from flask import Flask, Response, jsonify, request, stream_with_context
from flask_cors import CORS

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

SETTINGS_FILE   = "/opt/flighttracker/config/settings.json"
READSB_DEFAULTS = "/etc/default/readsb"
FR24_INI        = "/etc/fr24feed.ini"

# Default settings written on first run
DEFAULT_SETTINGS = {
    "pin_hash":       "",
    "location":       {"lat": 0.0, "lon": 0.0},
    "setup_complete": False,
}

# Allowed services for the generic restart endpoint
ALLOWED_SERVICES = {"readsb", "lighttpd", "route-proxy", "fr24feed", "piaware"}

# Token TTL (seconds)
TOKEN_TTL = 3600

# ---------------------------------------------------------------------------
# Application
# ---------------------------------------------------------------------------

app = Flask(__name__)
CORS(app, resources={r"/api/*": {"origins": "*"}})

# In-memory token store: { token: expiry_timestamp }
_tokens: dict[str, float] = {}


# ---------------------------------------------------------------------------
# Helpers — settings file
# ---------------------------------------------------------------------------

def load_settings() -> dict:
    """Load settings from disk, creating file with defaults if absent."""
    if not os.path.exists(SETTINGS_FILE):
        os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
        save_settings(DEFAULT_SETTINGS)
        return dict(DEFAULT_SETTINGS)
    with open(SETTINGS_FILE, "r") as fh:
        return json.load(fh)


def save_settings(data: dict) -> None:
    """Persist settings to disk atomically."""
    os.makedirs(os.path.dirname(SETTINGS_FILE), exist_ok=True)
    tmp = SETTINGS_FILE + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(data, fh, indent=2)
    os.replace(tmp, SETTINGS_FILE)


# ---------------------------------------------------------------------------
# Helpers — auth
# ---------------------------------------------------------------------------

def hash_pin(pin: str) -> str:
    return hashlib.sha256(pin.encode()).hexdigest()


def purge_expired_tokens() -> None:
    now = time.time()
    expired = [t for t, exp in _tokens.items() if now > exp]
    for t in expired:
        del _tokens[t]


def issue_token() -> str:
    purge_expired_tokens()
    token = secrets.token_hex(32)
    _tokens[token] = time.time() + TOKEN_TTL
    return token


def validate_token(token: str) -> bool:
    purge_expired_tokens()
    return token in _tokens


def require_auth(f):
    """Decorator: reject requests without a valid Bearer token."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Unauthorised"}), 401
        token = auth[len("Bearer "):]
        if not validate_token(token):
            return jsonify({"error": "Unauthorised"}), 401
        return f(*args, **kwargs)
    return decorated


# ---------------------------------------------------------------------------
# Helpers — system
# ---------------------------------------------------------------------------

def service_status(name: str) -> dict:
    """
    Return {"active": bool, "status": str} for a systemd service.
    If the unit doesn't exist at all, returns {"active": False, "status": "not installed"}.
    """
    # Check if the unit file / package is installed
    result = subprocess.run(
        ["systemctl", "status", name],
        capture_output=True, text=True
    )
    output = result.stdout + result.stderr

    if "could not be found" in output or "No such file" in output or result.returncode == 4:
        return {"active": False, "status": "not installed"}

    active = "Active: active" in output
    # Extract the Active: line for a clean status string
    for line in output.splitlines():
        if "Active:" in line:
            status_str = line.strip().replace("Active:", "").strip()
            # Trim ANSI escape codes if any
            status_str = re.sub(r'\x1b\[[0-9;]*m', '', status_str)
            return {"active": active, "status": status_str}

    return {"active": active, "status": "active" if active else "inactive"}


def is_binary_installed(binary: str) -> bool:
    """Return True if a binary exists on PATH."""
    result = subprocess.run(["which", binary], capture_output=True)
    return result.returncode == 0


def restart_service(name: str) -> tuple[bool, str]:
    """Restart a systemd service. Returns (success, message)."""
    if name not in ALLOWED_SERVICES:
        return False, f"Service '{name}' not in allowlist"
    result = subprocess.run(
        ["sudo", "systemctl", "restart", name],
        capture_output=True, text=True
    )
    if result.returncode == 0:
        return True, f"{name} restarted"
    return False, result.stderr.strip() or f"Failed to restart {name}"


# ---------------------------------------------------------------------------
# Helpers — readsb config
# ---------------------------------------------------------------------------

def update_readsb_location(lat: float, lon: float) -> None:
    """
    Write lat/lon into /etc/default/readsb.
    Handles two formats:
      1. READSB_LAT="..." / READSB_LON="..." env-var style
      2. --lat and --lon flags inside a READSB_DEVICE_OPTIONS or similar line
    Creates the file if it doesn't exist.
    """
    if os.path.exists(READSB_DEFAULTS):
        with open(READSB_DEFAULTS, "r") as fh:
            content = fh.read()
    else:
        content = ""

    lat_str = f"{lat:.6f}"
    lon_str = f"{lon:.6f}"

    # --- Format 1: bare READSB_LAT= / READSB_LON= lines ---
    has_lat_var = bool(re.search(r'^READSB_LAT\s*=', content, re.MULTILINE))
    has_lon_var = bool(re.search(r'^READSB_LON\s*=', content, re.MULTILINE))

    if has_lat_var or has_lon_var:
        # Replace or add READSB_LAT / READSB_LON
        if has_lat_var:
            content = re.sub(
                r'^(READSB_LAT\s*=).*$', rf'\g<1>"{lat_str}"',
                content, flags=re.MULTILINE
            )
        else:
            content += f'\nREADSB_LAT="{lat_str}"\n'

        if has_lon_var:
            content = re.sub(
                r'^(READSB_LON\s*=).*$', rf'\g<1>"{lon_str}"',
                content, flags=re.MULTILINE
            )
        else:
            content += f'READSB_LON="{lon_str}"\n'

    else:
        # --- Format 2: --lat / --lon flags inside an options string ---
        # Replace existing --lat X and --lon X occurrences anywhere in the file
        replaced_lat = False
        replaced_lon = False

        def replace_lat(m):
            nonlocal replaced_lat
            replaced_lat = True
            return f'--lat {lat_str}'

        def replace_lon(m):
            nonlocal replaced_lon
            replaced_lon = True
            return f'--lon {lon_str}'

        content = re.sub(r'--lat\s+[\d.+-]+', replace_lat, content)
        content = re.sub(r'--lon\s+[\d.+-]+', replace_lon, content)

        # If no flags found, append a standalone options line
        if not replaced_lat and not replaced_lon:
            content += f'\n# Added by settings-api\nREADSB_LAT="{lat_str}"\nREADSB_LON="{lon_str}"\n'

    with open(READSB_DEFAULTS, "w") as fh:
        fh.write(content)


# ---------------------------------------------------------------------------
# Helpers — FR24 config
# ---------------------------------------------------------------------------

FR24_INI_TEMPLATE = """\
receiver=beast-tcp
fr24key={key}
host=127.0.0.1
bs=30005
raw=30002
logmode=0
logpath=/tmp
mlat=yes
mlat-without-gps=yes
"""

def write_fr24_config(key: str) -> None:
    with open(FR24_INI, "w") as fh:
        fh.write(FR24_INI_TEMPLATE.format(key=key))


# ---------------------------------------------------------------------------
# Helpers — SSE streaming
# ---------------------------------------------------------------------------

def sse_line(line: str, done: bool = False, success: bool = True) -> str:
    payload = json.dumps({"line": line, "done": done, "success": success})
    return f"data: {payload}\n\n"


def stream_subprocess(cmd: list[str]):
    """
    Generator: runs cmd, yields SSE events for each line of combined stdout/stderr.
    Final event sets done=true and success based on return code.
    """
    yield sse_line(f"$ {' '.join(cmd)}")
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1
        )
        for line in iter(proc.stdout.readline, ""):
            yield sse_line(line.rstrip())
        proc.wait()
        success = proc.returncode == 0
        yield sse_line("Done", done=True, success=success)
    except Exception as exc:
        yield sse_line(f"Error: {exc}", done=True, success=False)


# ---------------------------------------------------------------------------
# Input validation
# ---------------------------------------------------------------------------

def validate_pin(pin) -> str | None:
    """Return error string or None if valid."""
    if not isinstance(pin, str):
        return "PIN must be a string"
    if len(pin) < 4 or len(pin) > 32:
        return "PIN must be 4–32 characters"
    return None


def validate_lat_lon(lat, lon) -> str | None:
    """Return error string or None if valid."""
    try:
        lat = float(lat)
        lon = float(lon)
    except (TypeError, ValueError):
        return "lat and lon must be numbers"
    if not (-90 <= lat <= 90):
        return "lat must be between -90 and 90"
    if not (-180 <= lon <= 180):
        return "lon must be between -180 and 180"
    return None


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------

@app.route("/api/auth/set", methods=["POST"])
def auth_set():
    """
    Set or change the PIN.
    - If no PIN is set yet (first run), anyone can call this.
    - If a PIN is already set, requires a valid Bearer token.
    """
    settings = load_settings()
    pin_exists = bool(settings.get("pin_hash"))

    if pin_exists:
        # Require auth to change an existing PIN
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return jsonify({"error": "Unauthorised"}), 401
        token = auth[len("Bearer "):]
        if not validate_token(token):
            return jsonify({"error": "Unauthorised"}), 401

    data = request.get_json(silent=True) or {}
    pin = data.get("pin", "")
    err = validate_pin(pin)
    if err:
        return jsonify({"error": err}), 400

    settings["pin_hash"] = hash_pin(pin)
    save_settings(settings)

    token = issue_token()
    return jsonify({"ok": True, "token": token})


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    """Verify PIN, return a session token."""
    settings = load_settings()
    pin_hash = settings.get("pin_hash", "")

    if not pin_hash:
        # No PIN set — signal the client so it can enter set-PIN mode
        return jsonify({"error": "no_pin_set"}), 403

    data = request.get_json(silent=True) or {}
    pin = data.get("pin", "")
    err = validate_pin(pin)
    if err:
        return jsonify({"error": err}), 400

    if hash_pin(pin) != pin_hash:
        return jsonify({"error": "Incorrect PIN"}), 401

    token = issue_token()
    return jsonify({"token": token})


# ---------------------------------------------------------------------------
# Status endpoint
# ---------------------------------------------------------------------------

@app.route("/api/status", methods=["GET"])
@require_auth
def api_status():
    """Return live status of all relevant services."""
    services = {
        "readsb":       service_status("readsb"),
        "lighttpd":     service_status("lighttpd"),
        "route_proxy":  service_status("route-proxy"),
        "settings_api": {"active": True, "status": "active (running)"},
        "fr24feed":     service_status("fr24feed"),
        "piaware":      service_status("piaware"),
    }
    return jsonify(services)


# ---------------------------------------------------------------------------
# Settings endpoints
# ---------------------------------------------------------------------------

@app.route("/api/settings", methods=["GET"])
@require_auth
def api_settings_get():
    """Return the current settings (without pin_hash)."""
    settings = load_settings()
    safe = {k: v for k, v in settings.items() if k != "pin_hash"}
    return jsonify(safe)


@app.route("/api/settings", methods=["POST"])
@require_auth
def api_settings_post():
    """Bulk-update top-level settings keys (e.g. setup_complete)."""
    settings = load_settings()
    data = request.get_json(silent=True) or {}
    # Only allow updating whitelisted keys this way
    allowed_keys = {"setup_complete"}
    for key in allowed_keys:
        if key in data:
            settings[key] = data[key]
    save_settings(settings)
    return jsonify({"ok": True})


@app.route("/api/settings/location", methods=["POST"])
@require_auth
def api_settings_location():
    """Update receiver lat/lon, write to /etc/default/readsb, restart readsb."""
    data = request.get_json(silent=True) or {}
    lat = data.get("lat")
    lon = data.get("lon")

    err = validate_lat_lon(lat, lon)
    if err:
        return jsonify({"error": err}), 400

    lat = float(lat)
    lon = float(lon)

    # Save to settings.json
    settings = load_settings()
    settings["location"] = {"lat": lat, "lon": lon}
    save_settings(settings)

    # Write to /etc/default/readsb (requires sudo or write permission)
    try:
        update_readsb_location(lat, lon)
    except PermissionError:
        # Try via sudo tee
        content_result = subprocess.run(
            ["sudo", "python3", "-c",
             f"import sys; exec(open('/opt/flighttracker/scripts/settings-api.py').read()); "
             f"update_readsb_location({lat}, {lon})"],
            capture_output=True, text=True
        )
        if content_result.returncode != 0:
            return jsonify({"error": "Could not write readsb config", "detail": content_result.stderr}), 500

    # Restart readsb
    ok, msg = restart_service("readsb")
    return jsonify({"ok": ok, "message": msg})


@app.route("/api/settings/readsb-restart", methods=["POST"])
@require_auth
def api_readsb_restart():
    """Restart readsb service."""
    ok, msg = restart_service("readsb")
    return jsonify({"ok": ok, "message": msg})


# ---------------------------------------------------------------------------
# Service restart endpoint
# ---------------------------------------------------------------------------

@app.route("/api/service/restart", methods=["POST"])
@require_auth
def api_service_restart():
    """Restart any whitelisted service."""
    data = request.get_json(silent=True) or {}
    service = data.get("service", "")
    if service not in ALLOWED_SERVICES:
        return jsonify({"error": f"Service '{service}' not allowed"}), 400
    ok, msg = restart_service(service)
    return jsonify({"ok": ok, "message": msg})


# ---------------------------------------------------------------------------
# Feeder — install status & feeder-id
# ---------------------------------------------------------------------------

@app.route("/api/feeder/flightaware/feeder-id", methods=["GET"])
@require_auth
def feeder_fa_feeder_id():
    """Return the PiAware feeder UUID generated on this Pi."""
    result = subprocess.run(
        ["sudo", "piaware-config", "feeder-id"],
        capture_output=True, text=True
    )
    feeder_id = result.stdout.strip() if result.returncode == 0 else ""
    # piaware-config prints just the UUID on success; empty means not yet set
    return jsonify({"feeder_id": feeder_id or None})


@app.route("/api/feeder/fr24/install-status", methods=["GET"])
def feeder_fr24_status():
    installed = is_binary_installed("fr24feed")
    return jsonify({"installed": installed})


@app.route("/api/feeder/flightaware/install-status", methods=["GET"])
def feeder_fa_status():
    installed = is_binary_installed("piaware")
    return jsonify({"installed": installed})


# ---------------------------------------------------------------------------
# Feeder — configure
# ---------------------------------------------------------------------------

@app.route("/api/feeder/fr24/configure", methods=["POST"])
@require_auth
def feeder_fr24_configure():
    """Write FR24 key to /etc/fr24feed.ini and (re)start fr24feed."""
    data = request.get_json(silent=True) or {}
    key = data.get("key", "").strip()
    if not key:
        return jsonify({"error": "Missing 'key'"}), 400
    # Basic sanity — FR24 keys are hex-ish strings, 16+ chars
    if len(key) < 16 or not re.match(r'^[A-Za-z0-9]+$', key):
        return jsonify({"error": "Invalid FR24 key format"}), 400

    try:
        write_fr24_config(key)
    except PermissionError:
        return jsonify({"error": "Cannot write /etc/fr24feed.ini — permission denied"}), 500

    if is_binary_installed("fr24feed"):
        subprocess.run(["sudo", "systemctl", "enable", "fr24feed"], capture_output=True)
        ok, msg = restart_service("fr24feed")
        return jsonify({"ok": ok, "message": msg})

    return jsonify({"ok": True, "message": "Config written. fr24feed not yet installed."})


@app.route("/api/feeder/flightaware/configure", methods=["POST"])
@require_auth
def feeder_fa_configure():
    """Set PiAware feeder ID and restart piaware."""
    data = request.get_json(silent=True) or {}
    feeder_id = data.get("feeder_id", "").strip()
    if not feeder_id:
        return jsonify({"error": "Missing 'feeder_id'"}), 400
    # Basic UUID-ish validation
    if not re.match(r'^[A-Za-z0-9\-]{8,64}$', feeder_id):
        return jsonify({"error": "Invalid feeder_id format"}), 400

    result = subprocess.run(
        ["sudo", "piaware-config", "feeder-id", feeder_id],
        capture_output=True, text=True
    )
    if result.returncode != 0:
        return jsonify({"error": result.stderr.strip() or "piaware-config failed"}), 500

    ok, msg = restart_service("piaware")
    return jsonify({"ok": ok, "message": msg})


# ---------------------------------------------------------------------------
# Feeder — install (SSE)
# ---------------------------------------------------------------------------

@app.route("/api/feeder/fr24/install", methods=["POST"])
@require_auth
def feeder_fr24_install():
    """
    SSE endpoint: download and install fr24feed.
    Streams installer output line by line.
    """
    def generate():
        # Step 1: add FR24 apt repo (modern GPG keyring — apt-key removed in bookworm)
        yield sse_line("Adding FR24 apt repository...")
        repo_cmd = [
            "sudo", "bash", "-c",
            'mkdir -p /etc/apt/keyrings && '
            'wget -qO- https://repo-feed.flightradar24.com/flightradar24.2026.pub '
            '| gpg --dearmor > /etc/apt/keyrings/flightradar24.gpg && '
            'echo "deb [signed-by=/etc/apt/keyrings/flightradar24.gpg] '
            'https://repo-feed.flightradar24.com flightradar24 raspberrypi-stable" '
            '> /etc/apt/sources.list.d/fr24feed.list'
        ]
        for event in stream_subprocess(repo_cmd):
            yield event

        # Step 2: apt-get update
        yield sse_line("Running apt-get update...")
        for event in stream_subprocess(["sudo", "apt-get", "update", "-y"]):
            yield event

        # Step 3: install fr24feed
        yield sse_line("Installing fr24feed...")
        for event in stream_subprocess(
            ["sudo", "apt-get", "install", "-y", "--no-install-recommends", "fr24feed"]
        ):
            yield event

        # Step 4: enable and start the service so the web UI on :8754 is available
        yield sse_line("Enabling fr24feed service...")
        subprocess.run(["sudo", "systemctl", "enable", "fr24feed"], capture_output=True)
        subprocess.run(["sudo", "systemctl", "start", "fr24feed"], capture_output=True)

        # Final
        installed = is_binary_installed("fr24feed")
        yield sse_line(
            "Installation complete." if installed else "Installation may have failed.",
            done=True, success=installed
        )

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


@app.route("/api/feeder/flightaware/install", methods=["POST"])
@require_auth
def feeder_fa_install():
    """
    SSE endpoint: add the FlightAware apt repo and install PiAware.

    Bypasses the flightaware-apt-repository .deb (unreliable download) and
    replicates what it does directly:
      1. Fetch the GPG keyring from GitHub (piaware-support repo)
      2. Write the apt sources list entry
      3. apt-get update + install piaware
    """
    # GPG keyring from the official piaware-support GitHub repo
    KEYRING_URL = (
        "https://raw.githubusercontent.com/flightaware/piaware-support/"
        "master/etc/apt/trusted.gpg.d/flightaware-archive-keyring.gpg"
    )
    KEYRING_PATH = "/usr/share/keyrings/flightaware-archive-keyring.gpg"
    SOURCES_PATH = "/etc/apt/sources.list.d/flightaware-apt-repository.list"
    SOURCES_ENTRY = (
        f"deb [signed-by={KEYRING_PATH}] "
        "https://www.flightaware.com/adsb/piaware/files/packages bookworm piaware"
    )

    def generate():
        # Step 1: download GPG keyring
        yield sse_line("Adding FlightAware apt repository...")
        for event in stream_subprocess(
            ["sudo", "wget", "-qO", KEYRING_PATH, KEYRING_URL]
        ):
            yield event

        # Step 2: write sources list
        for event in stream_subprocess(
            ["sudo", "bash", "-c",
             f'echo "{SOURCES_ENTRY}" > {SOURCES_PATH}']
        ):
            yield event

        # Step 3: apt-get update
        yield sse_line("Updating package lists...")
        for event in stream_subprocess(["sudo", "apt-get", "update", "-y"]):
            yield event

        # Step 4: install piaware
        yield sse_line("Installing piaware...")
        for event in stream_subprocess(
            ["sudo", "apt-get", "install", "-y", "--no-install-recommends", "piaware"]
        ):
            yield event

        # Enable and start the service
        subprocess.run(["sudo", "systemctl", "enable", "piaware"], capture_output=True)
        subprocess.run(["sudo", "systemctl", "start",  "piaware"], capture_output=True)

        installed = is_binary_installed("piaware")
        yield sse_line(
            "Installation complete." if installed else "Installation may have failed.",
            done=True, success=installed
        )

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        }
    )


# ---------------------------------------------------------------------------
# Health check
# ---------------------------------------------------------------------------

@app.route("/api/ping", methods=["GET"])
def ping():
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Ensure settings file exists with defaults
    load_settings()
    print("Settings API listening on port 8089")
    # threaded=True so SSE streams don't block other requests
    app.run(host="0.0.0.0", port=8089, threaded=True)

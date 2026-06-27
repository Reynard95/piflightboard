# boot.py -- run on startup

import machine

# Check whether WiFi credentials are configured.
# If WIFI_SSID is empty or config.py doesn't exist, launch the captive portal
# so the user can configure the device over a local AP before main.py runs.
_has_wifi = False
try:
    import config
    _has_wifi = bool(getattr(config, "WIFI_SSID", "").strip())
except ImportError:
    pass

if not _has_wifi:
    print("[boot] No WiFi config — starting setup portal...")
    import portal
    portal.start()  # blocks until saved, then reboots
else:
    print("[boot] WiFi configured. Running main.py...")

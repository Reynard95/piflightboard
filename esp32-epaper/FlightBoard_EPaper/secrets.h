// secrets.h — local configuration, never committed to git
// See secrets.h.example for documentation.

#pragma once

// ── WiFi ──────────────────────────────────────────────────────────────────────
const char* WIFI_SSID     = "Erasmus Huis";
const char* WIFI_PASSWORD = "Erasmus@Gouda";

// ── Pi (running readsb + lighttpd) ────────────────────────────────────────────
const char* PI_IP         = "flighttracker.local";   // local IP of your Pi
const int   PI_PORT       = 80;   // lighttpd proxies /api/ to settings-api.py (8089)
                                   // internally — point this at 80, not 8089 directly.

// ── Receiver location ─────────────────────────────────────────────────────────
// No longer used client-side — the Pi's GET /api/epaper now does all distance/
// selection math server-side using its own configured location. Left here only
// so this file's layout doesn't need to change if that ever moves back.
const float RECEIVER_LAT  = 52.00818f;
const float RECEIVER_LON  = 4.71261f;

// ── Time zone ─────────────────────────────────────────────────────────────────
// UTC offset in seconds: 3600 = UTC+1 (CET), 7200 = UTC+2 (CEST), 0 = UTC
const long  TZ_OFFSET_SEC = 7200;   // CEST = UTC+2; winter = 3600

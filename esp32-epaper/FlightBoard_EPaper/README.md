# FlightBoard — Waveshare ESP32-S3-RLCD-4.2

Displays the nearest ADS-B aircraft on the 4.2" Reflective LCD (ST7305, 300×400 px).

## Layout (landscape 400×300)

Dark page background with light "bubble" cards (see `FlightBoard_EPaper.ino`'s
header comment for the authoritative, up-to-date diagram — this is a summary):

```
┌─────────────────────────────────────────────────────────────────────────┐
│ FLIGHTBOARD              5 AC                                   12:34   │  ← status bar (inverted)
├─────────┬─────────────────────────────────────┬───────────────────────┤
│         │╔═══════════════════════════════════╗ │┌─────────────────────┐│
│  KLM    │║  SPEEDBIRD                        ║ ││  TAIL               ││
│  logo   │║        KLM1234                    ║ ││      PH-BXA         ││  ← header (88 px tall)
│  bubble │║  KLM ROYAL DUTCH AIRLINES         ║ ││  BOEING 737-800     ││
│  (88px) │╚═══════════════════════════════════╝ │└─────────────────────┘│
├─────────┴─────────────────────────────────────┴───────────────────────┤
│ LIVE TELEMETRY ──────────────────────────────────────────────────────── │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                      │
│ │  ALTITUDE    │ │  V-SPEED     │ │  GND SPD     │                      │  ← bubble grid row 1
│ │    32100     │ │    +1200     │ │     456      │                      │
│ │     FT       │ │     FPM      │ │     KTS      │                      │
│ └──────────────┘ └──────────────┘ └──────────────┘                      │
│ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                      │
│ │  HEADING     │ │  DISTANCE    │ │  STATUS      │                      │  ← bubble grid row 2
│ │    180°      │ │    59.4      │ │  CLIMBING    │                      │
│ │     S        │ │     KM       │ │              │                      │
│ └──────────────┘ └──────────────┘ └──────────────┘                      │
│ ┌─────────────────────────────────────────────────────────────────────┐  │
│ │                                ROUTE                                │  │
│ │ AMS ───────────────✈───────────────────────────────────────── LHR │  │  ← route banner
│ │ Amsterdam Schiphol              1:30                London Heathrow │  │
│ └─────────────────────────────────────────────────────────────────────┘  │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┬───────────────────────┤
│ SRC  │ SIG  │ SQK  │ MACH │ IAS  │ OAT  │ HDG  │ MSGS                 │  ← telem strip
│ADS-B │ -18  │ 2245 │.783  │280KT │ -42  │ 182° │ 12345                │
├──────┴──────┴──────┴──────┴──────┴──────┴──────┴───────────────────────┤
│ 5 AC  KLM1234 · BAW456 · AFR789                                12:34   │  ← footer (inverted)
└─────────────────────────────────────────────────────────────────────────┘
```

The CALLSIGN label shows the ATC phonetic callsign (e.g. "SPEEDBIRD" for
British Airways) when known, and the airline-name subtext is replaced with
"MILITARY" / "PRIVATE" when the aircraft is flagged as such. The board shows
the most notable aircraft in range — an emergency squawk, then a rare/
"interesting" aircraft, then a military aircraft, falling back to the
closest aircraft when nothing special is around.

---

## One-time setup steps

### 1. Copy the Waveshare display driver

The ST7305 controller driver is not on the Arduino Library Manager.
Download these two files and place them **in the same folder as FlightBoard_EPaper.ino**:

- `ST7305_U8g2.h`
- `ST7305_U8g2.cpp`

Download from:
https://github.com/waveshareteam/ESP32-S3-RLCD-4.2/tree/main/02_Example/Arduino/10_U8G2_Test/

### 2. Install libraries (Arduino Library Manager)

| Library | Author |
|---------|--------|
| **U8g2** | oliver / olikraus |
| **ArduinoJson** | Benoit Blanchon |

### 3. Configure credentials

Copy `secrets.h.example` → `secrets.h` and edit:
- `WIFI_SSID` / `WIFI_PASSWORD`
- `PI_IP` — local IP address of your Raspberry Pi
- `PI_PORT` — normally `80` (lighttpd proxies `/api/` to settings-api.py internally)
- `TZ_OFFSET_SEC` — UTC offset in seconds (3600 = UTC+1, 7200 = UTC+2)

`RECEIVER_LAT` / `RECEIVER_LON` are no longer used by the sketch — the Pi's
`/api/epaper` endpoint does all distance/selection math server-side using its
own configured location.

### 4. Board settings (Tools menu)

| Setting | Value |
|---------|-------|
| Board | ESP32S3 Dev Module |
| USB CDC on Boot | Enabled |
| PSRAM | **OPI PSRAM** (the N16R8 module uses OPI, not QSPI) |
| Partition Scheme | Huge APP (3MB No OTA/1MB SPIFFS) |
| Upload Speed | 921600 |

> **Partition note:** The U8G2 full font set makes the binary larger than the default
> 4MB partition allows. Select "Huge APP" or any scheme with ≥3 MB app space.

### 5. Compile and upload

Select the correct COM port and click Upload.

---

## Sketch folder contents after setup

```
FlightBoard_EPaper/
├── FlightBoard_EPaper.ino   ← main sketch
├── ST7305_U8g2.h            ← copy from Waveshare GitHub (step 1)
├── ST7305_U8g2.cpp          ← copy from Waveshare GitHub (step 1)
├── secrets.h                ← your credentials (never commit)
└── secrets.h.example        ← template
```

---

## Display orientation

The sketch initialises with `U8G2_R1` (90° clockwise rotation) which makes
the 300×400 physical panel appear as 400×300 landscape. If the image is
rotated or mirrored, change the rotation argument in `lcd.begin(0, U8G2_R1)`
to `U8G2_R0`, `U8G2_R2`, or `U8G2_R3`.

## Tuning the vertical layout

All baseline Y positions are defined as `#define` constants near the top of
the `.ino` file (`CS_BASE`, `RT_BASE`, `D1_VAL`, etc.). If text is clipped or
sections overlap, adjust these values; each unit = 1 pixel.

## Data source

- Aircraft + route: `http://<PI_IP>:<PI_PORT>/api/epaper` — a single pre-selected,
  pre-enriched aircraft plus a short callsign list. All selection (closest /
  emergency / interesting / military), route lookup, and military/private/
  ATC-callsign flagging happens server-side on the Pi (`scripts/settings-api.py`)
  — the ESP makes no other outbound calls (no TLS, no direct adsbdb.com calls).
- Airline logo: `http://<PI_IP>/airline_logos/airline_logo_<ICAO3>.png`
- Display refresh: every 10 s, or only when the shown aircraft's state changes

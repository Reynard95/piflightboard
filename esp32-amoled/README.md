# ESP32-S3 AMOLED Flight Board

A standalone flight information display running on the **Waveshare ESP32-S3-Touch-AMOLED-1.8** board. Connects to the Pi flight tracker over WiFi and shows live ADS-B data, weather, RF spectrum, and system stats.

---

## Hardware

**Board:** Waveshare ESP32-S3-Touch-AMOLED-1.8  
**Display:** 368 × 448 px, CO5300 controller, QSPI interface  
**Touch:** FT3168 capacitive, I2C  
**Audio:** ES8311 codec + I2S, PA on GPIO 46  
**PSRAM:** 8 MB QSPI  
**Flash:** 16 MB  
**USB:** native USB-C (ESP32-S3 native USB, not CH340)

### Pin map

| Function        | GPIO |
|-----------------|------|
| LCD QSPI CS     | 12   |
| LCD QSPI SCK    | 11   |
| LCD QSPI D0–D3  | 4, 5, 6, 7 |
| I2C SDA (shared)| 15   |
| I2C SCL (shared)| 14   |
| Touch INT       | 21   |
| Audio PA enable | 46   |
| BOOT button     | 0    |

### I2C devices (SDA=15, SCL=14)

| Device         | Address | Purpose |
|----------------|---------|---------|
| TCA9554        | 0x20    | I/O expander — LCD reset (bit 0), DSI_PWR_EN (bit 1), TP_RST (bit 2) |
| ES8311         | 0x18    | Audio codec |
| FT3168         | 0x38    | Touch controller |
| IMU            | 0x6B    | (not used in sketch) |
| RTC            | 0x51    | (not used in sketch) |
| PMIC           | 0x34    | Battery management (registers not yet mapped) |

### Display init sequence

The CO5300 reset and power are **not** on a GPIO pin — they go through the TCA9554 expander:

```
Wire.begin(15, 14) + setClock(400000)
TCA9554 reg 0x03 = 0x00   (all pins as output)
TCA9554 reg 0x01 = 0x00   (all low)
delay 20 ms
TCA9554 reg 0x01 = 0x02   (DSI_PWR_EN = bit 1 HIGH)
delay 20 ms
TCA9554 reg 0x01 = 0x03   (LCD_RST = bit 0 HIGH)
delay 20 ms
gfx->begin(80000000)       (QSPI at 80 MHz → sends CO5300 init sequence)
```

> **Do not** set GPIO 46 HIGH during display init — it enables the audio amplifier, not the backlight.

---

## Folder structure

```
esp32-amoled/
  arduino-radar/
    ESP32_Radar/
      ESP32_Radar.ino     ← main sketch (flight board, all views)
    DisplayTest/
      DisplayTest.ino     ← minimal display test (red/green/blue fills)
    AudioTest/
      AudioTest.ino       ← 440 Hz sine tone through ES8311
  README.md               ← this file
```

The MicroPython files (`main.py`, `config.py`, `st7789.py`, etc.) in the root of this folder are from an earlier experiment that did not work — the CO5300 display is not supported by MicroPython drivers.

---

## Arduino IDE setup

### Board package
- Board: **ESP32S3 Dev Module** (in esp32 by Espressif, core 3.x)
- USB CDC on Boot: **Enabled** (required to see Serial output over native USB)
- PSRAM: **QSPI PSRAM**
- Partition scheme: 16M Flash (3MB APP / 9.9MB FATFS)

### Libraries (Library Manager)
- **GFX Library for Arduino** (by Moon On Our Nation) — provides `Arduino_CO5300`, `Arduino_ESP32QSPI`
- **ArduinoJson** (by Benoit Blanchon)

### Known compile fix — io_pin_remap.h macro conflict

ESP32 core 3.x defines macros that conflict with GFX library class declarations. Patch these two files in the GFX library install:

- `Arduino/libraries/GFX_Library_for_Arduino/src/databus/Arduino_XL9535SWSPI.h`
- `Arduino/libraries/GFX_Library_for_Arduino/src/databus/Arduino_XCA9554SWSPI.h`

Before the class declaration in each file, add:

```cpp
#pragma push_macro("pinMode")
#pragma push_macro("digitalWrite")
#pragma push_macro("digitalRead")
#undef pinMode
#undef digitalWrite
#undef digitalRead
```

After the class declaration, add:

```cpp
#pragma pop_macro("pinMode")
#pragma pop_macro("digitalWrite")
#pragma pop_macro("digitalRead")
```

---

## Main sketch — ESP32_Radar.ino

### Configuration (top of file)

```cpp
const char* WIFI_SSID     = "...";
const char* WIFI_PASSWORD = "...";
const char* PI_IP         = "192.168.2.42";   // Pi's local IP
const int   PI_PORT       = 80;

const float RECEIVER_LAT  = 52.00818;          // receiver location (for distance calc)
const float RECEIVER_LON  = 4.71261;
const long  TZ_OFFSET_SEC = 7200;              // UTC+2 (CEST/NL summer); 3600 for winter
```

### Views

The BOOT button (GPIO 0) cycles through five views. The current view is shown as dots at the bottom of the screen.

| # | View | Description |
|---|------|-------------|
| 0 | **FLIGHTBOARD** | Nearest aircraft: callsign, tail number, origin → destination airports, ALT / SPD / HDG / DST, nearby traffic strip |
| 1 | **CLOCK** | NTP time and date (large), current weather summary |
| 2 | **SYSTEM** | Pi flight tracker vitals (CPU, memory, disk, network, uptime) + ESP32 stats (CPU freq, heap, PSRAM, WiFi RSSI) |
| 3 | **WEATHER** | Temperature, condition, wind speed and direction from Open-Meteo |
| 4 | **SPECTRUM** | RF spectrum from the Pi's `/api/spectrum` endpoint (80–1110 MHz, bar chart) |

### Button behaviour

| Gesture | Action |
|---------|--------|
| Single press | Next view |
| Double press (within 450 ms) | Sleep (display off) |
| Any press or touch (GPIO 21 INT) | Wake from sleep |

### Sleep

Double-pressing BOOT cuts DSI_PWR_EN via TCA9554 (display goes dark). A single press or a finger touch (FT3168 INT pin going LOW) restores power and re-runs the CO5300 init sequence.

### Theme — Airbus

Matches `?theme=airbus` from the web app (steel blue on dark navy):

| Define | Hex (RGB565) | Web colour | Use |
|--------|-------------|------------|-----|
| `C_BG`  | `0x0000` | `#06080F` | Background |
| `C_FG`  | `0x7D9C` | `#7EB3E8` | Primary text |
| `C_MID` | `0x47D5` | `#4A7AB0` | Secondary text |
| `C_DIM` | `0x21EB` | `#243C5A` | Dim / inactive |
| `C_HI`  | `0x3C7A` | `#3A8FD4` | Accent / key data |
| `C_LT`  | `0xAEBF` | `#B0D8F8` | Route airports / warnings |
| `C_SEP` | `0x1106` | `#152030` | Header bar background |
| `C_RED` | `0xFB4C` | `#FF6060` | Errors / danger |

### Pi API endpoints used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/data/aircraft.json` | GET | Live ADS-B feed (readsb, updated ~1 s) |
| `/api/vitals` | GET | Pi system stats — no auth required |
| `/api/spectrum` | GET | RF spectrum sweep (real or simulated) |
| `http://{PI_IP}:8088/` | POST | Route lookup via Pi proxy (avoids TLS heap spike) |
| `http://api.open-meteo.com/v1/forecast` | GET | Weather — plain HTTP (open-meteo supports both) |

### Aircraft data fields used from aircraft.json

| Field | Meaning |
|-------|---------|
| `flight` | Callsign (e.g. `KLM1234`) |
| `r` | Registration / tail number (e.g. `PH-BXA`) |
| `lat`, `lon` | Position |
| `r_dst` | Distance from receiver in NM (computed by readsb when lat/lon set) |
| `alt_baro` | Barometric altitude in feet |
| `gs` | Ground speed in knots |
| `track` | Track/heading in degrees |

### Fetch intervals

| Data | Interval |
|------|----------|
| Aircraft | 5 s |
| Vitals | 10 s (only fetched, not displayed, unless on System view) |
| Weather | 5 min |
| Spectrum | 15 s (only while on Spectrum view) |
| Route | On aircraft change (cached until nearest aircraft changes) |

---

## Test sketches

### DisplayTest.ino

Fills the screen red → green → blue → prints "HELLO CO5300". Use this to confirm the display and init sequence are working before loading the main sketch.

### AudioTest.ino

Plays a 440 Hz sine wave through the ES8311 codec and the built-in speaker. ES8311 register init sequence and I2S pin assignments are documented in the file.

I2S pins: MCLK=16, SCLK=9, LRCK=45, DOUT=8, DIN=10  
Sample rate: 16 kHz, 16-bit stereo, MCLK = 4.096 MHz (256 × 16000)

---

## Troubleshooting

**Display blank / line flash only**
- Confirm "USB CDC on Boot: Enabled" in board settings (otherwise Serial.print() doesn't appear and the board may stall).
- Confirm the TCA9554 expander init runs before `gfx->begin()` — the display won't power on without it.
- When using `Arduino_Canvas`, call `display->begin()` explicitly *before* creating the canvas. `Arduino_Canvas::begin()` checks `_output->width()` before calling `_output->begin()` — CO5300 stores its dimensions from the constructor so the check is always non-zero, meaning the canvas will silently skip display init. Call `display->begin()` first, then create and begin the canvas.
- "Line flash, then black" on repeat is the ESP32 OOM-crashing and rebooting. `WiFiClientSecure` TLS handshakes spike the heap by ~256 KB, which overflows the ~200 KB available. Both `fetchRoute()` and `fetchWeather()` now use plain HTTP to avoid this.

**Serial output not visible**
- ESP32-S3 uses native USB. Select the correct COM port *after* the board enumerates (it appears as "USB JTAG/serial debug unit").
- Enable "USB CDC on Boot" in board settings.

**Compile error: io_pin_remap.h / pinMode redefinition**
- Apply the `push_macro` / `pop_macro` patch described above to `Arduino_XL9535SWSPI.h` and `Arduino_XCA9554SWSPI.h`.

**Upload fails / port busy**
- Close Serial Monitor before uploading — it holds the COM port.

**Wrong display driver**
- This board uses **CO5300** over **QSPI**. Do not use `Arduino_ST7789`, `Arduino_SH8601`, or standard SPI.
- Use `Arduino_CO5300(bus, GFX_NOT_DEFINED, 0, 368, 448)` — no `ips` boolean parameter.

**Weather shows "FETCHING WX..."**
- Open-Meteo's newer API uses `current=` parameters, not `current_weather=true`. The sketch already uses the correct format.
- Check WiFi is connected and the ESP32 can reach `api.open-meteo.com` (plain HTTP, port 80).

**Time is wrong by one hour**
- Netherlands: `TZ_OFFSET_SEC = 7200` in summer (CEST, UTC+2), `3600` in winter (CET, UTC+1).

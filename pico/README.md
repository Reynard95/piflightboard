# Pico Radar

Live ADS-B radar on a **Raspberry Pi Pico 2W** + **Waveshare Pico LCD 1.44"** (128×128 ST7735S).

## Hardware

| Part | Notes |
|------|-------|
| Raspberry Pi Pico 2W | RP2350, built-in WiFi |
| Waveshare Pico LCD 1.44" | ST7735S, 128×128, 4 buttons |

The LCD HAT plugs directly on to the Pico headers — no wiring needed.

### Default pin mapping

| Signal | GPIO | Config key |
|--------|------|------------|
| LCD CLK | GP10 | `LCD_SCK` |
| LCD DIN | GP11 | `LCD_MOSI` |
| LCD CS  | GP9  | `LCD_CS`  |
| LCD DC  | GP8  | `LCD_DC`  |
| LCD RST | GP12 | `LCD_RST` |
| LCD BL  | GP13 | `LCD_BL`  |
| KEY_A (range) | GP15 | `BTN_RANGE` |
| KEY_B (mode)  | GP17 | `BTN_MODE`  |
| UP / PREV     | GP2  | `BTN_PREV`  |
| DOWN / NEXT   | GP18 | `BTN_NEXT`  |

Verify against the Waveshare wiki for your exact HAT revision and adjust `config.py` if needed.

## Setup

### 1. Flash MicroPython

Download the **Pico 2W** build from [micropython.org/download](https://micropython.org/download/RPI_PICO2W/) (`.uf2` file).

Hold **BOOTSEL**, plug in USB → drag the `.uf2` on to the `RPI-RP2` drive.

### 2. Install urequests

Open a REPL (Thonny or `mpremote`) and run:

```python
import mip
mip.install('urequests')
```

### 3. Configure

Edit `config.py`:

```python
WIFI_SSID     = "your_network"
WIFI_PASSWORD = "your_password"
PI_IP         = "192.168.x.x"   # Pi running readsb / lighttpd
```

Update `RECEIVER_LAT` / `RECEIVER_LON` if they differ from your `config/readsb.conf`.

### 4. Upload files

Using Thonny, `rshell`, or `mpremote`:

```bash
mpremote cp config.py :config.py
mpremote cp st7735.py :st7735.py
mpremote cp main.py   :main.py
```

Reset the Pico — it runs `main.py` automatically.

## Controls

| Button | Action |
|--------|--------|
| KEY_A  | Cycle range: 100 → 150 → 200 → 250 → 100 km |
| KEY_B  | Toggle radar view ↔ list view |
| UP     | Select previous aircraft (highlight) |
| DOWN   | Select next aircraft (highlight) |

## Radar view

- Three green range rings at ⅓, ⅔ and full range
- **White** blip = cruising · **Green** = climbing · **Red** = descending · **Blue** = on ground
- Selected aircraft: yellow ring + info bar at top
- Bottom bar: current range · WiFi indicator · visible count

## List view

Closest aircraft sorted by distance. Selected aircraft highlighted in yellow.
Columns: callsign · altitude (ft) · distance (km).

## Troubleshooting

**Display is blank / white** — check LCD_MADCTL in config.py. Try `0x00`, `0x08`, or `0xC0`.

**Image is mirrored or rotated** — change `LCD_MADCTL`. Common values:
- `0xC8` portrait, normal (default)
- `0x68` landscape
- `0x00` portrait, no colour inversion

**Content is shifted** — adjust `LCD_X_OFFSET` / `LCD_Y_OFFSET` (default 2, 1).

**`MemoryError` on fetch** — the aircraft.json can be large in busy airspace. Reduce `FETCH_INTERVAL` or add a smaller `RANGE_OPTIONS` value (e.g. 50) and use that range.

**Colours look wrong (red/blue swapped)** — flip the BGR bit in `LCD_MADCTL`: XOR with `0x08`.

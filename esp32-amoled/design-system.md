# ADS-B Display — Design System v1.0

**Aviation Modern Theme (Airbus Inspired)**

This design system defines the visual language for the ADS-B desktop display.
Inspired by modern Airbus design principles: clean, professional, high-contrast
appearance optimised for AMOLED displays.

---

## Color Palette

| Token | Hex | RGB565 | Use |
|-------|-----|--------|-----|
| `C_BG` | `#000000` | `0x0000` | AMOLED pure black background |
| `C_PANEL` | `#151515` | `0x10A2` | Card / panel fill |
| `C_BORDER` | `#3C3C3C` | `0x39E7` | Border / divider lines |
| `C_FG` | `#FFFFFF` | `0xFFFF` | Primary text |
| `C_TEXT_SEC` | `#AFAFAF` | `0xAD75` | Secondary text / labels |
| `C_BLUE` | `#4BA3FF` | `0x4D1F` | Airbus blue — accents, left-border highlights |
| `C_BLUE_INFO` | `#2AC6FF` | `0x2E3F` | Info blue — route text, highlights |
| `C_GREEN` | `#4CD964` | `0x4ECC` | Normal / OK status |
| `C_AMBER` | `#FFC247` | `0xFE08` | Caution / approaching limits |
| `C_RED` | `#FF4D4D` | `0xFA69` | Critical / limit exceeded |

### Hex → RGB565 formula

```
R5 = hex_R >> 3
G6 = hex_G >> 2
B5 = hex_B >> 3
RGB565 = (R5 << 11) | (G6 << 5) | B5
```

---

## Typography

**Font:** DIN 2014 (Regular / Medium / Bold)

- All labels in **UPPERCASE**
- Values in normal case with units appended

| Style | Target size | Arduino textSize | Approx cap height |
|-------|-------------|-----------------|-------------------|
| VALUE XL | 56 px | 7 | 56 px |
| VALUE L | 40 px | 5 | 40 px |
| VALUE M | 28 px | 3 | 24 px |
| VALUE S | 22 px | 3 | 24 px |
| LABEL | 16 px | 2 | 16 px |
| LABEL SMALL | 12 px | 1 | 8 px |
| STATUS BAR | 14 px | 1 | 8 px |

> The Arduino GFX default font scales in integer multiples (8 px per unit tall,
> 6 px per unit wide). Use Adafruit GFX FreeFont headers for closer DIN sizing.

---

## Components

### Panel / Card

```
fillRoundRect(x, y, w, h, 4, C_PANEL)
drawRoundRect(x, y, w, h, 4, C_BORDER)
```

- Background: `C_PANEL` (`#151515`)
- Border: `C_BORDER` (`#3C3C3C`), 1 px (drawn by `drawRoundRect`)
- Corner radius: **4 px**

### Data Cell

Labelled value tile used in the dashboard data grid.

```
┌─│──────────────────────┐
  │  LABEL SMALL          │  ← C_TEXT_SEC, textSize 1
  │  37,000 ft            │  ← C_FG (or status colour), textSize 3
└─│──────────────────────┘
  ↑ 3 px C_BLUE left accent
```

- Panel background + border (4 px radius)
- Left accent bar: **3 px wide**, `C_BLUE`
- Label: UPPERCASE, `C_TEXT_SEC`, textSize 1
- Value: `C_FG` or status colour, textSize 3
- Unit: `C_TEXT_SEC`, textSize 1, line below value

### Progress Bar

```
drawBar(x, y, width, 6, percent, color)
```

- Height: **6 px**, square ends
- Background: `C_PANEL`
- Outline: `C_BORDER`
- Fill colour by threshold:
  - Normal (< 70 %): `C_GREEN`
  - Caution (70–85 %): `C_AMBER`
  - Critical (> 85 %): `C_RED`

### Badge

Small inline tag for identifiers (ICAO hex, squawk, etc.).

```
fillRoundRect(x, y, w, 14, 2, C_PANEL)
drawRoundRect(x, y, w, 14, 2, C_BORDER)
```

- Height: **14 px**, 2 px radius
- Text: textSize 1, colour by variant

| Variant | Border / text colour |
|---------|---------------------|
| INFO | `C_BLUE_INFO` |
| OK | `C_GREEN` |
| CAUTION | `C_AMBER` |
| WARNING | `C_RED` |

### Status Bar

Persistent footer, shown on every screen.

- Height: **20 px**, background `C_PANEL`
- Top separator: `C_BORDER`

Fields (left → right):

| # | Content | Colour |
|---|---------|--------|
| 1 | View abbreviation | `C_BLUE_INFO` |
| 2 | Aircraft count (e.g. `42 AC`) | `C_GREEN` |
| 3 | ADS-B msg/s (e.g. `214/s`) | `C_TEXT_SEC` |
| 4 | WiFi RSSI (e.g. `-52 dBm`) | `C_TEXT_SEC` |
| 5 | UTC time (e.g. `18:42Z`) | `C_FG`, right-aligned |

---

## Dashboard Screen Layout

Display: 368 × 448 px · Margin: 8 px · Status bar: 20 px

```
┌──────────────────────────────────────────┐  y = 0
│  CLOSEST AIRCRAFT              18:42 UTC │  Header panel (22 px, C_PANEL)
├──────────────────────────────────────────┤  y = 22
│  [radar circle +  │  KLM641              │
│   aircraft icon]  │  A320neo             │
│                   │  AMSTERDAM           │  162 px (aircraft info)
│   FL 370          │    ↓                 │
│                   │  HEATHROW            │
│                   │  [ICAO 484506]       │
├───────────────────┴──────────────────────┤  y = 184
│ │ 37,000          │ │ 843                │
│ │ ft  ALTITUDE    │ │ km/h  GROUND SPEED │  62 px (data row 1)
├──────────────────────────────────────────┤  y = 250
│ │ 18.4            │ │ 274°               │
│ │ km   DISTANCE   │ │      HEADING       │  62 px (data row 2)
├──────────────────────────────────────────┤  y = 316
│ │ +400            │ │ NW                 │
│ │ ft/min VERT SPD │ │      BEARING       │  62 px (data row 3)
├──────────────────────────────────────────┤  y = 382
│  ✈  Amsterdam (EHAM)  →  Heathrow (EGLL) │  Route bar (38 px)
├──────────────────────────────────────────┤  y = 420 (approx)
│  DASH  42 AC  214/s  -52 dBm  18:42Z    │  Status bar (20 px)
└──────────────────────────────────────────┘  y = 448
```

Left column (aircraft circle): x = 8 → 156, circle centre (84, 106), r = 68
Right column (callsign info):   x = 160 → 360

Data grid: cell width = 174 px, cell height = 62 px, gap = 4 px

---

## Icon System

Icons are **2 px stroke**, rounded caps and joins.
Use theme status colours for semantic meaning.

| Icon | Drawn with | Notes |
|------|-----------|-------|
| Aircraft (top-down) | `fillTriangle` + `fillRoundRect` | Fuselage + swept wings + tail |
| Radar rings | `drawCircle` × 3 + cross-hairs | Used on radar screen |
| Battery | `drawRect` + `fillRect` | Outline + filled portion |
| WiFi | Concentric arcs | Status bar |
| Antenna | Lines + dot | ADS-B signal |

---

## Spacing Scale

Base unit: **4 px** — all spacing is a multiple of 4.

```
4   8   16   20   24   32   40   48   56   64
```

---

## Status Colour Thresholds

| Metric | Normal | Caution | Critical |
|--------|--------|---------|---------|
| CPU / Memory / Disk | < 70 % | 70–85 % | > 85 % |
| Disk (alt) | < 75 % | 75–90 % | > 90 % |
| CPU Temperature | < 55 °C | 55–70 °C | > 70 °C |
| WiFi RSSI | > −70 dBm | −70 to −85 | < −85 dBm |
| Battery | > 30 % | 15–30 % | < 15 % |

---

## Future Themes

The sketch settings screen stores a `settingTheme` index.
New themes are added by implementing the colour tokens as a separate set of
`#define` values and switching on the index in a `applyTheme()` function.

Planned themes:

| # | Name | Inspired by |
|---|------|-------------|
| 0 | **ECAM** (default) | Airbus Electronic Centralised Aircraft Monitor |
| 1 | EICAS | Boeing Engine Indicating and Crew Alerting System |
| 2 | G1000 | Garmin G1000 glass cockpit |
| 3 | MIL-TAC | Military tactical display |
| 4 | RETRO-CRT | Phosphor green monochrome radar |
| 5 | MINIMAL | Ultra-minimal AMOLED, low power |

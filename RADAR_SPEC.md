# radar.html — Build Specification

Radar PPI display for the piflightboard project. Reads the same `aircraft.json` source as the e-ink pages, rendered as a plan-position-indicator radar with a rotating sweep arm, country outlines, airport markers, and a responsive aircraft card grid.

---

## Files to create

| File | Purpose |
|------|---------|
| `www/radar.html` | Shell page |
| `www/radar.css` | All styles |
| `www/radar-themes.js` | New themes based on aircraft manufacturer styles |
| `www/radar.js` | Main logic — fetch, render, sweep animation, burger menu |
| `www/radar-geo.js` | Geographic data — country outlines + airport list |

Load order in `radar.html`:
```html
<script src="data.js"></script>
<script src="radar-themes.js"></script>   <!-- themes: color, airbus, boeing, embraer, bombardier, military -->
<script src="radar-geo.js"></script>
<script src="radar.js"></script>
```

---

## Layout

Two-panel flex row. On narrow screens (< 700px) the right panel stacks below the radar.

```
┌─────────────────────────────────────────────────────────┐
│  ┌────────────────────────┐  ┌──────────────────────┐   │
│  │     PPI CANVAS         │  │ ● LIVE        ≡ MENU │   │
│  │    (square, fills      │  │                      │   │
│  │     available width    │  │  ┌──────┐ ┌──────┐   │   │
│  │      and height)       │  │  │ card │ │ card │   │   │
│  └────────────────────────┘  │  └──────┘ └──────┘   │   │
│  TRACKED  AIRPORTS  TIME      │  ┌──────┐ ┌──────┐   │   │
│  7        8         14:32     │  │ card │ │ card │   │   │
│                              │  └──────┘ └──────┘   │   │
│                              └──────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## Theme

Use `radar-themes.js` for `?theme=`. Default theme for radar is `color` (dark bg, amber text) — set this as the fallback before loading `radar-themes.js`:

```html
<!-- set default theme before radar-themes.js runs -->
<script>
  if (!new URLSearchParams(location.search).has('theme')) {
    const u = new URL(location.href);
    u.searchParams.set('theme', 'color');
    history.replaceState(null, '', u);
  }
</script>
```

### radar-themes.js

New themes inspired by aircraft manufacturer design languages. Each theme is an object of CSS custom properties applied to `:root`. The IIFE reads `?theme=` and applies the matching theme.

| Theme | Inspiration | Background | Foreground | Accent |
|-------|-------------|-----------|-----------|--------|
| `color` | Default radar amber | `#050200` | `#FFA040` | `#FF8000` |
| `airbus` | Airbus blue/grey corporate | `#06080F` | `#7EB3E8` | `#3A8FD4` |
| `boeing` | Boeing navy/gold | `#060508` | `#C8A84B` | `#F0C040` |
| `embraer` | Embraer teal/silver | `#050A09` | `#5FC4B0` | `#2EA898` |
| `bombardier` | Bombardier red/dark | `#080505` | `#E87070` | `#CC4444` |
| `military` | Military green-on-black | `#030603` | `#5EBF5E` | `#3A9A3A` |

CSS custom properties used across all themes: `--bg`, `--fg`, `--fg-mid`, `--fg-dim`, `--sep`.

Land fill is always slightly lighter than `--bg`; country outlines use a very dark tint of `--fg`.

---

## Burger menu

A `≡ MENU` button in the top-right corner of the right panel opens a full-panel overlay containing all settings. This keeps the main UI clean and focused.

### Menu structure

```
╔═══════════════════════════════╗
║  ✕  SETTINGS                  ║
╠═══════════════════════════════╣
║  RANGE                        ║
║  [ 100 ] [ 150 ] [▶250◀] AUTO ║
╠═══════════════════════════════╣
║  SWEEP                        ║
║  [▶ ON ] [  OFF ]             ║
╠═══════════════════════════════╣
║  UNITS                        ║
║  [▶ IMPERIAL ] [ METRIC ]     ║
╠═══════════════════════════════╣
║  THEME                        ║
║  [▶COLOR] [AIRBUS] [BOEING]   ║
║  [EMBRAER] [BOMBARDIER] [MIL] ║
╠═══════════════════════════════╣
║  LEGEND                       ║
║  ● LEVEL  ▲ CLIMBING          ║
║  ▼ DESCENDING  ■ ON GROUND    ║
╚═══════════════════════════════╝
```

- Active selection styled with `--fg` border and text (same pattern as range buttons)
- Closing the menu (✕ or click outside) persists all settings to URL params via `history.replaceState`
- Theme change is applied immediately without page reload
- Range / sweep / units changes take effect immediately

---

## Sweep toggle

```javascript
let sweepEnabled = true;  // toggled by burger menu

function frame(ts) {
  const dt = ts - lastTs; lastTs = ts;
  if (sweepEnabled) {
    sweepAngle += SWEEP_RADS_PER_MS * dt;
    if (sweepAngle > 3 * Math.PI / 2) sweepAngle = -Math.PI / 2;
  }
  ctx.clearRect(0, 0, W, W);
  drawBase();
  if (sweepEnabled) drawSweep(sweepAngle);
  drawBlips();
  requestAnimationFrame(frame);
}
```

When `sweepEnabled` is false the sweep sector is not drawn and the angle does not advance. The `requestAnimationFrame` loop still runs so blips update on data fetch.

URL param: `?sweep=off` sets `sweepEnabled = false` on load.

---

## Units toggle

Two modes: **imperial** (default) and **metric**. All altitude, speed, and vertical rate values in both the canvas callout labels and the aircraft cards use these helpers:

```javascript
let metricUnits = false;  // toggled by burger menu; ?units=metric sets true on load

function fmtAlt(ft) {
  if (ft === 'ground') return 'GND';
  if (metricUnits) return Math.round(ft * 0.3048) + ' M';
  return ft.toLocaleString() + ' FT';
}

function fmtSpd(kt) {
  if (metricUnits) return Math.round(kt * 1.852) + ' KM/H';
  return kt + ' KT';
}

function fmtVs(fpm) {
  if (fpm === 0) return '±0' + (metricUnits ? ' M/S' : ' FPM');
  const sign = fpm > 0 ? '+' : '';
  if (metricUnits) return sign + (fpm * 0.00508).toFixed(1) + ' M/S';
  return sign + fpm.toLocaleString() + ' FPM';
}
```

Card field labels update accordingly: `ALTITUDE` / `SPEED` / `VERT RATE` do not change but values and units suffix do.

---

## Radar canvas

### Projection

Equirectangular, centred on the receiver location. Keep receiver coords in sync with `config/readsb.conf`:

```javascript
// radar-geo.js — top of file
const RECEIVER = { lat: 52.0116, lon: 4.7683 };
const KM_PER_LAT = 111.32;
const KM_PER_LON = 111.32 * Math.cos(RECEIVER.lat * Math.PI / 180); // ≈ 68.55

function geoToXY(lat, lon, cx, cy, r, rangeKm) {
  const dx = (lon - RECEIVER.lon) * KM_PER_LON;
  const dy = (lat - RECEIVER.lat) * KM_PER_LAT;
  return [cx + (dx / rangeKm) * r, cy - (dy / rangeKm) * r];
}
```

### Canvas geometry

The canvas is square. The inner radar circle has radius `R` (≈ 130px for a 300×300 canvas — reduced from the full half-width to leave room for the outer degree bezel). The bezel occupies `R+2` to `R+8` from the canvas centre.

```javascript
const W   = canvas.width;   // square canvas side
const cx  = W / 2;
const cy  = W / 2;
const R   = W * 0.43;       // inner radar circle radius (leaves ~7% for bezel)
const RO  = R + 8;          // outer bezel radius
const RI  = R + 2;          // inner bezel radius (gap between radar edge and bezel)
```

### Canvas layers (drawn each frame in this order)

1. **Land fills** — clip to circle radius `R`, fill each country polygon with a slightly lighter background than `--bg`
2. **Country outlines** — thin lines using country polygon edges, very dark tint of `--fg`
3. **Fine grid** — clipped to circle radius `R`; horizontal and vertical lines every `R/5` pixels, opacity 0.08
4. **Range rings** — 5 rings at 20/40/60/80/100% of `R`; label each ring with km value near the top
5. **Compass spokes** — 6 spokes at 30° intervals, opacity 0.06
6. **Compass labels** — N / S / E / W at compass points, inside the radar circle near the edge
7. **North arrow** — solid/hollow chevron near the top of the radar circle pointing upward (north); drawn in `--fg`, filled amber on the leading half, hollow on the trailing half
8. **Airport markers** — cross + square symbol (see below), only airports within current range; IATA label 11px `--fg-dim`
9. **Receiver marker** — crosshair + small circle at canvas centre
10. **Degree bezel** — arc from `RI` to `RO` around full circumference; tick marks every 5° (short) and every 10° (slightly longer); degree labels every 30° in 11px `--fg-dim`; NSEW labels in `--fg` at cardinal points
11. **Sweep sector** — two stacked filled arcs (wide faint + narrow slightly brighter) plus a bright sweep line; only drawn when `sweepEnabled`
12. **Aircraft blips** — trails + heading vector + blip dot; callout label for selected aircraft

### Fine grid

```javascript
// drawn after land + outlines, before rings
ctx.save();
ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--fg').trim();
ctx.globalAlpha = 0.08;
ctx.lineWidth = 0.5;
const step = R / 5;
for (let x = cx % step; x < W; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, W); ctx.stroke(); }
for (let y = cy % step; y < W; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
ctx.restore();
```

### North arrow

Small solid/hollow chevron pointing up, drawn just inside the radar circle at the top (north), centred on `cx`. Filled on the right half, stroked only on the left half to create a classic compass-rose look:

```javascript
function drawNorthArrow(cx, cy, R) {
  const tip = { x: cx, y: cy - R + 18 };
  const base = { x: cx, y: cy - R + 34 };
  ctx.save();
  // filled (amber) left half
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - 6, base.y);
  ctx.lineTo(tip.x, base.y - 4);
  ctx.closePath();
  ctx.fillStyle = fgColor;
  ctx.fill();
  // hollow right half
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + 6, base.y);
  ctx.lineTo(tip.x, base.y - 4);
  ctx.closePath();
  ctx.strokeStyle = fgColor;
  ctx.lineWidth = 1;
  ctx.stroke();
  // "N" label just below the arrow
  ctx.fillStyle = fgColor;
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('N', tip.x, base.y + 10);
  ctx.restore();
}
```

### Degree bezel

Drawn after the radar circle content but before sweep and blips:

```javascript
function drawBezel(cx, cy, RI, RO) {
  // background arc
  ctx.beginPath(); ctx.arc(cx, cy, (RI + RO) / 2, 0, 2 * Math.PI);
  ctx.strokeStyle = fgDimColor; ctx.lineWidth = RO - RI; ctx.globalAlpha = 0.12; ctx.stroke();
  ctx.globalAlpha = 1;

  for (let deg = 0; deg < 360; deg += 5) {
    const rad = (deg - 90) * Math.PI / 180;
    const isMajor = deg % 10 === 0;
    const r1 = isMajor ? RI + 1 : RI + 2;
    const r2 = RO - 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
    ctx.strokeStyle = fgDimColor; ctx.lineWidth = 0.8; ctx.stroke();

    if (deg % 30 === 0) {
      const labelR = RO + 8;
      const label = ['N','','','30','','','60','','','E','','','120','','','150','','','S','','','210','','','240','','','W','','','300','','','330','',''][deg / 10];
      ctx.save();
      ctx.translate(cx + Math.cos(rad) * labelR, cy + Math.sin(rad) * labelR);
      ctx.rotate(rad + Math.PI / 2);
      ctx.font = '9px monospace';
      ctx.fillStyle = ['N','E','S','W'].includes(label) ? fgColor : fgDimColor;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}
```

### Sweep animation

Use `requestAnimationFrame`. Sweep rotates at ~20 RPM (one revolution every 3 seconds).

```javascript
const SWEEP_RADS_PER_MS = (2 * Math.PI * 20) / 60000;
let sweepAngle = -Math.PI / 2; // start at north
let sweepEnabled = true;

function frame(ts) {
  const dt = ts - lastTs; lastTs = ts;
  if (sweepEnabled) {
    sweepAngle += SWEEP_RADS_PER_MS * dt;
    if (sweepAngle > 3 * Math.PI / 2) sweepAngle = -Math.PI / 2;
  }
  ctx.clearRect(0, 0, W, W);
  drawBase();       // land + grid + rings + compass + north arrow + airports + receiver + bezel
  if (sweepEnabled) drawSweep(sweepAngle);
  drawBlips();
  requestAnimationFrame(frame);
}
```

### Aircraft blips

- **Colour by vertical state:**
  - Level (|vr| ≤ 300 fpm) → `var(--fg)` (theme foreground)
  - Climbing (vr > 300) → `#33EE55`
  - Descending (vr < -300) → `#FF5555`
  - On ground (alt_baro === 'ground') → `#4499FF`

- **Trail:** last 3 ghost positions, positioned slightly behind the blip along the reverse bearing, fading in opacity (0.15 → 0.25 → 0.35)

- **Heading vector:** thin line from blip extending ~14px in the direction of `ac.track`; only drawn when `ac.gs > 0`

- **Selected blip:** larger radius (5px vs 4px), soft glow ring, callout label showing callsign + formatted alt + formatted speed (using `fmtAlt` / `fmtSpd`)

- **Blip position:** use `ac.lat` / `ac.lon` for position via `geoToXY()`. Fall back to bearing/distance (`r_dst`) if lat/lon are absent.

### Airport markers

Small cross-in-square symbol. Only render airports within the current range. Label with IATA code, 11px, `--fg-dim` colour.

```javascript
// symbol at (x, y)
const s = 3;
ctx.strokeRect(x - s, y - s, s * 2, s * 2);
ctx.moveTo(x - s - 3, y); ctx.lineTo(x + s + 3, y);
ctx.moveTo(x, y - s - 3); ctx.lineTo(x, y + s + 3);
```

---

## Geographic data (`radar-geo.js`)

Export two constants — simplified polygon arrays and airport list:

### Country outlines

Each entry is an array of `[lat, lon]` pairs forming a closed polygon.

```javascript
const GEO_POLYGONS = [
  // Netherlands
  [[51.37,3.36],[51.48,3.82],[51.65,3.86],[51.80,3.83],[52.02,3.94],
   [52.31,4.08],[52.54,4.22],[52.76,4.74],[53.00,4.78],[53.22,4.94],
   [53.47,5.42],[53.46,6.15],[53.35,7.20],[52.54,7.05],[52.38,7.07],
   [52.24,6.97],[51.98,6.85],[51.84,6.42],[51.68,6.20],[51.54,6.22],
   [51.50,6.09],[51.26,5.69],[51.25,5.03],[51.26,4.77],[51.38,4.65],
   [51.37,4.23],[51.37,3.36]],
  // Belgium
  [[51.37,3.36],[51.05,2.56],[50.83,2.88],[50.65,3.54],[50.73,3.86],
   [50.34,4.86],[50.14,4.87],[50.15,5.83],[49.55,5.82],[49.47,5.99],
   [50.13,6.30],[50.75,6.10],[51.19,6.05],[51.20,5.02],[51.26,4.77],
   [51.38,4.65],[51.37,4.23],[51.37,3.36]],
  // Luxembourg
  [[49.47,5.99],[49.80,6.52],[50.13,6.30],[49.47,5.99]],
  // N France
  [[51.05,2.56],[50.96,1.86],[50.55,1.62],[50.25,1.78],[50.00,1.98],
   [49.75,3.10],[50.00,3.08],[50.14,3.50],[50.14,4.87],[50.65,3.54],
   [50.83,2.88],[51.05,2.56]],
  // W Germany
  [[53.35,7.20],[53.60,7.80],[53.86,8.80],[54.05,9.50],[54.20,9.80],
   [54.18,10.20],[53.80,10.50],[53.55,10.00],[53.00,9.50],[52.50,8.80],
   [52.00,8.40],[51.60,7.60],[51.20,6.85],[50.75,6.10],[50.13,6.30],
   [49.47,5.99],[49.80,6.52],[50.13,6.30],[51.19,6.05],[51.50,6.09],
   [51.68,6.20],[51.84,6.42],[51.98,6.85],[52.38,7.07],[52.54,7.05],
   [53.35,7.20]],
  // SE England (visible at 250 km)
  [[51.35,1.45],[51.15,1.42],[51.00,1.10],[50.88,0.95],[50.77,0.30],
   [50.84,-0.10],[51.15,0.00],[51.48,0.12],[51.75,1.20],[51.35,1.45]],
];
```

### Airports

```javascript
const GEO_AIRPORTS = [
  { iata:'AMS', lat:52.308, lon:4.764 },
  { iata:'RTM', lat:51.957, lon:4.437 },
  { iata:'EIN', lat:51.450, lon:5.374 },
  { iata:'MST', lat:50.911, lon:5.770 },
  { iata:'LGG', lat:50.637, lon:5.443 },
  { iata:'ANR', lat:51.189, lon:4.460 },
  { iata:'DUS', lat:51.289, lon:6.767 },
  { iata:'CGN', lat:50.866, lon:7.142 },
  { iata:'BRU', lat:50.901, lon:4.484 },
  { iata:'BRE', lat:53.048, lon:8.787 },
  { iata:'HAM', lat:53.630, lon:10.006 },
  { iata:'LGW', lat:51.148, lon:-0.190 },
  { iata:'LHR', lat:51.477, lon:-0.461 },
];
```

---

## Aircraft data

### Fetching

Same pattern as `eink.js` — poll `/tar1090/data/aircraft.json` every `FETCH_MS`. Filter to aircraft with `lat`, `lon`, and a non-empty `flight`. Sort by `rssi` descending.

### Airline / type / reg resolution

Reuse the same helpers from `eink.js`:
- `getAirlineCode(callsign)` → ICAO prefix
- `AIRLINES[icaoCode]` → airline name; fall back to `route?.airline?.name` then ICAO code
- `lookupHex(hex)` → tar1090 DB lookup for `{ reg, type, desc }`
- `getTypeName(typeCode)` → `AC_TYPES[key]` or raw code
- `fetchRoute(ac)` → route API for airline name and origin/destination

Route lookup is done per callsign, cached per session (same `routeCache` pattern). The radar does **not** draw route lines on the canvas — route data is only used to resolve the airline name and origin/destination for the card.

### Position history (trails)

Keep a rolling history of the last 4 positions per `ac.hex` in a `posHistory` Map:

```javascript
const posHistory = new Map(); // hex → [{ lat, lon, ts }, ...]

function updateHistory(ac) {
  const h = posHistory.get(ac.hex) || [];
  h.push({ lat: ac.lat, lon: ac.lon, ts: Date.now() });
  if (h.length > 4) h.shift();
  posHistory.set(ac.hex, h);
}
```

Draw the 3 oldest history entries as fading ghost dots before drawing the current blip.

---

## Aircraft card grid

### Container

```css
.ac-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(145px, 1fr));
  gap: 5px;
  overflow-y: auto;
  flex: 1;
}
```

### Card anatomy (top to bottom)

```
┌─────────────────────────┐
│ BRITISH AIRWAYS   76 KM │  ← airline (hero, --fg) + distance (--fg-dim)
│ BAW102                  │  ← flight number (--fg-mid, smaller)
│ B77W · G-VIIA           │  ← type (--fg-mid) · tail (--fg-dim)
├─────────────────────────┤
│ ALTITUDE   SPEED        │
│ 38,000 FT  510 KT       │  ← 2×2 data grid (values use fmtAlt / fmtSpd)
│ ROUTE      VERT RATE    │
│ AMS→LHR    +0 FPM       │  ← origin→dest (--fg-mid) / fmtVs (--fg-mid)
└─────────────────────────┘
```

**ROUTE field:** Shows `ORIG→DEST` using IATA codes from the route API (e.g. `AMS→LHR`). Falls back to `——` if route data is unavailable. Replaces TRACK entirely.

**No status badge.** Vertical rate sign (positive/negative/zero) and blip colour convey climb state; a redundant badge is not needed.

### Selected state

Clicking a card highlights it (amber border) and also highlights the corresponding blip on the canvas with a glow ring + callout label.

---

## Range selector

Five options: `100` `150` `200` `250` `AUTO`. Default: `250`. Accessed via the burger menu.

- `AUTO` — sets range to the smallest standard value (100/150/200/250) that fits all currently visible aircraft
- Changing range re-renders the canvas base (rings + airports) and redraws all blips at the new scale
- Active option styled with `--fg` border and text inside the menu

URL param: `?range=100|150|200|250|auto`

---

## URL parameters

Parse in `radar.js` using `const _fp = new URLSearchParams(location.search)`:

| Param | Default | Effect |
|-------|---------|--------|
| `?theme=color\|airbus\|boeing\|embraer\|bombardier\|military` | `color` | Applied by `radar-themes.js` |
| `?range=100\|150\|200\|250\|auto` | `250` | Initial radar range |
| `?refresh=N` | `2` | Data fetch interval in seconds (minimum 1) |
| `?radius=N` | — | Restrict aircraft list to within N km |
| `?closest` | — | Show only the nearest aircraft |
| `?sweep=off` | — | Start with sweep animation disabled |
| `?units=metric` | — | Start in metric mode (m, km/h, m/s) |

---

## Footer stats bar

Three cells below the canvas: `TRACKED` (aircraft count shown), `AIRPORTS` (airports within range), `TIME` (HH:MM clock, updates every minute).

---

## README additions

Add `radar.html` to the Web UI table and document the URL parameters under a new `## Radar Display` section following the existing e-ink section. Follow the same format: parameter name as a `####` heading, description, example URLs.

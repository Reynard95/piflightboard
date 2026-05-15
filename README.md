# Flighttracker

ADS-B flight tracker running on a Raspberry Pi Zero 2W with NooElec RTL-SDR v5.

## Hardware
- Raspberry Pi Zero 2W
- NooElec RTL-SDR v5
- 64GB microSD card

## Stack
- **readsb** — ADS-B decoder
- **tar1090** — web map UI
- **lighttpd** — web server
- **route-proxy** — CORS proxy for route data
- **Tailscale** — secure remote access for GitHub Actions deploy

## Fresh Install

On a clean Raspberry Pi OS Lite (64-bit):

```bash
# Install git first
sudo apt update && sudo apt install -y git

# Clone the repo as your user (NOT sudo — ownership matters for git pull)
git clone https://github.com/YOUR_USERNAME/piflightboard.git /opt/flighttracker

# Run the install script with sudo
cd /opt/flighttracker
sudo bash scripts/install.sh
```

The script will pause and print instructions when action is needed — particularly for Tailscale authentication and the SSH deploy key.

**After the script finishes:**

```bash
# 1. Authenticate Tailscale (opens a browser URL)
sudo tailscale up

# 2. Note your Pi's Tailscale IP — you'll need it for GitHub secrets
tailscale ip -4
```

## Web UI

| URL | Description |
|-----|-------------|
| `http://flighttracker.local/tar1090` | Live map |
| `http://flighttracker.local/tar1090/main.html` | Full layout — data grid + telemetry row |
| `http://flighttracker.local/tar1090/main.html?focus` | Focus layout — giant route airports + compact strip |
| `http://flighttracker.local/tar1090/radar.html` | PPI radar — rotating sweep + aircraft cards |

## Auto-deploy

Every push to `main` triggers GitHub Actions which SSHes into the Pi via Tailscale and runs `scripts/deploy.sh`.

### GitHub Secrets

Go to repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret | How to get it |
|--------|---------------|
| `TAILSCALE_OAUTH_CLIENT_ID` | [Tailscale admin](https://login.tailscale.com/admin/settings/oauth) → Generate OAuth client with **Devices: Write** scope and tag `tag:ci` |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Same page as above |
| `PI_TAILSCALE_IP` | Output of `tailscale ip -4` on the Pi |
| `PI_USER` | Your Pi username e.g. `reynard` |
| `DEPLOY_SSH_KEY` | Printed by `install.sh` — full contents of `~/.ssh/deploy_key` on the Pi |

### Tailscale ACL tag

In the Tailscale admin under **Access Controls**, make sure `tag:ci` exists:
```json
"tagOwners": {
  "tag:ci": []
}
```

## E-ink Displays

Two layouts served from a single page (`main.html`), optimised for e-ink panels. Both avoid animations, smooth scrolling, per-second updates, glow effects, and any CSS that causes unnecessary full-panel refreshes.

### main.html — Full Layout

Shows one aircraft at a time with a full header (logo, airline, route, callsign, aircraft type, registration, flag), a 9-field data grid (track, altitude, mach, lat, distance, speed, lon, vertical rate, status), and a 9-field telemetry row (source, signal, squawk, IAS, wind, OAT, nav heading, message count, last seen). Aircraft cycle automatically every 60 seconds.

### main.html?focus — Focus Layout

Designed for larger text and a cleaner read from a distance. The route airports (`FRA ──► DXB`) dominate the centre of the screen as the visual centrepiece. The top strip shows the airline name, callsign, aircraft type name, and — at the same size as the airline name — the ICAO type code, country flag, and tail number. A compact strip of six fields runs along the bottom (altitude, speed, track, vertical rate, status, distance). No telemetry row.

---

### URL Parameters

All parameters work on both layouts and can be freely combined.

#### `?focus`

Switches from the full layout to the focus layout.

```
main.html?focus
```

---

#### `?theme=`

Controls colour scheme. Default is `white`.

| Value | Background | Text | Use case |
|-------|-----------|------|----------|
| `white` | White `#ffffff` | Black `#000000` | Standard e-ink panel (default) |
| `black` | Black `#000000` | White `#ffffff` | Inverted / dark room |
| `color` | Near-black `#050200` | Amber `#FFA040` | Colour e-ink or OLED panels |

```
main.html?theme=black
main.html?focus&theme=color
```

---

#### `?orientation=`

Controls whether the layout stacks horizontally or vertically. Default is `landscape`.

| Value | Layout |
|-------|--------|
| `landscape` | Route airports side by side: `FRA ──► DXB` (default) |
| `portrait` | Route airports stacked vertically: `FRA` / arrow / `DXB`. Data grid switches from 3 columns to 2 columns. |

Use `portrait` when the display is mounted vertically (taller than it is wide), or when `?res=` gives a height greater than the width.

```
main.html?orientation=portrait
main.html?focus&orientation=portrait
```

---

#### `?res=`

Provides the physical pixel dimensions of the e-ink panel so font sizes are computed precisely rather than inferred from the browser viewport. Without this parameter, the pages use fluid `clamp()`-based sizing that adapts to whatever the browser reports — which may be inaccurate on embedded kiosk displays.

Format: `?res=WIDTHxHEIGHT` (lowercase `x`, integer pixels, no spaces).

The shorter of the two dimensions is used as the scale base so the layout works correctly for both landscape and portrait orientations without needing to change the coefficient.

| Panel | Size | Resolution | Parameter |
|-------|------|-----------|-----------|
| Waveshare 4.2" | 4.2 inch | 400 × 300 | `?res=400x300` |
| Waveshare 5.83" | 5.83 inch | 648 × 480 | `?res=648x480` |
| Waveshare 7.5" | 7.5 inch | 800 × 480 | `?res=800x480` |
| Waveshare 9.7" | 9.7 inch | 1200 × 825 | `?res=1200x825` |
| Waveshare 10.3" (portrait) | 10.3 inch | 1404 × 1872 | `?res=1404x1872` |
| Waveshare 13.3" | 13.3 inch | 1600 × 1200 | `?res=1600x1200` |

```
main.html?focus&res=800x480
main.html?focus&orientation=portrait&res=480x800
```

> **Tip:** If your panel resolution is not listed, use whichever standard resolution is closest, or enter your panel's exact spec. The scaling coefficients are defined at the top of `main.js` and can be tuned per-display.

---

#### `?radius=N`

Restricts the display to aircraft within **N kilometres** of the receiver. If no aircraft are currently within range the display falls back to showing all tracked aircraft (so the screen is never blank), and the footer label changes to indicate the fallback.

```
main.html?focus&radius=30
main.html?radius=50
```

---

#### `?closest`

Locks the display to the **single nearest aircraft** at all times. No cycling occurs — every time new data arrives the display updates to whichever aircraft is now closest. Useful when the display is mounted near a runway or spotting point where you always want to see the overhead aircraft.

```
main.html?focus&closest
main.html?closest
```

---

#### `?refresh=N`

Sets how often (in seconds) new data is fetched from the receiver. Minimum 5 seconds, default 10.

Crucially, **the display only re-renders when the aircraft's data has meaningfully changed** — altitude (rounded to 100 ft), speed (rounded to 5 kts), track (rounded to 2°), and vertical rate (rounded to 100 fpm). If nothing significant has shifted between fetches, the screen is left untouched. This is especially important for e-ink panels where every render triggers a full refresh cycle.

| Value | Effect |
|-------|--------|
| `?refresh=10` | Fetch every 10 s (default) |
| `?refresh=30` | Fetch every 30 s — gentler for slow panels |
| `?refresh=5` | Minimum — most responsive |

```
main.html?focus&refresh=30
main.html?closest&refresh=15
```

---

### Combining Parameters

All parameters stack with `&`:

```
main.html?focus&theme=black&orientation=landscape&res=800x480
main.html?focus&theme=white&orientation=portrait&res=480x800
main.html?focus&theme=color&res=1200x825
main.html?theme=black&orientation=portrait&res=1404x1872
main.html?theme=white&res=800x480
main.html?focus&closest&theme=black&res=800x480
main.html?focus&radius=25&closest&theme=white&res=800x480
main.html?radius=50&theme=white&orientation=portrait
main.html?focus&closest&refresh=30&theme=white&res=800x480
main.html?radius=50&refresh=20&theme=black&res=1200x825
```

---

### Data Sources

Both layouts cycle through aircraft sorted by signal strength (strongest first, up to 30 shown). Aircraft data is fetched from tar1090's local `aircraft.json` every 10 seconds by default. Route data (origin, destination, airline name, IATA flight number) is fetched on first sight of a callsign from `api.adsbdb.com`, falling back to the local route proxy. Results are cached for the session so each callsign is only looked up once.

The airline name resolves in order: local `AIRLINES` dictionary in `data.js` → airline name returned by the route API → raw ICAO prefix code.

---

## Radar Display

`radar.html` renders a live plan-position-indicator (PPI) radar with a rotating sweep arm, country outlines, airport markers, and an aircraft card grid.

### URL Parameters

#### `?theme=`

Controls the colour scheme. Default for the radar page is `color`.

| Value | Inspiration | Background | Foreground |
|-------|-------------|-----------|-----------|
| `color` | Classic radar amber | Near-black | Amber `#FFA040` |
| `airbus` | Airbus blue/grey | Near-black | Blue `#7EB3E8` |
| `boeing` | Boeing navy/gold | Near-black | Gold `#C8A84B` |
| `embraer` | Embraer teal | Near-black | Teal `#5FC4B0` |
| `bombardier` | Bombardier red | Near-black | Red `#E87070` |
| `military` | Military green | Near-black | Green `#5EBF5E` |

```
radar.html?theme=airbus
radar.html?theme=military
```

#### `?range=`

Sets the initial radar range. Default: `250`.

| Value | Effect |
|-------|--------|
| `100` | 100 km radius |
| `150` | 150 km radius |
| `200` | 200 km radius |
| `250` | 250 km radius (default) |
| `auto` | Automatically shrinks to fit all visible aircraft |

```
radar.html?range=100
radar.html?range=auto
```

#### `?refresh=N`

Data fetch interval in seconds. Default `2`, minimum `1`.

```
radar.html?refresh=5
```

#### `?radius=N`

Restricts aircraft to within N km of the receiver (same as e-ink pages).

```
radar.html?radius=80
```

#### `?closest`

Locks the display to only the single nearest aircraft.

```
radar.html?closest
```

#### `?sweep=off`

Disables the rotating sweep animation on load. Blips still update on each data fetch.

```
radar.html?sweep=off
```

#### `?units=metric`

Switches altitude (m), speed (km/h), and vertical rate (m/s) to metric. Default is imperial.

```
radar.html?units=metric
```

### Combining Parameters

```
radar.html?theme=military&range=150&units=metric
radar.html?theme=airbus&range=auto&sweep=off
radar.html?theme=color&radius=80&closest&refresh=3
```

---

## Repo Structure

```
piflightboard/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Actions deploy workflow
├── config/
│   ├── lighttpd-tar1090.conf       # lighttpd aliases
│   ├── readsb.conf                 # readsb decoder options
│   ├── route-proxy.service         # systemd service for CORS proxy
│   └── tmpfiles-readsb.conf        # /run/readsb permissions on boot
├── images/
│   ├── airline_logos/              # airline_logo_KLM.png etc.
│   └── country_flags/             # country_flag_NL.png etc.
├── scripts/
│   ├── deploy.sh                   # incremental deploy (called by CI)
│   ├── install.sh                  # one-shot clean install
│   └── route-proxy.py              # CORS proxy for route API
├── www/
│   ├── data.js                     # airline names, ICAO→country, ICAO→IATA, aircraft types
│   ├── main.html                   # single entry point (?focus switches to focus layout)
│   ├── main.js                     # merged JS — full layout + focus layout, FOCUS_MODE flag
│   ├── main.css                    # base styles (both layouts)
│   ├── main-focus.css              # focus layout overrides + hero/route/data-strip classes
│   ├── main-themes.js              # ?theme=, ?orientation=, ?focus → CSS class applier
│   ├── radar.html                  # PPI radar display
│   ├── radar.js                    # radar fetch, RAF loop, canvas draw, cards, menu
│   ├── radar.css                   # radar layout, canvas, cards, burger menu styles
│   ├── radar-themes.js             # radar manufacturer-inspired themes
│   └── radar-geo.js                # receiver coords, country polygons, airport list
└── README.md
```
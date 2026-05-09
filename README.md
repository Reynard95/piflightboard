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
| `http://flighttracker.local/tar1090/flightboard.html` | Full-screen amber CRT departure board |
| `http://flighttracker.local/tar1090/flipboard.html` | Split-flap (Solari) departure board |
| `http://flighttracker.local/tar1090/eink.html` | E-ink display — full layout |
| `http://flighttracker.local/tar1090/eink-focus.html` | E-ink display — focus layout |

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

Two purpose-built pages optimised for e-ink panels. Both avoid animations, smooth scrolling, per-second updates, glow effects, and any CSS that causes unnecessary full-panel refreshes.

### eink.html — Full Layout

Mirrors the information density of `flightboard.html`. Shows one aircraft at a time with a full header (logo, airline, route, callsign, aircraft type, registration, flag), a 9-field data grid (track, altitude, mach, lat, distance, speed, lon, vertical rate, status), and a 9-field telemetry row (source, signal, squawk, IAS, wind, OAT, nav heading, message count, last seen). Aircraft cycle automatically every 60 seconds.

### eink-focus.html — Focus Layout

Designed for larger text and a cleaner read from a distance. The route airports (`FRA ──► DXB`) dominate the centre of the screen as the visual centrepiece. The top strip shows the airline name, callsign, aircraft type name, and — at the same size as the airline name — the ICAO type code, country flag, and tail number. A compact strip of six fields runs along the bottom (altitude, speed, track, vertical rate, status, distance). No telemetry row.

---

### URL Parameters

All parameters work on both `eink.html` and `eink-focus.html` and can be freely combined.

#### `?theme=`

Controls colour scheme. Default is `white`.

| Value | Background | Text | Use case |
|-------|-----------|------|----------|
| `white` | White `#ffffff` | Black `#000000` | Standard e-ink panel (default) |
| `black` | Black `#000000` | White `#ffffff` | Inverted / dark room |
| `color` | Near-black `#050200` | Amber `#FFA040` | Colour e-ink or OLED panels |

```
eink.html?theme=black
eink-focus.html?theme=color
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
eink.html?orientation=portrait
eink-focus.html?orientation=portrait
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
eink-focus.html?res=800x480
eink-focus.html?orientation=portrait&res=480x800
```

> **Tip:** If your panel resolution is not listed, use whichever standard resolution is closest, or enter your panel's exact spec. The scaling coefficients are defined at the top of `eink-focus.js` and `eink.js` and can be tuned per-display.

---

#### `?radius=N`

Restricts the display to aircraft within **N kilometres** of the receiver. If no aircraft are currently within range the display falls back to showing all tracked aircraft (so the screen is never blank), and the footer label changes to indicate the fallback.

```
eink-focus.html?radius=30
eink.html?radius=50
```

---

#### `?closest`

Locks the display to the **single nearest aircraft** at all times. No cycling occurs — every time new data arrives (every 30 s) the display jumps to whichever aircraft is now closest. Useful when the display is mounted near a runway or spotting point where you always want to see the overhead aircraft.

```
eink-focus.html?closest
eink.html?closest
```

---

### Combining Parameters

All parameters stack with `&`:

```
eink-focus.html?theme=black&orientation=landscape&res=800x480
eink-focus.html?theme=white&orientation=portrait&res=480x800
eink-focus.html?theme=color&res=1200x825
eink.html?theme=black&orientation=portrait&res=1404x1872
eink.html?theme=white&res=800x480
eink-focus.html?closest&theme=black&res=800x480
eink-focus.html?radius=25&closest&theme=white&res=800x480
eink.html?radius=50&theme=white&orientation=portrait
```

---

### Data Sources

Both displays cycle through aircraft sorted by signal strength (strongest first, up to 30 shown). Aircraft data is fetched from tar1090's local `aircraft.json` every 30 seconds. Route data (origin, destination, airline name, IATA flight number) is fetched on first sight of a callsign from `api.adsbdb.com`, falling back to the local route proxy. Results are cached for the session so each callsign is only looked up once.

The airline name resolves in order: local `AIRLINES` dictionary in `data.js` → airline name returned by the route API → raw ICAO prefix code.

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
│   ├── flightboard.html/css/js     # amber CRT single-aircraft display
│   ├── flipboard.html/css/js       # split-flap (Solari) departure board
│   ├── themes.js                   # 8 colour themes for flightboard + flipboard
│   ├── eink.html                   # e-ink full layout
│   ├── eink.css                    # e-ink base styles (shared by both e-ink pages)
│   ├── eink.js                     # e-ink full layout logic
│   ├── eink-focus.html             # e-ink focus layout
│   ├── eink-focus.css              # focus layout overrides + hero/route/data-strip classes
│   ├── eink-focus.js               # focus layout logic + ?res= resolution scaling
│   └── eink-themes.js              # shared ?theme= and ?orientation= URL param handler
└── README.md
```
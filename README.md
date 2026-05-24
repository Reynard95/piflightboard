# Flighttracker

ADS-B flight tracker running on a Raspberry Pi Zero 2W with NooElec RTL-SDR v5.

## Hardware
- Raspberry Pi Zero 2W
- NooElec RTL-SDR v5
- 64GB microSD card

## Stack
- **readsb** — ADS-B decoder (built from source)
- **lighttpd** — web server, serves the flight board and proxies `/api/` to the settings API
- **route-proxy** — CORS proxy for route lookups via api.adsb.lol
- **settings-api** — Flask REST API (port 8089) for setup, PIN auth, location, and feeder management
- **Tailscale** — secure remote access for GitHub Actions deploys

## Fresh Install

### Step 1 — Flash the SD card

Download and install **[Raspberry Pi Imager](https://www.raspberrypi.com/software/)** on your computer.

1. Open Raspberry Pi Imager
2. **Choose Device** → Raspberry Pi Zero 2W
3. **Choose OS** → Raspberry Pi OS (other) → **Raspberry Pi OS Lite (64-bit)** — no desktop needed
4. **Choose Storage** → select your microSD card (64 GB recommended)
5. Click **Next**, then when prompted click **Edit Settings** to configure the image before writing:

In the **General** tab:
- Set hostname: e.g. `flighttracker`
- Set username and password (remember these — you'll SSH in with them)
- Tick **Configure wireless LAN** and enter your Wi-Fi SSID and password
- Set locale / timezone

In the **Services** tab:
- Tick **Enable SSH** → Use password authentication

Click **Save**, then **Yes** to apply the settings, then **Yes** to write. Writing takes about 2–3 minutes.

### Step 2 — First boot and SSH in

Insert the SD card into the Pi, connect the RTL-SDR dongle, and power it on. Wait about 60 seconds for it to boot and connect to Wi-Fi.

Find the Pi on your network — try the hostname first:

```bash
ssh YOUR_USERNAME@flighttracker.local
```

If `.local` doesn't resolve, find the IP from your router's DHCP table or use `nmap -sn 192.168.1.0/24` (adjust the subnet). Then SSH directly:

```bash
ssh YOUR_USERNAME@192.168.1.X
```

### Step 3 — Clone the repo and run the install script

Once you're SSH'd in, run these commands **as your regular user** (not root):

```bash
# Update the package list and install git
sudo apt update && sudo apt install -y git

# Clone the repo as your user (NOT sudo — ownership matters for git pull later)
git clone https://github.com/Reynard95/piflightboard.git /opt/flighttracker

# Run the full install script with sudo
cd /opt/flighttracker
sudo bash scripts/install.sh
```

The script runs 11 steps — network wait, stop services, system update, dependencies, repo ownership / Tailscale / SSH key / sudoers, DVB blacklist, udev rules, build readsb, readsb setup, aircraft hex DB, web root / lighttpd / services. It takes roughly 10–15 minutes on a Pi Zero 2W.

**Watch for one pause during the script:**

- **Deploy SSH key** — the script prints the private key to the terminal. Copy the entire block including the `-----BEGIN OPENSSH PRIVATE KEY-----` and `-----END OPENSSH PRIVATE KEY-----` lines. This goes into GitHub secret `DEPLOY_SSH_KEY`.

### Step 4 — Authenticate Tailscale

After the script finishes, authenticate Tailscale:

```bash
sudo tailscale up
```

Tailscale will print a URL like `https://login.tailscale.com/a/...`. Open it in a browser logged into your Tailscale account and click **Approve**. The Pi will show as connected in the [Tailscale admin panel](https://login.tailscale.com/admin/machines).

Then note the Pi's Tailscale IP — you'll need it for GitHub:

```bash
tailscale ip -4
```

### Step 5 — Configure via the setup page

Open a browser and go to:

```
http://flighttracker.local/setup.html
```

The setup wizard will walk you through:
1. **PIN** — set a PIN to protect the setup page
2. **Location** — enter the receiver's latitude and longitude (used to calculate aircraft distances)
3. **Feeders** — optionally install Flightradar24 and/or FlightAware/PiAware to share data and unlock free premium accounts

You can return to `setup.html` at any time to change settings, manage feeders, and check service status.

### Step 6 — Add GitHub secrets and enable auto-deploy

In your GitHub repo go to **Settings → Secrets and variables → Actions → New repository secret** and add each of the following:

| Secret | How to get it |
|--------|---------------|
| `TAILSCALE_AUTHKEY` | Tailscale admin → Settings → Keys → Generate auth key (reusable, tag: `tag:ci`) |
| `PI_TAILSCALE_IP` | Output of `tailscale ip -4` on the Pi (Step 4) |
| `PI_USER` | Your Pi username e.g. `pi` |
| `DEPLOY_SSH_KEY` | Printed by `install.sh` — copy the full private key block (Step 3) |

Once all four secrets are set, every push to `main` triggers GitHub Actions which SSHes into the Pi via Tailscale and runs `scripts/deploy.sh` automatically.

#### Tailscale auth key setup

Before generating the key, the `tag:ci` tag must exist in your ACL. In [Tailscale admin → Access Controls](https://login.tailscale.com/admin/acls), add the following and click **Save**:

```json
"tagOwners": {
  "tag:ci": []
}
```

Then go to [Tailscale admin → Settings → Keys](https://login.tailscale.com/admin/settings/keys), click **Generate auth key**, tick **Reusable**, and add tag `tag:ci`. Copy the key into the `TAILSCALE_AUTHKEY` secret.

---

## Auto-reinstall

The `VERSION` file controls the stack version. When `deploy.sh` runs and detects that the repo `VERSION` doesn't match the installed version stamp (`.installed-version`), it triggers a full background reinstall:

```
git push (VERSION bump) → Actions → git pull → deploy.sh detects mismatch
  → systemctl start flightboard-reinstall
  → scripts/reset.sh --force (removes all services, configs, web files)
  → scripts/install.sh (full clean install)
  → VERSION stamp updated
```

Watch reinstall progress:
```bash
tail -f /opt/flighttracker/reinstall.log
# or
sudo journalctl -u flightboard-reinstall -f
```

To manually reset the Pi back to stock (without reflashing):
```bash
sudo bash /opt/flighttracker/scripts/reset.sh
```

---

## Web UI

| URL | Description |
|-----|-------------|
| `http://flighttracker.local/` | Flight board — full layout (data grid + telemetry) |
| `http://flighttracker.local/main.html?focus` | Focus layout — giant route airports + compact strip |
| `http://flighttracker.local/radar.html` | PPI radar — rotating sweep + aircraft cards |
| `http://flighttracker.local/vitals.html` | System vitals — CPU, temperature, memory, disk, network |
| `http://flighttracker.local/setup.html` | Setup and settings page (PIN protected) |

## E-ink Displays

Two layouts served from `main.html`, optimised for e-ink panels. Both avoid animations, smooth scrolling, per-second updates, glow effects, and any CSS that causes unnecessary full-panel refreshes.

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

```
main.html?orientation=portrait
main.html?focus&orientation=portrait
```

---

#### `?res=`

Provides the physical pixel dimensions of the e-ink panel so font sizes are computed precisely. Format: `?res=WIDTHxHEIGHT`.

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

---

#### `?radius=N`

Restricts the display to aircraft within **N kilometres** of the receiver.

```
main.html?focus&radius=30
```

---

#### `?closest`

Locks the display to the **single nearest aircraft** at all times.

```
main.html?focus&closest
```

---

#### `?refresh=N`

Sets how often (in seconds) new data is fetched. Minimum 5 seconds, default 10. The display only re-renders when the aircraft's data has meaningfully changed (altitude rounded to 100 ft, speed to 5 kts, track to 2°, vertical rate to 100 fpm).

```
main.html?focus&refresh=30
```

---

### Combining Parameters

```
main.html?focus&theme=black&orientation=landscape&res=800x480
main.html?focus&theme=white&orientation=portrait&res=480x800
main.html?focus&closest&theme=black&res=800x480
main.html?focus&radius=25&closest&theme=white&res=800x480
main.html?focus&closest&refresh=30&theme=white&res=800x480
```

---

### Data Sources

Aircraft data is fetched directly from readsb at `/data/aircraft.json` (updated ~1 s). Route data (origin, destination, airline name, IATA flight number) is fetched on first sight of a callsign from `api.adsbdb.com`, falling back to the local route proxy (`route-proxy.py`) which proxies `api.adsb.lol`. Results are cached per session.

The airline name resolves in order: local `AIRLINES` dictionary in `data.js` → airline name from the route API → raw ICAO prefix code.

---

## Radar Display

`radar.html` renders a live PPI (plan-position-indicator) radar. Features:

- Rotating CSS sweep arm with phosphor persistence — aircraft blips flash bright as the sweep passes and fade until it returns
- CRT scanline overlay for a retro screen look
- Country outlines and airport markers on the canvas
- Aircraft panel — switchable between tile (card) and compact list view
- Click any blip on the canvas to select it and scroll its card into view
- All settings are saved back to the URL so bookmarks remember your configuration

---

### Radar URL Parameters

All parameters can also be changed live from the **☰ MENU** overlay — changes persist to the URL automatically.

#### `?theme=`

Sets the colour scheme. Default: `color`.

| Value | Colour | Inspired by |
|-------|--------|-------------|
| `color` | Amber `#FFA040` on near-black | Generic phosphor CRT (default) |
| `airbus` | Steel blue `#7EB3E8` on dark navy | Airbus EFIS displays |
| `boeing` | Gold `#C8A84B` on dark brown | Boeing 7-series flight decks |
| `embraer` | Teal `#5FC4B0` on dark green-black | Embraer E-Jet cockpits |
| `bombardier` | Coral red `#E87070` on near-black | Bombardier CRJ / Global avionics |
| `military` | Radar green `#5EBF5E` on near-black | Classic military PPI radar |

```
radar.html?theme=military
radar.html?theme=airbus
```

---

#### `?range=`

Sets the radar display radius. Default: `250`.

| Value | Description |
|-------|-------------|
| `100` | 100 km radius |
| `150` | 150 km radius |
| `200` | 200 km radius |
| `250` | 250 km radius (default) |
| `auto` | Automatically expands to fit the furthest aircraft |

```
radar.html?range=100
radar.html?range=auto
```

---

#### `?refresh=N`

How often aircraft data is fetched, in seconds. Minimum 1, default `5`.

```
radar.html?refresh=10
```

---

#### `?radius=N`

Restricts the aircraft list (and canvas blips) to those within **N kilometres** of the receiver. If all aircraft are outside the radius the filter is relaxed so the display is never empty.

```
radar.html?radius=100
```

---

#### `?closest`

Shows only the **single nearest aircraft** at all times.

```
radar.html?closest
```

---

#### `?sweep=off`

Disables the rotating sweep animation on load.

```
radar.html?sweep=off
```

---

#### `?units=metric`

Starts in **metric** mode — altitudes in metres, speeds in km/h, vertical rate in m/s. Default is imperial (ft, kt, fpm).

```
radar.html?units=metric
```

---

#### `?square`

Switches to a **stacked layout** — radar canvas fills the full screen with no aircraft panel. Designed for square or near-square screens (e.g. 1:1 monitors, tablets in portrait).

```
radar.html?square
radar.html?square&theme=military
```

---

### Combining Radar Parameters

```
radar.html?theme=military&range=150&units=metric
radar.html?theme=airbus&range=auto&refresh=10&radius=200
radar.html?square&theme=color&sweep=off
radar.html?closest&theme=boeing&units=metric
```

---

## Repo Structure

```
piflightboard/
├── .github/
│   └── workflows/
│       └── deploy.yml                  # GitHub Actions deploy workflow
├── config/
│   ├── auto-reinstall.service          # systemd oneshot — reset + reinstall on version bump
│   ├── lighttpd-flightboard.conf       # lighttpd: document-root, /data/, /db/, /api/ proxy
│   ├── readsb.conf                     # readsb decoder options (lat/lon set via setup page)
│   ├── route-proxy.service             # systemd service for CORS proxy
│   ├── settings-api.service            # systemd service for settings API
│   └── tmpfiles-readsb.conf            # /run/readsb permissions on boot
├── images/
│   ├── airline_logos/                  # airline_logo_KLM.png etc.
│   └── country_flags/                  # country_flag_NL.png etc.
├── scripts/
│   ├── auto-reinstall.sh               # called by auto-reinstall.service
│   ├── deploy.sh                       # incremental deploy (called by CI)
│   ├── install.sh                      # one-shot clean install
│   ├── reset.sh                        # undo install.sh (returns Pi to stock OS)
│   ├── route-proxy.py                  # CORS proxy for route API
│   └── settings-api.py                 # Flask settings API on port 8089
├── www/
│   ├── data.js                         # airline names, ICAO→country, ICAO→IATA, aircraft types
│   ├── main.html                       # single entry point (?focus switches to focus layout)
│   ├── main.js                         # merged JS — full layout + focus layout
│   ├── main.css                        # base styles (both layouts)
│   ├── main-focus.css                  # focus layout overrides
│   ├── main-themes.js                  # ?theme=, ?orientation=, ?focus → CSS class applier
│   ├── radar.html                      # PPI radar display
│   ├── radar.js                        # radar fetch, RAF loop, canvas draw, cards, menu
│   ├── radar.css                       # radar layout, canvas, cards, burger menu styles
│   ├── radar-themes.js                 # radar manufacturer-inspired themes
│   ├── radar-geo.js                    # receiver coords, country polygons, airport list
│   ├── setup.html                      # setup wizard + settings panel
│   ├── setup.js                        # setup page logic (PIN auth, wizard, settings)
│   └── setup.css                       # setup page styles
└── README.md
```

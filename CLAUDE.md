# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

There is no build step. All files in `www/` are static HTML/CSS/JS deployed directly to the Pi.

**Normal workflow:** push to `main` → GitHub Actions SSHes into the Pi via Tailscale → runs `git pull` + `scripts/deploy.sh`. The deploy script copies `www/*` to `/var/www/flightboard`, installs the lighttpd config, reloads lighttpd, and restarts the route proxy if its files changed.

**Manual deploy on the Pi:**
```bash
cd /opt/flighttracker
git pull origin main
bash scripts/deploy.sh
```

**Check service status on the Pi:**
```bash
sudo systemctl status readsb
sudo systemctl status lighttpd
sudo systemctl status route-proxy
sudo journalctl -u route-proxy -n 50
```

**lighttpd config validation (before reload):**
```bash
sudo lighttpd -tt -f /etc/lighttpd/lighttpd.conf
```

**Fresh Pi install:** `sudo bash scripts/install.sh` — pauses for Tailscale auth and prints the SSH deploy key. After it completes, run `sudo tailscale up` and add the printed key + Tailscale IP to GitHub secrets.

## Architecture

### Data flow

```
RTL-SDR dongle
    └─► readsb (ADS-B decoder) ──► /run/readsb/aircraft.json   (updated ~1s)
                                                │
                                     lighttpd serves at
                                        /data/aircraft.json
                                                │
                               Browser JS polls every FETCH_MS
                                  (default 10s, URL ?refresh=N)
                                                │
                              for each callsign, route lookup:
                           1. api.adsbdb.com/v0/callsign/{cs}
                           2. route-proxy.py:8088 → api.adsb.lol
                              (CORS proxy, results cached per session)
```

### Web UIs

All pages live in `www/` and are served by lighttpd from `/var/www/flightboard` at the root path.

| Page | Description |
|------|-------------|
| `main.html`        | Single entry point. Default: full layout (data grid + telemetry). `?focus`: focus layout (giant route airports + compact strip). |

### JavaScript

- **`main.js`** — merged JS. `FOCUS_MODE = _fp.has('focus')` dispatches `showIndex()` to either `renderFull()` or `renderFocus()`. Resolution scaling IIFE runs only when `FOCUS_MODE` is true.
- **`data.js`** — lookup tables: `AIRLINES`, `ICAO_TO_COUNTRY`, `ICAO_TO_IATA`, `AC_TYPES`.
- **`main-themes.js`** — IIFE that applies `?theme=` CSS vars, adds `.portrait` for `?orientation=portrait`, and adds `.focus-mode` for `?focus`. Runs before `main.js`.

### CSS layering

`main.html` loads `main.css` then `main-focus.css` always. Conflicting focus overrides (logo size, typecode/reg font, flag height, fade-in gap) are scoped under `html.focus-mode` so they don't affect the full layout. Focus-specific layout classes (`.hero`, `.route-block`, `.data-strip`, etc.) are harmless when the full layout is active — those elements simply don't exist in the DOM. Never put focus-specific styles into `main.css`.

### URL parameter pattern

`const _fp = new URLSearchParams(window.location.search)` at the top of `main.js`.

- `?focus` — switches render path; also handled by `main-themes.js` (adds `.focus-mode` to `<html>`)
- `?theme=` / `?orientation=` — handled entirely by `main-themes.js`
- `?res=WxH` — IIFE in `main.js` (runs only when `FOCUS_MODE`) overrides `--sz-*` CSS tokens; coefficients defined at the top of the IIFE
- `?radius=N` / `?closest` / `?refresh=N` — parsed into `RADIUS_KM`, `CLOSEST_ONLY`, `FETCH_MS`

### Airline name resolution (e-ink pages)

Three-tier fallback, evaluated **after** the route fetch completes:
1. `AIRLINES[icaoCode]` — local `data.js` dictionary
2. `route?.airline?.name` from the route API
3. Raw ICAO prefix code

### Change detection (e-ink only)

`aircraftKey(ac)` returns a coarse string key (callsign + rounded alt/speed/track/vrate). On each data fetch, `fetchAircraft()` compares the current aircraft's key against `lastRenderedKey` and only calls `showIndex()` if it differs. This avoids unnecessary full-panel e-ink refreshes on quiet cruises. `showIndex()` always updates `lastRenderedKey` at entry.

### lighttpd config

`config/lighttpd-flightboard.conf` is installed as `/etc/lighttpd/conf-enabled/50-flightboard.conf`. It is a standalone file that owns everything — no dependency on tar1090 or its config.

It defines:
- `server.document-root` → `/var/www/flightboard` (overrides lighttpd's default `/var/www/html`)
- `/data/` → `/run/readsb/` (live ADS-B feed)
- `/db/` → `/opt/flighttracker/db/` (aircraft hex DB, cloned from wiedehopf/tar1090-db)
- `/airline_logos/` → `images/airline_logos/` in this repo
- `/country_flags/` → `images/country_flags/` in this repo

`config/lighttpd-tar1090.conf` and `config/lighttpd-assets.conf` are kept as deprecated stubs for reference only — neither is installed by deploy.sh or install.sh.

## Key configuration

**Receiver location** — `config/readsb.conf` contains hardcoded `--lat` / `--lon`. Update these to the actual receiver location; `r_dst` (distance-from-receiver) in `aircraft.json` depends on them.

**Route proxy** — runs as `nobody` on port 8088, proxies POST requests to `api.adsb.lol`. The primary route source is `api.adsbdb.com` (direct from browser); the proxy is the fallback.

**GitHub Actions secrets required:** `TAILSCALE_AUTHKEY`, `PI_TAILSCALE_IP`, `PI_USER`, `DEPLOY_SSH_KEY`.

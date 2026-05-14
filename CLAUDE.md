# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Deployment

There is no build step. All files in `www/` are static HTML/CSS/JS deployed directly to the Pi.

**Normal workflow:** push to `main` → GitHub Actions SSHes into the Pi via Tailscale → runs `git pull` + `scripts/deploy.sh`. The deploy script copies `www/*` to `/usr/local/share/tar1090/html`, reloads lighttpd, and restarts the route proxy if its files changed.

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
                                  /tar1090/data/aircraft.json
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

All pages live in `www/` and are served by lighttpd under `/tar1090/`.

| Page | Description |
|------|-------------|
| `eink.html`        | Full layout — logo/header + 9-field data grid + 9-field telemetry |
| `eink-focus.html`  | Focus layout — giant route airports as centrepiece, compact 6-field strip |

### Shared JavaScript modules

- **`data.js`** — lookup tables loaded before any page JS: `AIRLINES` (ICAO→name), `ICAO_TO_COUNTRY` (for flag images), `ICAO_TO_IATA` (for IATA flight number derivation), `AC_TYPES` (type code→full name).
- **`eink-themes.js`** — IIFE that applies `?theme=` CSS variables and adds `.portrait` class for `?orientation=portrait`. Loaded by both pages before their own JS.

### E-ink CSS layering

`eink.html` loads only `eink.css`. `eink-focus.html` loads `eink.css` then `eink-focus.css`. The focus CSS overrides the `--sz-*` size tokens and adds the hero layout classes (`.hero`, `.hero-top`, `.hero-identity`, `.hero-meta`, `.route-block`, `.route-endpoint`, `.data-strip`, `.ds-cell`). Never put focus-specific styles into `eink.css`.

### URL parameter pattern

Parameters are parsed at the top of each JS file via a `const _fp = new URLSearchParams(window.location.search)` block. The e-ink files support:

- `?theme=` / `?orientation=` — handled entirely by `eink-themes.js`
- `?res=WxH` — IIFE at the top of `eink-focus.js` overrides `--sz-*` CSS custom properties; coefficients are defined at the top of the IIFE
- `?radius=N` / `?closest` / `?refresh=N` — parsed into `RADIUS_KM`, `CLOSEST_ONLY`, `FETCH_MS` constants

### Airline name resolution (e-ink pages)

Three-tier fallback, evaluated **after** the route fetch completes:
1. `AIRLINES[icaoCode]` — local `data.js` dictionary
2. `route?.airline?.name` from the route API
3. Raw ICAO prefix code

### Change detection (e-ink only)

`aircraftKey(ac)` returns a coarse string key (callsign + rounded alt/speed/track/vrate). On each data fetch, `fetchAircraft()` compares the current aircraft's key against `lastRenderedKey` and only calls `showIndex()` if it differs. This avoids unnecessary full-panel e-ink refreshes on quiet cruises. `showIndex()` always updates `lastRenderedKey` at entry.

### lighttpd aliases

Defined in `config/lighttpd-tar1090.conf` (installed as `tar1090.conf`):
- `/tar1090/data/` → `/run/readsb/` (live ADS-B JSON)
- `/tar1090/db-28a5940/` → tar1090's aircraft database (hex → reg/type)
- `/tar1090/airline_logos/` and `/tar1090/country_flags/` → `images/` in this repo
- `/tar1090` → `/usr/local/share/tar1090/html` (all web files)

`config/lighttpd-assets.conf` is intentionally a comments-only file — the image aliases are already in the tar1090 system config and duplicating them causes lighttpd to crash with duplicate-key errors.

## Key configuration

**Receiver location** — `config/readsb.conf` contains hardcoded `--lat` / `--lon`. Update these to the actual receiver location; `r_dst` (distance-from-receiver) in `aircraft.json` depends on them.

**Route proxy** — runs as `nobody` on port 8088, proxies POST requests to `api.adsb.lol`. The primary route source is `api.adsbdb.com` (direct from browser); the proxy is the fallback.

**GitHub Actions secrets required:** `TAILSCALE_AUTHKEY`, `PI_TAILSCALE_IP`, `PI_USER`, `DEPLOY_SSH_KEY`.

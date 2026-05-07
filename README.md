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

## Fresh Install

On a clean Raspberry Pi OS Lite (64-bit):

```bash
# Clone the repo
sudo git clone https://github.com/YOUR_USERNAME/flighttracker.git /opt/flighttracker

# Run the install script
cd /opt/flighttracker
sudo bash scripts/install.sh
```

## Web UI

| URL | Description |
|-----|-------------|
| `http://flighttracker.local/tar1090` | Live map |
| `http://flighttracker.local/tar1090/flightboard.html` | Full-screen display board |

## Auto-deploy

Every push to `main` triggers GitHub Actions which SSHes into the Pi via Tailscale and runs `scripts/deploy.sh`.

### GitHub Secrets required

| Secret | Value |
|--------|-------|
| `TAILSCALE_OAUTH_CLIENT_ID` | Tailscale OAuth client ID |
| `TAILSCALE_OAUTH_CLIENT_SECRET` | Tailscale OAuth client secret |
| `PI_TAILSCALE_IP` | Pi's Tailscale IP (from `tailscale ip -4`) |
| `PI_USER` | Pi SSH username (e.g. `reynard`) |
| `DEPLOY_SSH_KEY` | Private key from `~/.ssh/deploy_key` |

## Repo Structure

```
flighttracker/
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions deploy workflow
├── www/
│   └── flightboard.html      # Full-screen display board
├── config/
│   ├── readsb.conf           # readsb options
│   ├── lighttpd-tar1090.conf # lighttpd aliases
│   ├── tmpfiles-readsb.conf  # /run/readsb permissions
│   └── route-proxy.service   # systemd service for CORS proxy
├── scripts/
│   ├── install.sh            # One-shot clean install
│   ├── deploy.sh             # Incremental deploy (called by CI)
│   └── route-proxy.py        # CORS proxy for route API
└── README.md
```

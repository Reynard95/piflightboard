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
| `http://flighttracker.local/tar1090/flightboard.html` | Full-screen display board |

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

## Repo Structure

```
piflightboard/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions deploy workflow
├── config/
│   ├── lighttpd-tar1090.conf   # lighttpd aliases
│   ├── readsb.conf             # readsb decoder options
│   ├── route-proxy.service     # systemd service for CORS proxy
│   └── tmpfiles-readsb.conf    # /run/readsb permissions on boot
├── images/
│   ├── airline_logos/          # airline_logo_KLM.png etc.
│   └── country_flags/          # country_flag_NL.png etc.
├── scripts/
│   ├── deploy.sh               # incremental deploy (called by CI)
│   ├── install.sh              # one-shot clean install
│   └── route-proxy.py          # CORS proxy for route API
├── www/
│   └── flightboard.html        # full-screen display board
└── README.md
```
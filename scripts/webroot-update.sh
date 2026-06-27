#!/bin/bash
# webroot-update.sh — copies staged web files into /var/www/flightboard as root.
# Must be called via sudo from deploy.sh. Arg 1 = staging directory path.
# Also patches lighttpd.conf document-root if it still points at /var/www/html.
set -e

STAGE_DIR="${1:?Usage: sudo webroot-update.sh <staging-dir>}"
WEB_DIR="/var/www/flightboard"

[ -d "$STAGE_DIR" ] || { echo "ERROR: staging dir $STAGE_DIR not found"; exit 1; }

mkdir -p "$WEB_DIR"
find "$WEB_DIR" -mindepth 1 -delete 2>/dev/null || true
cp -r "$STAGE_DIR/." "$WEB_DIR/"
chmod -R a+rX "$WEB_DIR"

# Patch lighttpd.conf document-root if it still points elsewhere.
# lighttpd rejects duplicate server.document-root, so it can only be set in
# the main conf — not in a conf-enabled drop-in. We only patch when needed.
if [ -f /etc/lighttpd/lighttpd.conf ] && \
   ! grep -q 'server\.document-root.*flightboard' /etc/lighttpd/lighttpd.conf; then
  sed -i 's|^\s*server\.document-root\s*=.*|server.document-root = "/var/www/flightboard"|' \
    /etc/lighttpd/lighttpd.conf
  echo "[webroot-update] Patched lighttpd.conf document-root → /var/www/flightboard"
fi

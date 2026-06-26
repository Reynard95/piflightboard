#!/usr/bin/env python3
# route-proxy.py — normalising proxy for adsb.lol route API
# Accepts GET /?callsign=KLM641  or  POST {"callsign":"KLM641"}
# Returns flat JSON: {"ok":true,"origin":"AMS","destination":"LHR","origin_city":"Amsterdam","dest_city":"London","airline":"KLM Royal Dutch Airlines"}
# Test: curl "http://localhost:8088/?callsign=KLM641"

from http.server import HTTPServer, BaseHTTPRequestHandler
import urllib.request
import json
from urllib.parse import urlparse, parse_qs

UPSTREAM = 'https://api.adsb.lol/api/0/routeset'

class ProxyHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        qs = parse_qs(urlparse(self.path).query)
        callsign = (qs.get('callsign') or [''])[0].strip()
        self._respond(callsign)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)
        callsign = ''
        try:
            data = json.loads(body)
            callsign = data.get('callsign', '').strip()
        except Exception:
            pass
        self._respond(callsign)

    def _respond(self, callsign):
        if not callsign:
            self._json({'ok': False, 'error': 'missing callsign'})
            return
        try:
            payload = json.dumps({'callsign': callsign, 'lat': 0, 'lng': 0, 'postime': 0}).encode()
            req = urllib.request.Request(UPSTREAM, data=payload,
                                         headers={'Content-Type': 'application/json'})
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw = json.loads(resp.read())

            # adsb.lol: {"route":[{origin:{iata,municipality},destination:{iata,municipality},airline:{name}}]}
            routes = raw.get('route') or []
            r = routes[0] if routes else None

            if not r:
                self._json({'ok': False})
                return

            origin  = r.get('origin')      or {}
            dest    = r.get('destination') or {}
            airline = r.get('airline')     or {}

            self._json({
                'ok':          True,
                'origin':      origin.get('iata')  or origin.get('iata_code')  or '?',
                'destination': dest.get('iata')    or dest.get('iata_code')    or '?',
                'origin_city': origin.get('municipality') or '',
                'dest_city':   dest.get('municipality')   or '',
                'airline':     airline.get('name')        or '',
            })
        except Exception as e:
            self._json({'ok': False, 'error': str(e)})

    def _json(self, data):
        body = json.dumps(data).encode()
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args): pass

HTTPServer(('0.0.0.0', 8088), ProxyHandler).serve_forever()

'use strict';

const { app, BrowserWindow, Menu } = require('electron');
const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');
const url   = require('url');

/* ── Config ── */

const config  = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const PI_URL  = (config.piUrl || 'http://raspberrypi.local').replace(/\/$/, '');
const PORT    = config.port || 7473;
const PARAMS  = config.initialParams || '?theme=color';

const WWW = app.isPackaged
  ? path.join(process.resourcesPath, 'www')
  : path.join(__dirname, '..', 'www');

/* ── MIME types ── */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.gif':  'image/gif',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff':  'font/woff',
};

/* ── Proxy paths that go to the Pi ── */

const PROXY_PREFIXES = ['/data/', '/db/', '/airline_logos/', '/country_flags/'];

function proxyToPi(req, res) {
  const piBase  = new URL(PI_URL);
  const target  = new URL(req.url, PI_URL);
  const useHttps = piBase.protocol === 'https:';
  const lib      = useHttps ? https : http;

  const options = {
    hostname: target.hostname,
    port:     target.port || (useHttps ? 443 : 80),
    path:     target.pathname + target.search,
    method:   req.method,
    headers:  Object.assign({}, req.headers, { host: target.host }),
    timeout:  8000,
  };

  const proxyReq = lib.request(options, proxyRes => {
    // Forward CORS headers so the page can read the response
    const headers = Object.assign({}, proxyRes.headers, {
      'access-control-allow-origin': '*',
    });
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res, { end: true });
  });

  proxyReq.on('error', err => {
    console.error('Proxy error:', err.message);
    if (!res.headersSent) res.writeHead(502).end('Proxy error');
  });

  req.pipe(proxyReq, { end: true });
}

/* ── Local file server ── */

function serveFile(reqPath, res) {
  // Default to radar.html
  const normalized = reqPath === '/' ? '/radar.html' : reqPath;
  const filePath   = path.join(WWW, normalized);

  // Block path traversal
  if (!filePath.startsWith(WWW + path.sep) && filePath !== WWW) {
    res.writeHead(403).end();
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404).end('Not found');
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
}

/* ── HTTP server ── */

const server = http.createServer((req, res) => {
  const reqPath = url.parse(req.url).pathname;

  if (PROXY_PREFIXES.some(p => reqPath.startsWith(p))) {
    proxyToPi(req, res);
  } else {
    serveFile(reqPath, res);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Serving http://127.0.0.1:${PORT}  →  Pi: ${PI_URL}`);
});

/* ── Electron window ── */

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width:  1400,
    height:  840,
    minWidth:  800,
    minHeight: 600,
    title: 'PiFlightBoard Radar',
    backgroundColor: '#0d1a0d',   // phosphor-green bezel visible around rounded screen
    webPreferences: {
      nodeIntegration:  false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(`http://127.0.0.1:${PORT}/radar.html${PARAMS}`);
  win.on('closed', () => { win = null; });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (win === null) createWindow();
});

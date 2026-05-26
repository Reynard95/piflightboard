/**
 * tests/serve.js — minimal static file server for E2E tests
 * Serves www/ at http://localhost:3737
 * Responds 404 to /data/* so pages show "no signal" rather than erroring.
 */
'use strict';

const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT = 3737;
const ROOT = path.join(__dirname, '..', 'www');

const MIME = {
  '.html': 'text/html',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
};

http.createServer((req, res) => {
  // Stub out Pi-specific endpoints so pages fail gracefully
  if (req.url.startsWith('/data/') || req.url.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'stub — no Pi in CI' }));
    return;
  }

  let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
  // Strip query string
  filePath = filePath.split('?')[0];

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404); res.end('Not found');
    return;
  }

  const ext  = path.extname(filePath);
  const mime = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}).listen(PORT, () => {
  console.log(`[serve] http://localhost:${PORT}  (root: ${ROOT})`);
});

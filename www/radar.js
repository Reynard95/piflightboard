/* radar.js — PPI radar main logic
 * Depends on: data.js, radar-themes.js, radar-geo.js (all loaded before this)
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   URL PARAMETERS
   ══════════════════════════════════════════════════════════ */

const _fp = new URLSearchParams(location.search);

const RANGE_OPTS   = [100, 150, 200, 250];
let   rangeMode    = _fp.get('range') || '250';   // '100'|'150'|'200'|'250'|'auto'
let   rangeKm      = rangeMode === 'auto' ? 250 : (parseInt(rangeMode, 10) || 250);
const FETCH_MS     = Math.max(1000, (_fp.get('refresh') ? parseFloat(_fp.get('refresh')) : 5) * 1000);
const RADIUS_KM    = _fp.has('radius') ? parseFloat(_fp.get('radius')) : null;
const CLOSEST_ONLY = _fp.has('closest');
const SQUARE_LAYOUT = _fp.has('square');
let   sweepEnabled  = _fp.get('sweep') !== 'off';
let   metricUnits   = _fp.get('units') === 'metric';

if (SQUARE_LAYOUT) document.body.classList.add('square-layout');

/* ══════════════════════════════════════════════════════════
   CANVAS SETUP
   ══════════════════════════════════════════════════════════ */

const canvas = document.getElementById('radar-canvas');
const ctx    = canvas.getContext('2d');
const shell  = document.getElementById('radar-left');

function sizeCanvas() {
  const footer  = document.querySelector('.radar-footer');
  const footerH = footer ? footer.offsetHeight : 40;
  const isNarrow = window.innerWidth < 700;
  let available;
  if (SQUARE_LAYOUT) {
    // Square mode: canvas = min(full width, 58% of viewport height)
    // radar-left width is 100% (CSS handles it); don't constrain via JS
    available = Math.min(window.innerWidth, Math.floor(window.innerHeight * 0.58) - footerH);
    shell.style.width = '';
  } else if (isNarrow) {
    // Stacked: canvas takes ~55% of vh
    available = Math.min(window.innerWidth, Math.floor(window.innerHeight * 0.55) - footerH);
    shell.style.width = Math.max(220, available) + 'px';
  } else {
    // Side-by-side: canvas up to 60% of width, full height minus footer
    available = Math.min(
      Math.floor(window.innerWidth * 0.60),
      window.innerHeight - footerH
    );
    shell.style.width = Math.max(220, available) + 'px';
  }
  const sz = Math.max(220, available);
  canvas.width  = sz;
  canvas.height = sz;
}

sizeCanvas();
window.addEventListener('resize', () => { sizeCanvas(); drawFrame(); });

/* ── Canvas click: select nearest blip, highlight its card ── */
canvas.addEventListener('click', e => {
  const rect  = canvas.getBoundingClientRect();
  const mx    = (e.clientX - rect.left) * (canvas.width  / rect.width);
  const my    = (e.clientY - rect.top)  * (canvas.height / rect.height);
  const W     = canvas.width;
  const cx    = W / 2, cy = W / 2;
  const R     = W * 0.43;

  let best = null, bestDist = 22; // px hit-radius
  aircraft.forEach(ac => {
    if (!ac.lat || !ac.lon) return;
    const [x, y] = geoToXY(ac.lat, ac.lon, cx, cy, R, rangeKm);
    const d = Math.hypot(mx - x, my - y);
    if (d < bestDist) { bestDist = d; best = ac; }
  });

  if (best) {
    selectedHex = best.hex === selectedHex ? null : best.hex;
    renderCards();
    if (selectedHex) {
      const card = document.querySelector(`.ac-card[data-hex="${CSS.escape(selectedHex)}"]`);
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }
});

/* ══════════════════════════════════════════════════════════
   SWEEP ANIMATION
   ══════════════════════════════════════════════════════════ */

const SWEEP_RADS_PER_MS = (2 * Math.PI * 20) / 60000; // 20 RPM
let sweepAngle = -Math.PI / 2; // start at north
let lastTs     = 0;

/* ══════════════════════════════════════════════════════════
   UNIT HELPERS
   ══════════════════════════════════════════════════════════ */

function fmtAlt(ft) {
  if (ft === 'ground' || ft === undefined || ft === null) return 'GND';
  if (metricUnits) return Math.round(ft * 0.3048) + ' M';
  return Number(ft).toLocaleString() + ' FT';
}

function fmtSpd(kt) {
  if (kt === undefined || kt === null) return '—';
  if (metricUnits) return Math.round(kt * 1.852) + ' KM/H';
  return kt + ' KT';
}

function fmtVs(fpm) {
  if (fpm === undefined || fpm === null || fpm === 0) return '±0' + (metricUnits ? ' M/S' : ' FPM');
  const sign = fpm > 0 ? '+' : '';
  if (metricUnits) return sign + (fpm * 0.00508).toFixed(1) + ' M/S';
  return sign + Number(fpm).toLocaleString() + ' FPM';
}

function distKm(ac) {
  if (ac.lat && ac.lon) {
    const dx = (ac.lon - RECEIVER.lon) * KM_PER_LON;
    const dy = (ac.lat - RECEIVER.lat) * KM_PER_LAT;
    return Math.sqrt(dx * dx + dy * dy);
  }
  return ac.r_dst ? ac.r_dst * 1.852 : 9999;
}

/* ══════════════════════════════════════════════════════════
   CSS COLOUR HELPERS
   ══════════════════════════════════════════════════════════ */

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
// Cache colours each frame (cheap: only called once per drawFrame)
let fgColor, fgMidColor, fgDimColor, sepColor, landColor, bgColor;
function refreshColors() {
  fgColor    = cssVar('--fg');
  fgMidColor = cssVar('--fg-mid');
  fgDimColor = cssVar('--fg-dim');
  sepColor   = cssVar('--sep');
  landColor  = cssVar('--land');
  bgColor    = cssVar('--bg');
}

function blipColor(ac) {
  if (ac.alt_baro === 'ground') return '#4499FF';
  const vr = ac.baro_rate || 0;
  if (vr >  300) return '#33EE55';
  if (vr < -300) return '#FF5555';
  return fgColor;
}

/* ══════════════════════════════════════════════════════════
   AIRCRAFT DATA
   ══════════════════════════════════════════════════════════ */

let aircraft    = [];      // current filtered list
let selectedHex = null;

const posHistory = new Map(); // hex → [{ lat, lon, ts }, ...]

function updateHistory(ac) {
  if (!ac.lat || !ac.lon) return;
  const h = posHistory.get(ac.hex) || [];
  h.push({ lat: ac.lat, lon: ac.lon, ts: Date.now() });
  if (h.length > 4) h.shift();
  posHistory.set(ac.hex, h);
}

/* ── Route / airline resolution ── */

const routeCache = {};

const DB_PATH = '/db';

function getAirlineCode(callsign) {
  if (!callsign) return null;
  const cs = callsign.toUpperCase().replace(/[0-9]/g, '').trim();
  return cs || null;
}

async function lookupHex(hex) {
  if (!hex) return null;
  const prefixes = [hex.slice(0,3), hex.slice(0,2), hex.slice(0,1)];
  for (const p of prefixes) {
    try {
      const r = await fetch(`${DB_PATH}/${p}.js`);
      if (!r.ok) continue;
      const data = await r.json();
      const key  = hex.slice(p.length);
      if (data[key]) return data[key];
    } catch (_) { /* ignore */ }
  }
  return null;
}

async function fetchRoute(callsign) {
  if (!callsign) return null;
  const cs = callsign.trim().toUpperCase();
  if (routeCache[cs] !== undefined) return routeCache[cs];
  routeCache[cs] = null; // mark in-flight
  try {
    const r = await fetch(`https://api.adsbdb.com/v0/callsign/${cs}`);
    if (r.ok) {
      const j = await r.json();
      const route = j?.response?.flightroute;
      if (route) { routeCache[cs] = route; return route; }
    }
  } catch (_) { /* primary failed */ }
  try {
    const r2 = await fetch('http://localhost:8088/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ callsign: cs }),
    });
    if (r2.ok) {
      const j2 = await r2.json();
      const route2 = j2?.response?.flightroute;
      if (route2) { routeCache[cs] = route2; return route2; }
    }
  } catch (_) { /* proxy also failed */ }
  routeCache[cs] = null;
  return null;
}

// Per-hex enrichment cache (reg, type, airline, route)
const acCache = {}; // hex → { reg, type, desc, airline, orig, dest }

async function enrichAircraft(ac) {
  const hex = ac.hex;
  if (acCache[hex]) {
    Object.assign(ac, acCache[hex]);
    return;
  }
  acCache[hex] = {};
  // Hex DB lookup
  const db = await lookupHex(hex);
  if (db) {
    acCache[hex].reg  = db.r || db.reg;
    acCache[hex].type = db.t || db.type;
    acCache[hex].desc = db.d || db.desc;
  }
  // Route lookup
  const cs = ac.flight ? ac.flight.trim() : null;
  if (cs) {
    const route = await fetchRoute(cs);
    if (route) {
      const icao = getAirlineCode(cs);
      acCache[hex].airline = AIRLINES[icao] || route?.airline?.name || icao || '';
      acCache[hex].orig    = route?.origin?.iata_code || route?.origin?.icao_code || null;
      acCache[hex].dest    = route?.destination?.iata_code || route?.destination?.icao_code || null;
    } else {
      const icao = getAirlineCode(cs);
      acCache[hex].airline = AIRLINES[icao] || icao || '';
    }
  }
  Object.assign(ac, acCache[hex]);
}

/* ── Main data fetch ── */

async function fetchAircraft() {
  try {
    const r = await fetch('/data/aircraft.json?_=' + Date.now());
    if (!r.ok) return;
    const data = await r.json();
    let list = (data.aircraft || []).filter(a => a.lat && a.lon);

    // Always compute distance — used for sorting and card display
    list = list.map(a => ({ ...a, _dist: distKm(a) }));

    // Radius filter
    if (RADIUS_KM) {
      const full = list.filter(a => a._dist <= RADIUS_KM);
      list = full.length ? full : list; // fallback if empty
    }

    // Always sort nearest-first
    list.sort((a, b) => (a._dist || 9999) - (b._dist || 9999));

    // Closest-only mode
    if (CLOSEST_ONLY) {
      list = list.slice(0, 1);
    }

    aircraft = list;

    // Update position history
    aircraft.forEach(updateHistory);

    // Auto-range
    if (rangeMode === 'auto') {
      const maxD = aircraft.reduce((m, a) => Math.max(m, distKm(a)), 0);
      rangeKm = RANGE_OPTS.find(r => r >= maxD) || 250;
    }

    // Trigger enrichment (fire and forget per ac)
    aircraft.forEach(ac => enrichAircraft(ac));

    // Render cards
    renderCards();
    updateStats();
  } catch (_) { /* ignore fetch errors */ }
}

/* ══════════════════════════════════════════════════════════
   CANVAS DRAW FUNCTIONS
   ══════════════════════════════════════════════════════════ */

function drawBase() {
  const W  = canvas.width;
  const cx = W / 2, cy = W / 2;
  const R  = W * 0.43;
  const RI = R + 2;
  const RO = R + 8;

  // Clip circle
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();

  // Land fills
  ctx.fillStyle = landColor;
  GEO_POLYGONS.forEach(poly => {
    ctx.beginPath();
    poly.forEach(([lat, lon], i) => {
      const [x, y] = geoToXY(lat, lon, cx, cy, R, rangeKm);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  });

  // Country outlines
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = fgDimColor;
  ctx.lineWidth   = 1.0;
  GEO_POLYGONS.forEach(poly => {
    ctx.beginPath();
    poly.forEach(([lat, lon], i) => {
      const [x, y] = geoToXY(lat, lon, cx, cy, R, rangeKm);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  });
  ctx.globalAlpha = 1;

  // Fine grid
  ctx.strokeStyle = fgColor;
  ctx.globalAlpha = 0.12;
  ctx.lineWidth   = 0.5;
  const step = R / 5;
  for (let x = cx % step; x < W; x += step) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, W); ctx.stroke();
  }
  for (let y = cy % step; y < W; y += step) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  ctx.restore(); // remove clip

  // Compass spokes (before range rings so rings are on top)
  ctx.globalAlpha = 0.06;
  ctx.strokeStyle = fgColor;
  ctx.lineWidth   = 1;
  for (let deg = 0; deg < 360; deg += 30) {
    const rad = (deg - 90) * Math.PI / 180;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(rad) * R, cy + Math.sin(rad) * R);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Range rings + labels
  ctx.strokeStyle = fgDimColor;
  ctx.lineWidth   = 0.6;
  ctx.globalAlpha = 0.55;
  for (let i = 1; i <= 5; i++) {
    const rr = R * (i / 5);
    ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 2 * Math.PI); ctx.stroke();
    // label
    const labelKm = Math.round(rangeKm * i / 5);
    ctx.save();
    ctx.globalAlpha = 0.65;
    ctx.font        = '9px monospace';
    ctx.fillStyle   = fgDimColor;
    ctx.textAlign   = 'center';
    ctx.fillText(labelKm + ' KM', cx, cy - rr + 12);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Radar circle border
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI);
  ctx.strokeStyle = fgDimColor; ctx.lineWidth = 1.5; ctx.stroke();

  // Compass labels inside circle
  const lblOffset = R - 14;
  const COMPASS_LABELS = [
    { label: 'N', deg:   0 },
    { label: 'E', deg:  90 },
    { label: 'S', deg: 180 },
    { label: 'W', deg: 270 },
  ];
  ctx.font = 'bold 11px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  COMPASS_LABELS.forEach(({ label, deg }) => {
    const rad = (deg - 90) * Math.PI / 180;
    ctx.fillStyle = fgDimColor;
    ctx.fillText(label, cx + Math.cos(rad) * lblOffset, cy + Math.sin(rad) * lblOffset);
  });

  // North arrow
  drawNorthArrow(cx, cy, R);

  // Airport markers
  const airportsInRange = GEO_AIRPORTS.filter(ap => {
    const dx = (ap.lon - RECEIVER.lon) * KM_PER_LON;
    const dy = (ap.lat - RECEIVER.lat) * KM_PER_LAT;
    return Math.sqrt(dx * dx + dy * dy) <= rangeKm;
  });
  document.getElementById('stat-airports').textContent = airportsInRange.length;

  ctx.strokeStyle = fgDimColor;
  ctx.lineWidth   = 1;
  ctx.font        = '9px monospace';
  ctx.fillStyle   = fgDimColor;
  ctx.textAlign   = 'center';
  ctx.textBaseline = 'top';
  airportsInRange.forEach(ap => {
    const [x, y] = geoToXY(ap.lat, ap.lon, cx, cy, R, rangeKm);
    if (x < 0 || x > W || y < 0 || y > W) return;
    const s = 3;
    ctx.beginPath();
    ctx.strokeRect(x - s, y - s, s * 2, s * 2);
    ctx.beginPath();
    ctx.moveTo(x - s - 3, y); ctx.lineTo(x + s + 3, y);
    ctx.moveTo(x, y - s - 3); ctx.lineTo(x, y + s + 3);
    ctx.stroke();
    ctx.fillText(ap.iata, x, y + s + 5);
  });

  // Receiver marker (crosshair + circle)
  ctx.strokeStyle = fgColor;
  ctx.lineWidth   = 1;
  ctx.globalAlpha = 0.7;
  const rm = 4;
  ctx.beginPath(); ctx.arc(cx, cy, rm, 0, 2 * Math.PI); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx - rm - 4, cy); ctx.lineTo(cx + rm + 4, cy); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(cx, cy - rm - 4); ctx.lineTo(cx, cy + rm + 4); ctx.stroke();
  ctx.globalAlpha = 1;

  // Degree bezel
  drawBezel(cx, cy, RI, RO);
}

function drawNorthArrow(cx, cy, R) {
  const tip  = { x: cx, y: cy - R + 18 };
  const base = { y: cy - R + 34 };
  ctx.save();
  // Filled (fg) left half
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - 6, base.y);
  ctx.lineTo(tip.x, base.y - 4);
  ctx.closePath();
  ctx.fillStyle = fgColor;
  ctx.fill();
  // Hollow right half
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + 6, base.y);
  ctx.lineTo(tip.x, base.y - 4);
  ctx.closePath();
  ctx.strokeStyle = fgColor;
  ctx.lineWidth   = 1;
  ctx.stroke();
  ctx.restore();
}

function drawBezel(cx, cy, RI, RO) {
  // Faint background arc
  ctx.beginPath(); ctx.arc(cx, cy, (RI + RO) / 2, 0, 2 * Math.PI);
  ctx.strokeStyle = fgDimColor;
  ctx.lineWidth   = RO - RI;
  ctx.globalAlpha = 0.12;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Labels at 30° intervals
  const labels30 = ['N','','','30','','','60','','','E','','','120','','','150','','','S','','','210','','','240','','','W','','','300','','','330','',''];
  const cardinals = new Set(['N', 'E', 'S', 'W']);

  for (let deg = 0; deg < 360; deg += 5) {
    const rad     = (deg - 90) * Math.PI / 180;
    const isMajor = deg % 10 === 0;
    const r1      = isMajor ? RI + 1 : RI + 2;
    const r2      = RO - 1;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(rad) * r1, cy + Math.sin(rad) * r1);
    ctx.lineTo(cx + Math.cos(rad) * r2, cy + Math.sin(rad) * r2);
    ctx.strokeStyle = fgDimColor;
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    if (deg % 30 === 0) {
      const idx    = deg / 10;
      const label  = labels30[idx] || '';
      const labelR = RO + 8;
      ctx.save();
      ctx.translate(cx + Math.cos(rad) * labelR, cy + Math.sin(rad) * labelR);
      ctx.rotate(rad + Math.PI / 2);
      ctx.font      = cardinals.has(label) ? 'bold 9px monospace' : '9px monospace';
      ctx.fillStyle = cardinals.has(label) ? fgColor : fgDimColor;
      ctx.textAlign     = 'center';
      ctx.textBaseline  = 'middle';
      ctx.fillText(label, 0, 0);
      ctx.restore();
    }
  }
}

function drawSweep(angle) {
  const W  = canvas.width;
  const cx = W / 2, cy = W / 2;
  const R  = W * 0.43;
  const span1 = Math.PI / 6;  // 30° wide faint sector
  const span2 = Math.PI / 18; // 10° slightly brighter

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();

  // Wide faint sector
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, angle - span1, angle, false);
  ctx.closePath();
  const grad1 = ctx.createConicalGradient
    ? null
    : ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
  if (grad1) {
    grad1.addColorStop(0, 'transparent');
    grad1.addColorStop(1, fgColor + '22');
    ctx.fillStyle = grad1;
  } else {
    ctx.fillStyle = fgColor + '18';
  }
  ctx.fill();

  // Narrower slightly brighter sector
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.arc(cx, cy, R, angle - span2, angle, false);
  ctx.closePath();
  ctx.fillStyle = fgColor + '30';
  ctx.fill();

  // Sweep line
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * R, cy + Math.sin(angle) * R);
  ctx.strokeStyle = fgColor;
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = 0.9;
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

/* ── Aircraft icon — top-down airplane silhouette ── */
function drawPlaneIcon(x, y, trackDeg, color, size) {
  const s = size;
  ctx.save();
  ctx.translate(x, y);
  // track 0 = north = up on screen; rotate clockwise by track degrees
  ctx.rotate(trackDeg * Math.PI / 180);
  ctx.fillStyle = color;

  // Fuselage — nose at (0, -s), tail at (0, s*0.55)
  ctx.beginPath();
  ctx.moveTo(0,        -s);          // nose tip
  ctx.lineTo( s*0.18,  s*0.20);
  ctx.lineTo( s*0.12,  s*0.55);
  ctx.lineTo( 0,       s*0.42);
  ctx.lineTo(-s*0.12,  s*0.55);
  ctx.lineTo(-s*0.18,  s*0.20);
  ctx.closePath();
  ctx.fill();

  // Main wings — swept back slightly
  ctx.beginPath();
  ctx.moveTo( s*0.14,  s*0.08);
  ctx.lineTo( s*1.05,  s*0.52);
  ctx.lineTo( s*0.85,  s*0.62);
  ctx.lineTo( 0,       s*0.30);
  ctx.lineTo(-s*0.85,  s*0.62);
  ctx.lineTo(-s*1.05,  s*0.52);
  ctx.lineTo(-s*0.14,  s*0.08);
  ctx.closePath();
  ctx.fill();

  // Tail fins
  ctx.beginPath();
  ctx.moveTo( s*0.10,  s*0.52);
  ctx.lineTo( s*0.40,  s*0.92);
  ctx.lineTo( s*0.22,  s*0.98);
  ctx.lineTo( 0,       s*0.75);
  ctx.lineTo(-s*0.22,  s*0.98);
  ctx.lineTo(-s*0.40,  s*0.92);
  ctx.lineTo(-s*0.10,  s*0.52);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

function drawBlips() {
  const W  = canvas.width;
  const cx = W / 2, cy = W / 2;
  const R  = W * 0.43;

  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();

  aircraft.forEach(ac => {
    if (!ac.lat || !ac.lon) return;
    const [x, y] = geoToXY(ac.lat, ac.lon, cx, cy, R, rangeKm);
    if (x < 0 || x > W || y < 0 || y > W) return;

    const color      = blipColor(ac);
    const isSelected = ac.hex === selectedHex;
    const iconSize   = isSelected ? 9 : 7;
    const hasTrack   = ac.track !== undefined && ac.gs > 0;
    const trackDeg   = ac.track || 0;

    // Trail ghost dots (small circles — historical positions)
    const hist  = posHistory.get(ac.hex) || [];
    const trail = hist.slice(0, -1);
    const opacities = [0.15, 0.25, 0.35];
    trail.forEach((pos, i) => {
      const oi = trail.length - 1 - i;
      const op = opacities[oi] || 0.15;
      const [tx, ty] = geoToXY(pos.lat, pos.lon, cx, cy, R, rangeKm);
      ctx.beginPath(); ctx.arc(tx, ty, 2, 0, 2 * Math.PI);
      ctx.fillStyle   = color;
      ctx.globalAlpha = op;
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    // Heading vector — thin line extending ahead of the nose
    if (hasTrack) {
      const tRad  = trackDeg * Math.PI / 180;
      const noseX = x + Math.sin(tRad) * iconSize;
      const noseY = y - Math.cos(tRad) * iconSize;
      ctx.beginPath();
      ctx.moveTo(noseX, noseY);
      ctx.lineTo(noseX + Math.sin(tRad) * 18, noseY - Math.cos(tRad) * 18);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 0.8;
      ctx.globalAlpha = 0.55;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Glow ring for selected aircraft
    if (isSelected) {
      ctx.beginPath(); ctx.arc(x, y, iconSize + 5, 0, 2 * Math.PI);
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1.5;
      ctx.globalAlpha = 0.4;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // Airplane icon (falls back to circle if no track data)
    if (hasTrack) {
      drawPlaneIcon(x, y, trackDeg, color, iconSize);
    } else {
      ctx.beginPath(); ctx.arc(x, y, iconSize * 0.55, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    }

    // Callout label for selected aircraft
    if (isSelected) {
      const cs     = (ac.flight || ac.hex || '').trim();
      const altStr = fmtAlt(ac.alt_baro);
      const spdStr = fmtSpd(ac.gs);
      const lines  = [cs, altStr, spdStr].filter(Boolean);
      const padX   = 6, padY = 4, lineH = 13, boxW = 84;
      const boxH   = lines.length * lineH + padY * 2;
      let bx = x + iconSize + 6, by = y - boxH / 2;
      if (bx + boxW > W - 10) bx = x - boxW - iconSize - 6;
      ctx.fillStyle   = bgColor;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 1;
      ctx.strokeRect(bx, by, boxW, boxH);
      ctx.fillStyle    = color;
      ctx.font         = '10px monospace';
      ctx.textAlign    = 'left';
      ctx.textBaseline = 'top';
      lines.forEach((line, i) => {
        ctx.fillText(line, bx + padX, by + padY + i * lineH);
      });
    }
  });

  ctx.restore();
}

/* ── Main animation frame ── */

function drawFrame(ts = 0) {
  refreshColors();
  const dt = lastTs ? ts - lastTs : 0;
  lastTs = ts;

  if (sweepEnabled) {
    sweepAngle += SWEEP_RADS_PER_MS * dt;
    if (sweepAngle > 3 * Math.PI / 2) sweepAngle -= 2 * Math.PI;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBase();
  if (sweepEnabled) drawSweep(sweepAngle);
  drawBlips();

  requestAnimationFrame(drawFrame);
}

/* ══════════════════════════════════════════════════════════
   AIRCRAFT CARD GRID
   ══════════════════════════════════════════════════════════ */

function renderCards() {
  const grid = document.getElementById('ac-grid');
  grid.innerHTML = '';

  aircraft.forEach(ac => {
    const card = document.createElement('div');
    card.className = 'ac-card' + (ac.hex === selectedHex ? ' selected' : '');
    card.dataset.hex = ac.hex;

    const airline  = ac.airline || getAirlineCode(ac.flight) || '—';
    const dist     = ac._dist !== undefined ? Math.round(ac._dist) + ' KM' : (ac.r_dst ? Math.round(ac.r_dst * 1.852) + ' KM' : '—');
    const flight   = (ac.flight || ac.hex || '').trim();
    const typeCode = ac.type || ac.t || '';
    const reg      = ac.reg  || ac.r  || '';
    const typePart = [typeCode, reg].filter(Boolean).join(' · ') || '—';
    const orig     = ac.orig || null;
    const dest     = ac.dest || null;
    const route    = (orig && dest) ? `${orig}→${dest}` : '——';
    const vs       = ac.baro_rate || 0;

    card.innerHTML = `
      <div class="card-top-row">
        <div class="card-airline">${escHtml(airline)}</div>
        <div class="card-dist">${escHtml(dist)}</div>
      </div>
      <div class="card-flight">${escHtml(flight)}</div>
      <div class="card-type">${escHtml(typePart)}</div>
      <hr class="card-divider">
      <div class="card-data">
        <div>
          <div class="card-field-lbl">ALTITUDE</div>
          <div class="card-field-val">${escHtml(fmtAlt(ac.alt_baro))}</div>
        </div>
        <div>
          <div class="card-field-lbl">SPEED</div>
          <div class="card-field-val">${escHtml(fmtSpd(ac.gs))}</div>
        </div>
        <div>
          <div class="card-field-lbl">ROUTE</div>
          <div class="card-field-val">${escHtml(route)}</div>
        </div>
        <div>
          <div class="card-field-lbl">VERT RATE</div>
          <div class="card-field-val">${escHtml(fmtVs(vs))}</div>
        </div>
      </div>`;

    card.addEventListener('click', () => {
      selectedHex = ac.hex === selectedHex ? null : ac.hex;
      renderCards();
    });

    grid.appendChild(card);
  });
}

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ══════════════════════════════════════════════════════════
   FOOTER STATS
   ══════════════════════════════════════════════════════════ */

function updateStats() {
  document.getElementById('stat-tracked').textContent = aircraft.length;
}

function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  document.getElementById('stat-time').textContent = `${hh}:${mm}`;
}
updateClock();
setInterval(updateClock, 30000);

/* ══════════════════════════════════════════════════════════
   BURGER MENU
   ══════════════════════════════════════════════════════════ */

const THEMES_LIST = ['color', 'airbus', 'boeing', 'embraer', 'bombardier', 'military'];

function applyThemeByName(name) {
  // radar-themes.js themes object is not exported, so re-apply via URL + inline styles
  const THEMES = {
    color:      { '--bg':'#050200','--fg':'#FFA040','--fg-mid':'#CC7020','--fg-dim':'#7A4010','--sep':'#3A1E08','--accent':'#FF8000','--land':'#1E1208' },
    airbus:     { '--bg':'#06080F','--fg':'#7EB3E8','--fg-mid':'#4A7AB0','--fg-dim':'#243C5A','--sep':'#152030','--accent':'#3A8FD4','--land':'#0F1828' },
    boeing:     { '--bg':'#060508','--fg':'#C8A84B','--fg-mid':'#8A7030','--fg-dim':'#483A18','--sep':'#28200C','--accent':'#F0C040','--land':'#181208' },
    embraer:    { '--bg':'#050A09','--fg':'#5FC4B0','--fg-mid':'#348878','--fg-dim':'#1A4840','--sep':'#0E2824','--accent':'#2EA898','--land':'#0D2018' },
    bombardier: { '--bg':'#080505','--fg':'#E87070','--fg-mid':'#A03838','--fg-dim':'#581818','--sep':'#300C0C','--accent':'#CC4444','--land':'#200C0C' },
    military:   { '--bg':'#030603','--fg':'#5EBF5E','--fg-mid':'#388038','--fg-dim':'#1A401A','--sep':'#0C200C','--accent':'#3A9A3A','--land':'#0C1A0A' },
  };
  const t = THEMES[name] || THEMES.color;
  const root = document.documentElement;
  Object.entries(t).forEach(([p, v]) => root.style.setProperty(p, v));
}

function persistUrlParams() {
  const u = new URL(location.href);
  u.searchParams.set('theme',  currentTheme);
  u.searchParams.set('range',  rangeMode);
  u.searchParams.set('sweep',  sweepEnabled ? 'on' : 'off');
  u.searchParams.set('units',  metricUnits  ? 'metric' : 'imperial');
  history.replaceState(null, '', u);
}

let currentTheme = _fp.get('theme') || 'color';

function initMenuState() {
  // Range
  markActive('menu-range',  'data-val', rangeMode);
  // Sweep
  markActive('menu-sweep',  'data-val', sweepEnabled ? 'on' : 'off');
  // Units
  markActive('menu-units',  'data-val', metricUnits ? 'metric' : 'imperial');
  // Theme
  markActive('menu-theme',  'data-val', currentTheme);
}

function markActive(groupId, attr, value) {
  const group = document.getElementById(groupId);
  if (!group) return;
  group.querySelectorAll('.menu-opt').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute(attr) === String(value));
  });
}

// Range group
document.getElementById('menu-range').addEventListener('click', e => {
  const btn = e.target.closest('.menu-opt');
  if (!btn) return;
  rangeMode = btn.dataset.val;
  if (rangeMode !== 'auto') rangeKm = parseInt(rangeMode, 10);
  markActive('menu-range', 'data-val', rangeMode);
});

// Sweep group
document.getElementById('menu-sweep').addEventListener('click', e => {
  const btn = e.target.closest('.menu-opt');
  if (!btn) return;
  sweepEnabled = btn.dataset.val === 'on';
  markActive('menu-sweep', 'data-val', btn.dataset.val);
});

// Units group
document.getElementById('menu-units').addEventListener('click', e => {
  const btn = e.target.closest('.menu-opt');
  if (!btn) return;
  metricUnits = btn.dataset.val === 'metric';
  markActive('menu-units', 'data-val', btn.dataset.val);
  renderCards();
});

// Theme group
document.getElementById('menu-theme').addEventListener('click', e => {
  const btn = e.target.closest('.menu-opt');
  if (!btn) return;
  currentTheme = btn.dataset.val;
  applyThemeByName(currentTheme);
  markActive('menu-theme', 'data-val', currentTheme);
});

// Open / close menu
document.getElementById('menu-open-btn').addEventListener('click', () => {
  initMenuState();
  document.getElementById('menu-overlay').classList.add('open');
});

function closeMenu() {
  document.getElementById('menu-overlay').classList.remove('open');
  persistUrlParams();
}

document.getElementById('menu-close-btn').addEventListener('click', closeMenu);
document.getElementById('menu-overlay').addEventListener('click', e => {
  if (e.target === document.getElementById('menu-overlay')) closeMenu();
});

/* ══════════════════════════════════════════════════════════
   BOOT
   ══════════════════════════════════════════════════════════ */

fetchAircraft();
setInterval(fetchAircraft, FETCH_MS);
requestAnimationFrame(drawFrame);

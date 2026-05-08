/* ── CONFIG ── */
const AIRCRAFT_JSON = '/tar1090/data/aircraft.json';
const ROUTE_API     = 'http://flighttracker.local:8088';
const FETCH_MS      = 10000;   /* e-ink: slower refresh is fine */
const MAX_ROWS      = 14;

/* ── FIELD WIDTHS ── */
const W = { flight: 8, apt: 4, alt: 6, spd: 5, status: 10 };

/* ── STATE ── */
let routeCache = {};

/* ── CLOCK ── */
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
}, 1000);
document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);

/* ── HELPERS ── */
function getAirlineCode(cs) {
  if (!cs) return null;
  const u = cs.trim().toUpperCase();
  for (const k of Object.keys(AIRLINES)) if (u.startsWith(k)) return k;
  return u.slice(0, 3);
}

/* ── ROUTE FETCH ── */
async function fetchRoute(ac) {
  const cs = (ac.flight || '').trim();
  if (!cs || routeCache[cs] !== undefined) return routeCache[cs] || null;
  routeCache[cs] = null;

  try {
    const res = await fetch(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`);
    if (res.ok) {
      const data = await res.json();
      const r = data?.response?.flightroute;
      if (r) { routeCache[cs] = r; return r; }
    }
  } catch(e) {}

  try {
    const res = await fetch(ROUTE_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icao: ac.hex, callsign: cs, lat: ac.lat || 0, lng: ac.lon || 0, postime: Date.now() })
    });
    if (res.ok) {
      const data = await res.json();
      const r = data?.route?.[0];
      if (r) { routeCache[cs] = r; return r; }
    }
  } catch(e) {}

  return null;
}

/* ── FORMAT ROW ── */
function formatRow(ac, route) {
  const cs        = (ac.flight || '').trim();
  const icaoCode  = getAirlineCode(cs);

  const airlineIata  = route?.airline?.iata || ICAO_TO_IATA[icaoCode] || '';
  const flightSuffix = icaoCode ? cs.replace(new RegExp('^' + icaoCode, 'i'), '').trim() : '';
  const derived      = (airlineIata && airlineIata !== icaoCode && flightSuffix) ? airlineIata + flightSuffix : '';
  const apiIata      = route?.callsign_iata || '';
  const iataFlight   = (apiIata && apiIata !== cs) ? apiIata : derived;
  const flightDisp   = (iataFlight || cs).toUpperCase().padEnd(W.flight).slice(0, W.flight);

  const from = ((route?.origin?.iata_code || route?.origin?.iata || '---').toUpperCase() + '    ').slice(0, W.apt);
  const to   = ((route?.destination?.iata_code || route?.destination?.iata || '---').toUpperCase() + '    ').slice(0, W.apt);

  const altRaw = ac.alt_baro === 'ground' ? 'GND' : (ac.alt_baro != null ? String(Math.round(ac.alt_baro)) : '---');
  const alt    = altRaw.padStart(W.alt).slice(-W.alt);

  const spdRaw = ac.gs != null ? String(Math.round(ac.gs)) : '---';
  const spd    = spdRaw.padStart(W.spd).slice(-W.spd);

  const vr = ac.baro_rate || 0;
  let statusStr, statusCls;
  if (ac.alt_baro === 'ground') { statusStr = 'ON GROUND '; statusCls = 'c-dim'; }
  else if (vr >  300)           { statusStr = 'CLIMBING  '; statusCls = 'c-green'; }
  else if (vr < -300)           { statusStr = 'DESCENDING'; statusCls = 'c-red'; }
  else                          { statusStr = 'EN ROUTE  '; statusCls = 'c-gold'; }
  const status = statusStr.padEnd(W.status).slice(0, W.status);

  return { flightDisp, from, to, alt, spd, status, statusCls };
}

/* ── RENDER CELL (no animation — direct text update) ── */
function renderCell(cellEl, text, colorClass) {
  cellEl.className = 'bcell' + (colorClass ? ' ' + colorClass : '');
  cellEl.textContent = text;
}

/* ── BUILD BOARD ── */
function buildBoard() {
  const container = document.getElementById('rows');
  container.innerHTML = '';

  for (let r = 0; r < MAX_ROWS; r++) {
    const row = document.createElement('div');
    row.className   = 'brow empty';
    row.dataset.row = r;

    const cols = [W.flight, W.apt, W.apt, W.alt, W.spd, W.status];
    cols.forEach(w => {
      const cell = document.createElement('div');
      cell.className   = 'bcell';
      cell.textContent = ' '.repeat(w);
      row.appendChild(cell);
    });

    container.appendChild(row);
  }
}

/* ── UPDATE BOARD ── */
function updateBoard(newData) {
  const rows = document.getElementById('rows').querySelectorAll('.brow');

  for (let i = 0; i < MAX_ROWS; i++) {
    const row   = rows[i];
    if (!row) continue;
    const cells = row.querySelectorAll('.bcell');

    if (i < newData.length) {
      const d = newData[i];
      row.classList.remove('empty');

      renderCell(cells[0], d.flightDisp, '');
      renderCell(cells[1], d.from,       'c-dim');
      renderCell(cells[2], d.to,         'c-dim');
      renderCell(cells[3], d.alt,        '');
      renderCell(cells[4], d.spd,        '');
      renderCell(cells[5], d.status,     d.statusCls);

    } else {
      row.classList.add('empty');
      cells.forEach((c, ci) => {
        const ws = [W.flight, W.apt, W.apt, W.alt, W.spd, W.status];
        c.className   = 'bcell';
        c.textContent = ' '.repeat(ws[ci] || 4);
      });
    }
  }
}

/* ── FETCH & REFRESH ── */
async function fetchAircraft() {
  try {
    const res  = await fetch(AIRCRAFT_JSON + '?_=' + Date.now());
    const data = await res.json();

    const aircraft = (data.aircraft || [])
      .filter(a => a.lat && a.lon && a.flight && a.flight.trim())
      .sort((a, b) => (b.rssi || -99) - (a.rssi || -99))
      .slice(0, MAX_ROWS);

    const routes  = await Promise.all(aircraft.map(ac => fetchRoute(ac)));
    const newData = aircraft.map((ac, i) => formatRow(ac, routes[i]));
    updateBoard(newData);

  } catch(e) {}
}

/* ── INIT ── */
buildBoard();
setInterval(fetchAircraft, FETCH_MS);
fetchAircraft();

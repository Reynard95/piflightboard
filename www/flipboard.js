/* ── CONFIG ── */
const AIRCRAFT_JSON = '/tar1090/data/aircraft.json';
const ROUTE_API     = 'http://flighttracker.local:8088';
const FETCH_MS      = 5000;
const MAX_ROWS      = 14;

/* ── FIELD WIDTHS (character counts) ── */
const W = { flight: 8, apt: 4, alt: 6, spd: 5, status: 10 };

/* ── FLIP CHAR SET ── matches characters we'll ever show ── */
const FC_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789,.-/+';

/* ── STATE ── */
let allAircraft = [];
let routeCache  = {};
let boardState  = [];  // current displayed values per row

/* ── CLOCK ── */
setInterval(() => {
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
}, 1000);
document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);

/* ── HELPERS (shared with flightboard) ── */
function getAirlineCode(cs) {
  if (!cs) return null;
  const u = cs.trim().toUpperCase();
  for (const k of Object.keys(AIRLINES)) if (u.startsWith(k)) return k;
  return u.slice(0, 3);
}

/* ── ROUTE FETCH (same as flightboard, shared cache not needed — separate page) ── */
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

/* ── FORMAT ONE ROW OF DATA ── */
function formatRow(ac, route) {
  const cs        = (ac.flight || '').trim();
  const icaoCode  = getAirlineCode(cs);

  /* Derive IATA flight number */
  const airlineIata  = route?.airline?.iata || ICAO_TO_IATA[icaoCode] || '';
  const flightSuffix = icaoCode ? cs.replace(new RegExp('^' + icaoCode, 'i'), '').trim() : '';
  const derived      = (airlineIata && airlineIata !== icaoCode && flightSuffix) ? airlineIata + flightSuffix : '';
  const apiIata      = route?.callsign_iata || '';
  const iataFlight   = (apiIata && apiIata !== cs) ? apiIata : derived;
  const flightDisp   = (iataFlight || cs).toUpperCase().padEnd(W.flight).slice(0, W.flight);

  /* Origin / destination */
  const from = ((route?.origin?.iata_code || route?.origin?.iata || '---').toUpperCase() + '    ').slice(0, W.apt);
  const to   = ((route?.destination?.iata_code || route?.destination?.iata || '---').toUpperCase() + '    ').slice(0, W.apt);

  /* Altitude — right-aligned */
  const altRaw = ac.alt_baro === 'ground' ? 'GND' : (ac.alt_baro != null ? String(Math.round(ac.alt_baro)) : '---');
  const alt    = altRaw.padStart(W.alt).slice(-W.alt);

  /* Speed — right-aligned */
  const spdRaw = ac.gs != null ? String(Math.round(ac.gs)) : '---';
  const spd    = spdRaw.padStart(W.spd).slice(-W.spd);

  /* Status */
  const vr = ac.baro_rate || 0;
  let statusStr, statusCls;
  if (ac.alt_baro === 'ground') { statusStr = 'ON GROUND '; statusCls = 'c-dim'; }
  else if (vr >  300)           { statusStr = 'CLIMBING  '; statusCls = 'c-green'; }
  else if (vr < -300)           { statusStr = 'DESCENDING'; statusCls = 'c-red'; }
  else                          { statusStr = 'EN ROUTE  '; statusCls = 'c-gold'; }
  const status = statusStr.padEnd(W.status).slice(0, W.status);

  return { flightDisp, from, to, alt, spd, status, statusCls };
}

/* ── FLIP ANIMATION ── */
function flipChar(el, targetChar) {
  const ch = (targetChar === ' ' || !FC_CHARS.includes(targetChar.toUpperCase()))
    ? ' ' : targetChar.toUpperCase();
  if (el.dataset.ch === ch) return;

  /* 2–3 random intermediate chars, then the real target */
  const steps = [];
  const intermediates = 2 + Math.floor(Math.random() * 2);
  for (let i = 0; i < intermediates; i++) {
    steps.push(FC_CHARS[Math.floor(Math.random() * FC_CHARS.length)]);
  }
  steps.push(ch);

  steps.forEach((c, i) => {
    setTimeout(() => {
      el.classList.remove('flipping');
      void el.offsetWidth;       // force reflow so animation restarts
      el.classList.add('flipping');
      /* switch character at midpoint of 90ms animation */
      setTimeout(() => {
        el.textContent = c;
        el.dataset.ch  = c;
      }, 45);
    }, i * 100);
  });
}

/* ── UPDATE ONE CELL (diff chars, animate changes) ── */
function updateCell(cellEl, newText, colorClass) {
  /* Colour class */
  cellEl.className = 'bcell' + (colorClass ? ' ' + colorClass : '');

  const fcs = cellEl.querySelectorAll('.fc');
  const str = newText.padEnd(fcs.length).slice(0, fcs.length);
  for (let i = 0; i < fcs.length; i++) {
    if ((fcs[i].dataset.ch || ' ') !== str[i]) {
      flipChar(fcs[i], str[i]);
    }
  }
}

/* ── BUILD BOARD DOM ── */
function buildBoard() {
  const container = document.getElementById('rows');
  container.innerHTML = '';

  for (let r = 0; r < MAX_ROWS; r++) {
    const row = document.createElement('div');
    row.className = 'brow';
    row.dataset.row = r;

    /* columns: flight | from | to | alt | spd | status */
    const cols = [
      { w: W.flight, cls: 'c-bright' },
      { w: W.apt,    cls: 'c-dim'    },
      { w: W.apt,    cls: 'c-dim'    },
      { w: W.alt,    cls: ''         },
      { w: W.spd,    cls: ''         },
      { w: W.status, cls: ''         },
    ];

    cols.forEach(({ w, cls }) => {
      const cell = document.createElement('div');
      cell.className = 'bcell' + (cls ? ' ' + cls : '');

      for (let i = 0; i < w; i++) {
        const fc = document.createElement('span');
        fc.className    = 'fc';
        fc.textContent  = ' ';
        fc.dataset.ch   = ' ';
        cell.appendChild(fc);
      }
      row.appendChild(cell);
    });

    container.appendChild(row);
    boardState[r] = null;
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
      const d   = newData[i];
      const old = boardState[i] || {};

      if (d.flightDisp !== old.flightDisp) updateCell(cells[0], d.flightDisp, 'c-bright');
      if (d.from       !== old.from)       updateCell(cells[1], d.from,       'c-dim');
      if (d.to         !== old.to)         updateCell(cells[2], d.to,         'c-dim');
      if (d.alt        !== old.alt)        updateCell(cells[3], d.alt,        '');
      if (d.spd        !== old.spd)        updateCell(cells[4], d.spd,        '');
      if (d.status     !== old.status || d.statusCls !== old?.statusCls)
                                           updateCell(cells[5], d.status,     d.statusCls);
      boardState[i] = d;

    } else if (boardState[i]) {
      /* Row no longer in use — clear it */
      const blank = {
        flightDisp: ' '.repeat(W.flight),
        from:       ' '.repeat(W.apt),
        to:         ' '.repeat(W.apt),
        alt:        ' '.repeat(W.alt),
        spd:        ' '.repeat(W.spd),
        status:     ' '.repeat(W.status),
        statusCls:  '',
      };
      updateCell(cells[0], blank.flightDisp, 'c-bright');
      updateCell(cells[1], blank.from,       'c-dim');
      updateCell(cells[2], blank.to,         'c-dim');
      updateCell(cells[3], blank.alt,        '');
      updateCell(cells[4], blank.spd,        '');
      updateCell(cells[5], blank.status,     '');
      boardState[i] = null;
    }
  }
}

/* ── FETCH & REFRESH ── */
async function fetchAircraft() {
  try {
    const res  = await fetch(AIRCRAFT_JSON + '?_=' + Date.now());
    const data = await res.json();

    allAircraft = (data.aircraft || [])
      .filter(a => a.lat && a.lon && a.flight && a.flight.trim())
      .sort((a, b) => (b.rssi || -99) - (a.rssi || -99))
      .slice(0, MAX_ROWS);

    /* Fetch routes (cached) in parallel */
    const routes  = await Promise.all(allAircraft.map(ac => fetchRoute(ac)));
    const newData = allAircraft.map((ac, i) => formatRow(ac, routes[i]));
    updateBoard(newData);

  } catch(e) {}
}

/* ── INIT ── */
buildBoard();
setInterval(fetchAircraft, FETCH_MS);
fetchAircraft();

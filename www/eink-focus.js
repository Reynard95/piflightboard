/* ── CONFIG ── */
const AIRCRAFT_JSON = '/tar1090/data/aircraft.json';
const ROUTE_API     = 'http://flighttracker.local:8088';
const DB_PATH       = '/tar1090/db-28a5940/';
const CYCLE_MS = 60000;   /* 60s per aircraft — minimise e-ink refreshes */

/* ── RESOLUTION SCALING ─────────────────────────────────────────────────────
 *  Optional URL param:  ?res=800x480  (width × height in px)
 *  Overrides --sz-* CSS tokens for pixel-perfect sizing on known panels.
 *
 *  Common e-ink resolutions:
 *    400x300   (4.2")              → ?res=400x300
 *    648x480   (5.83")             → ?res=648x480
 *    800x480   (7.5" landscape)    → ?res=800x480
 *    1200x825  (9.7" landscape)    → ?res=1200x825
 *    480x800   (portrait)          → ?res=480x800
 *    1404x1872 (10.3" portrait)    → ?res=1404x1872
 *    1600x1200 (13.3")             → ?res=1600x1200
 * ─────────────────────────────────────────────────────────────────────────── */
(function applyResolution() {
  try {
    const param = new URLSearchParams(window.location.search).get('res');
    if (!param) return;
    const parts = param.toLowerCase().split('x');
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    if (!w || !h) return;

    const s    = Math.min(w, h);   /* shorter edge drives scale */
    const root = document.documentElement;

    root.style.setProperty('--sz-airline',  Math.round(s * 0.115) + 'px');
    root.style.setProperty('--sz-iata',     Math.round(s * 0.280) + 'px');
    root.style.setProperty('--sz-city',     Math.round(s * 0.032) + 'px');
    root.style.setProperty('--sz-data-val', Math.round(s * 0.082) + 'px');
    root.style.setProperty('--sz-data-lbl', Math.round(s * 0.030) + 'px');
    root.style.setProperty('--sz-type',     Math.round(s * 0.052) + 'px');
    root.style.setProperty('--sz-eta',      Math.round(s * 0.052) + 'px');
    root.style.setProperty('--sz-logo',     Math.round(s * 0.210) + 'px');
  } catch(e) {}
})();

/* ── FILTER PARAMS ─────────────────────────────────────────────────────────
 *  ?radius=N      Show only aircraft within N km of the receiver.
 *                 If no aircraft are within range, falls back to showing all.
 *
 *  ?closest       Always display only the single nearest aircraft.
 *                 No cycling — the display updates to the new closest on each
 *                 data refresh.
 *
 *  ?refresh=N     Fetch new data every N seconds (minimum 5, default 10).
 *                 The display only re-renders if the aircraft's data has
 *                 meaningfully changed — skipping identical fetches avoids
 *                 unnecessary e-ink panel refreshes.
 *
 *  Combined:      ?radius=50&closest&refresh=15
 * ─────────────────────────────────────────────────────────────────────────── */
const _fp          = new URLSearchParams(window.location.search);
const RADIUS_KM    = (() => { const v = parseFloat(_fp.get('radius')); return isFinite(v) && v > 0 ? v : null; })();
const CLOSEST_ONLY = _fp.has('closest');
const FETCH_MS     = (() => { const v = parseFloat(_fp.get('refresh')); return isFinite(v) && v >= 5 ? Math.round(v * 1000) : 10000; })();

/* ── STATE ── */
let allAircraft = [], currentIndex = 0, routeCache = {}, cycleTimer = null;
let radiusFallback = false;   /* true when radius set but no aircraft in range */
let lastRenderedKey = '';     /* change-detection: skip render if data unchanged */

/* ── CLOCK — HH:MM only, updates once per minute ── */
function tick() {
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 5);
}
setInterval(tick, 60000); tick();

/* ── HELPERS ── */
function fmt(v, d = 0) {
  if (v == null || isNaN(v)) return '---';
  return Number(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
            Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function fmtDuration(minutes) {
  if (minutes == null || isNaN(minutes) || minutes < 0) return '---';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h > 0 ? `${h}H ${String(m).padStart(2, '0')}M` : `${m}M`;
}

function getTypeName(t) {
  if (!t) return '';
  const key = t.trim().toUpperCase();
  return AC_TYPES[key] ? AC_TYPES[key].toUpperCase() : key;
}

/* Shorten full airport names for display under the IATA code:
 *   "LONDON LUTON AIRPORT"              → "LONDON LUTON"
 *   "DUBAI INTERNATIONAL AIRPORT"       → "DUBAI INTL"
 *   "JOHN F KENNEDY INTERNATIONAL ..."  → "JOHN F KENNEDY INTL"
 */
function abbreviateAirport(name) {
  if (!name) return '';
  return name
    .replace(/\bINTERNATIONAL AIRPORT\b/gi, 'INTL')
    .replace(/\bINTERNATIONAL\b/gi, 'INTL')
    .replace(/\bAIRPORT\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .toUpperCase();
}

/* Coarse snapshot of an aircraft's live state for change detection.
 * Returns a string key — if it matches the last rendered key we skip the
 * re-render, saving an e-ink panel refresh when nothing meaningful changed.
 * Values are deliberately rounded so minor jitter doesn't trigger redraws.
 */
function aircraftKey(ac) {
  if (!ac) return '';
  const alt = ac.alt_baro === 'ground' ? 'GND' : Math.round((ac.alt_baro  || 0) / 100);
  const spd = Math.round((ac.gs        || 0) / 5)   * 5;
  const trk = Math.round((ac.track     || 0) / 2)   * 2;
  const vr  = Math.round((ac.baro_rate || 0) / 100) * 100;
  return `${ac.flight}|${alt}|${spd}|${trk}|${vr}`;
}

function getAirlineCode(cs) {
  if (!cs) return null;
  const u = cs.trim().toUpperCase();
  for (const k of Object.keys(AIRLINES)) if (u.startsWith(k)) return k;
  return u.slice(0, 3);
}

/* ── TAR1090 DB LOOKUP ── */
const dbCache   = {};
const fileCache = {};

async function lookupHex(hex) {
  if (!hex) return null;
  const h = hex.toUpperCase();
  if (dbCache[h] !== undefined) return dbCache[h];
  dbCache[h] = null;
  const prefixes = [h.slice(0,3), h.slice(0,2), h.slice(0,1)];
  for (const pfx of prefixes) {
    try {
      const data = await loadDbFile(pfx);
      if (data && data[h]) {
        const row = data[h];
        dbCache[h] = { reg: row[0] || '', type: row[1] || '', desc: row[3] || '' };
        return dbCache[h];
      }
    } catch(e) {}
  }
  return null;
}

async function loadDbFile(prefix) {
  if (fileCache[prefix] !== undefined) return fileCache[prefix];
  fileCache[prefix] = null;
  try {
    const res  = await fetch(`${DB_PATH}${prefix}.js?_=1`);
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    fileCache[prefix] = data;
    return data;
  } catch(e) { return null; }
}

/* ── ROUTE LOOKUP ── */
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

/* ── FETCH AIRCRAFT.JSON ── */
async function fetchAircraft() {
  try {
    const res  = await fetch(AIRCRAFT_JSON + '?_=' + Date.now());
    const data = await res.json();

    /* Base list: valid aircraft sorted by signal strength */
    const base = (data.aircraft || [])
      .filter(a => a.lat && a.lon && a.flight && a.flight.trim())
      .sort((a, b) => (b.rssi || -99) - (a.rssi || -99));

    let filtered = base;
    radiusFallback = false;

    /* ── Radius filter ── */
    if (RADIUS_KM !== null) {
      const nearby = base.filter(a => a.r_dst != null && a.r_dst <= RADIUS_KM);
      if (nearby.length > 0) {
        filtered = nearby;
      } else {
        filtered = base;          /* fallback: nothing in range, show all */
        radiusFallback = true;
      }
    }

    /* ── Closest-only: sort by distance, keep the nearest one ── */
    if (CLOSEST_ONLY) {
      const withDist = filtered
        .filter(a => a.r_dst != null)
        .sort((a, b) => a.r_dst - b.r_dst);
      filtered = withDist.length > 0 ? [withDist[0]] : filtered.slice(0, 1);
    }

    allAircraft = filtered;
    updateTicker();

    if (CLOSEST_ONLY) {
      /* Nearest aircraft mode — re-render only if something meaningful changed */
      currentIndex = 0;
      if (allAircraft.length > 0 && aircraftKey(allAircraft[0]) !== lastRenderedKey) {
        showIndex(0);
      }
    } else if (allAircraft.length > 0 && cycleTimer === null) {
      startCycle();
    } else if (cycleTimer !== null && allAircraft.length > 0) {
      /* Cycle running — refresh data in place if current aircraft changed */
      const safeIdx = Math.min(currentIndex, allAircraft.length - 1);
      if (aircraftKey(allAircraft[safeIdx]) !== lastRenderedKey) {
        showIndex(safeIdx);
      }
    }
  } catch(e) {}
}

/* ── STATIC AIRCRAFT LIST ── */
function updateTicker() {
  let countLabel;
  if (CLOSEST_ONLY) {
    countLabel = RADIUS_KM !== null
      ? (radiusFallback ? `NEAREST (NONE WITHIN ${RADIUS_KM}KM)` : `NEAREST WITHIN ${RADIUS_KM}KM`)
      : 'NEAREST AIRCRAFT';
  } else if (RADIUS_KM !== null) {
    countLabel = radiusFallback
      ? `${allAircraft.length} AIRCRAFT (NONE WITHIN ${RADIUS_KM}KM)`
      : `${allAircraft.length} WITHIN ${RADIUS_KM}KM`;
  } else {
    countLabel = allAircraft.length + ' AIRCRAFT';
  }
  document.getElementById('ac-count').textContent = countLabel;

  const items = allAircraft.slice(0, 30).map((ac, i) =>
    `<span class="ac-item${i === currentIndex ? ' active' : ''}" onclick="showIndex(${i})">${ac.flight.trim()}</span>`
  ).join('<span class="ac-sep">·</span>');
  document.getElementById('ac-list').innerHTML = items;
}

/* ── RENDER ── */
async function showIndex(idx) {
  if (!allAircraft.length) return;
  currentIndex = idx % allAircraft.length;
  const ac       = allAircraft[currentIndex];
  lastRenderedKey = aircraftKey(ac);   /* record what we're about to render */
  const icaoCode = getAirlineCode(ac.flight);

  const dbRow    = await lookupHex(ac.hex);
  const route    = await fetchRoute(ac);

  /* ── Airline name: local dict → route API → ICAO code ──────────────────
   *  Computed after route fetch so the API name is available as a fallback.
   *  This prevents unknown airlines from showing the raw 3-letter code.
   * ────────────────────────────────────────────────────────────────────── */
  const airlineName =
    AIRLINES[icaoCode]                              ||
    (route?.airline?.name || '').toUpperCase().trim() ||
    icaoCode                                        ||
    (ac.flight || '').trim();

  const countryCode = ICAO_TO_COUNTRY[icaoCode] || '';
  const reg         = (ac.r || '').trim() || (dbRow?.reg || '').trim() || ac.hex.toUpperCase();
  const typeCode    = (ac.t || '').trim() || (dbRow?.type || '').trim();
  const typeName    = dbRow?.desc ? dbRow.desc.toUpperCase() : getTypeName(typeCode);

  /* ── Flight data ── */
  const vr      = ac.baro_rate || 0;
  const vrSign  = vr > 0 ? '+' : '';
  const vrClass = vr > 100 ? 'v-green' : vr < -100 ? 'v-red' : '';
  const vsStr   = ac.baro_rate != null ? vrSign + fmt(ac.baro_rate) : '---';
  const altBaro = ac.alt_baro === 'ground' ? 'GND' : fmt(ac.alt_baro);
  const speed   = fmt(ac.gs);
  const track   = ac.track != null ? fmt(ac.track) + '°' : '---';
  const dist    = ac.r_dst ? ac.r_dst.toFixed(1) : '---';

  let status = 'EN ROUTE';
  if (ac.alt_baro === 'ground') status = 'ON GROUND';
  else if (vr >  300) status = 'CLIMBING';
  else if (vr < -300) status = 'DESCENDING';
  const statusClass = vr > 300 ? 'v-green' : vr < -300 ? 'v-red' : '';

  /* ── Route & ETA ── */
  const origin        = route?.origin?.iata_code      || route?.origin?.iata      || '';
  const dest          = route?.destination?.iata_code || route?.destination?.iata || '';
  const originCity    = abbreviateAirport(route?.origin?.name      || '');
  const destCity      = abbreviateAirport(route?.destination?.name || '');
  const originCountry = (route?.origin?.country_name      || '').toUpperCase();
  const destCountry   = (route?.destination?.country_name || '').toUpperCase();

  const rawCallsign = (ac.flight || '').trim();

  let etaStr = '---', routeDurStr = '---';
  const oLat = route?.origin?.latitude,      oLon = route?.origin?.longitude;
  const dLat = route?.destination?.latitude, dLon = route?.destination?.longitude;
  const gsKmh = (ac.gs || 0) * 1.852;
  if (oLat != null && dLat != null && ac.lat != null && gsKmh > 50) {
    const distRemain = haversineKm(ac.lat, ac.lon, dLat, dLon);
    const distTotal  = haversineKm(oLat, oLon, dLat, dLon);
    etaStr      = fmtDuration((distRemain / gsKmh) * 60);
    routeDurStr = fmtDuration((distTotal  / gsKmh) * 60);
  }

  /* ── Images ── */
  const logoUrl      = icaoCode ? `/tar1090/airline_logos/airline_logo_${icaoCode}.png` : '';
  const flagUrl      = countryCode ? `/tar1090/country_flags/country_flag_${countryCode}.png` : '';
  const flagHtml     = flagUrl
    ? `<img src="${flagUrl}" alt="${countryCode}" class="flag-img" onerror="this.style.display='none'">`
    : '';
  const logoFallback = `<div class="logo-fallback"><div>✈︎</div><div>${icaoCode || '?'}</div></div>`;

  document.getElementById('main').innerHTML = `
    <div class="fade-in">

      <div class="hero">

        <!-- Top strip: logo | airline name + callsign/type | type code flag reg -->
        <div class="hero-top">
          <div class="logo-box" id="logo-wrap">
            ${logoUrl ? `<img id="alogo" src="${logoUrl}" alt="${icaoCode}">` : logoFallback}
          </div>
          <div class="hero-identity">
            <div class="airline-name">${airlineName}</div>
            <div class="hero-sub">
              <span class="hero-callsign">${rawCallsign}</span>
            </div>
          </div>
          <div class="hero-meta">
            <div class="hero-meta-row">
              <span class="typecode-val">${typeCode || '—'}</span>
              ${flagHtml}
              <span class="reg-val">${reg}</span>
            </div>
            ${typeName ? `<div class="hero-typename">${typeName}</div>` : ''}
          </div>
        </div>

        <!-- Route centrepiece -->
        <div class="route-block">
          <div class="route-endpoint">
            <div class="route-iata${origin ? '' : ' unknown'}">${origin || '---'}</div>
            ${originCity    ? `<div class="route-city">${originCity}</div>`       : ''}
            ${originCountry ? `<div class="route-country">${originCountry}</div>` : ''}
          </div>
          <div class="route-center">
            <div class="route-line"></div>
            ${etaStr      !== '---' ? `<div class="route-eta">LANDING ${etaStr}</div>`      : ''}
            ${routeDurStr !== '---' ? `<div class="route-total">${routeDurStr} TOTAL</div>` : ''}
          </div>
          <div class="route-endpoint dest">
            <div class="route-iata${dest ? '' : ' unknown'}">${dest || '---'}</div>
            ${destCity    ? `<div class="route-city">${destCity}</div>`       : ''}
            ${destCountry ? `<div class="route-country">${destCountry}</div>` : ''}
          </div>
        </div>

      </div><!-- /hero -->

      <!-- Compact data strip -->
      <div class="data-strip">
        <div class="ds-cell">
          <div class="ds-lbl">ALTITUDE</div>
          <div class="ds-val">${altBaro} <span class="unit">FT</span></div>
        </div>
        <div class="ds-cell">
          <div class="ds-lbl">SPEED</div>
          <div class="ds-val">${speed} <span class="unit">KTS</span></div>
        </div>
        <div class="ds-cell">
          <div class="ds-lbl">TRACK</div>
          <div class="ds-val">${track}</div>
        </div>
        <div class="ds-cell">
          <div class="ds-lbl">VERT RATE</div>
          <div class="ds-val ${vrClass}">${vsStr} <span class="unit">FPM</span></div>
        </div>
        <div class="ds-cell">
          <div class="ds-lbl">STATUS</div>
          <div class="ds-val ${statusClass}">${status}</div>
        </div>
        <div class="ds-cell">
          <div class="ds-lbl">DISTANCE</div>
          <div class="ds-val">${dist} <span class="unit">KM</span></div>
        </div>
      </div>

    </div>
  `;

  if (logoUrl) {
    const img  = document.getElementById('alogo');
    const wrap = document.getElementById('logo-wrap');
    if (img) img.onerror = () => { wrap.innerHTML = logoFallback; };
  }

  updateTicker();
}

/* ── CYCLE ── */
function startCycle() {
  if (CLOSEST_ONLY) return;   /* closest mode never cycles */
  showIndex(0);
  cycleTimer = setInterval(() => {
    if (!allAircraft.length) return;
    currentIndex = (currentIndex + 1) % Math.min(allAircraft.length, 30);
    showIndex(currentIndex);
  }, CYCLE_MS);
}

/* ── INIT ── */
setInterval(fetchAircraft, FETCH_MS);
fetchAircraft();

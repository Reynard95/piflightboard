/* ── CONFIG ── */
const AIRCRAFT_JSON = '/data/aircraft.json';
const ROUTE_API     = 'http://localhost:8088';
const DB_PATH       = '/db/';
const CYCLE_MS      = 60000;   /* 60s per aircraft — minimise e-ink refreshes */

/* ── URL PARAMS ── */
const _fp          = new URLSearchParams(window.location.search);
const FOCUS_MODE   = _fp.has('focus');
const RADIUS_KM    = (() => { const v = parseFloat(_fp.get('radius')); return isFinite(v) && v > 0 ? v : null; })();
const CLOSEST_ONLY = _fp.has('closest');
const FETCH_MS     = (() => { const v = parseFloat(_fp.get('refresh')); return isFinite(v) && v >= 5 ? Math.round(v * 1000) : 10000; })();
const LIST_MODE    = _fp.has('list');

/* ── RESOLUTION SCALING (focus mode only) ────────────────────────────────────
 *  ?res=WIDTHxHEIGHT  overrides --sz-* CSS tokens for pixel-perfect sizing.
 *  The shorter edge drives the scale so portrait/landscape both work.
 * ─────────────────────────────────────────────────────────────────────────── */
if (FOCUS_MODE) {
  (function applyResolution() {
    try {
      const param = _fp.get('res');
      if (!param) return;
      const parts = param.toLowerCase().split('x');
      const w = parseInt(parts[0], 10);
      const h = parseInt(parts[1], 10);
      if (!w || !h) return;
      const s    = Math.min(w, h);
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
}

/* ── STATE ── */
let allAircraft = [], currentIndex = 0, routeCache = {}, cycleTimer = null;
let radiusFallback = false;
let lastRenderedKey = '';
let pinnedHex = null;   /* set by dashboard radar-select relay; pauses auto-cycle */

/* ── CACHE HELPERS ── */
/* Evict oldest entries when a cache exceeds MAX_ENTRIES.
   Object.keys() returns keys in insertion order in modern JS engines,
   so the first key is the oldest.                                     */
const CACHE_MAX = 300;
function cacheSet(obj, key, value) {
  obj[key] = value;
  const keys = Object.keys(obj);
  if (keys.length > CACHE_MAX) delete obj[keys[0]];
}

/* ── HELPERS ── */

function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function srcLabel(t) {
  if (!t) return '---';
  if (t.startsWith('adsb')) return 'ADS-B';
  if (t === 'mlat')          return 'MLAT';
  if (t.startsWith('tisb'))  return 'TIS-B';
  if (t.startsWith('adsr'))  return 'ADS-R';
  if (t === 'mode_s')        return 'MODE-S';
  return t.toUpperCase();
}

function getTypeName(t) {
  if (!t) return '';
  const key = t.trim().toUpperCase();
  return AC_TYPES[key] ? AC_TYPES[key].toUpperCase() : key;
}

/* Shorten full airport names for display under the IATA code */
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

/* Coarse key for change-detection — avoids unnecessary e-ink redraws */
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
    const res  = await fetch(`${DB_PATH}${prefix}.js`);
    if (!res.ok) return null;
    const data = JSON.parse(await res.text());
    cacheSet(fileCache, prefix, data);
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
      if (r) { cacheSet(routeCache, cs, r); return r; }
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
      if (r) { cacheSet(routeCache, cs, r); return r; }
    }
  } catch(e) {}

  return null;
}

/* ── FETCH AIRCRAFT.JSON ── */
async function fetchAircraft() {
  try {
    const res  = await fetch(AIRCRAFT_JSON + '?_=' + Date.now());
    const data = await res.json();

    const base = (data.aircraft || [])
      .filter(a => a.lat && a.lon && a.flight && a.flight.trim())
      .map(a => ({ ...a, _distKm: a.r_dst != null ? a.r_dst * 1.852 : null }))
      .sort((a, b) => (b.rssi || -99) - (a.rssi || -99));

    let filtered = base;
    radiusFallback = false;

    if (RADIUS_KM !== null) {
      const nearby = base.filter(a => a._distKm != null && a._distKm <= RADIUS_KM);
      if (nearby.length > 0) {
        filtered = nearby;
      } else {
        filtered = base;
        radiusFallback = true;
      }
    }

    if (CLOSEST_ONLY) {
      const withDist = filtered.filter(a => a._distKm != null).sort((a, b) => a._distKm - b._distKm);
      filtered = withDist.length > 0 ? [withDist[0]] : filtered.slice(0, 1);
    }

    allAircraft = filtered;
    updateTicker();

    if (LIST_MODE) {
      renderList();
    } else if (pinnedHex) {
      /* Dashboard has a selected aircraft — keep it pinned */
      const idx = allAircraft.findIndex(a => a.hex === pinnedHex);
      if (idx !== -1) {
        if (aircraftKey(allAircraft[idx]) !== lastRenderedKey) showIndex(idx);
      } else {
        /* Pinned aircraft has left range — fall back to normal cycle */
        pinnedHex = null;
        if (!CLOSEST_ONLY && cycleTimer === null) startCycle();
      }
    } else if (CLOSEST_ONLY) {
      currentIndex = 0;
      if (allAircraft.length > 0 && aircraftKey(allAircraft[0]) !== lastRenderedKey) {
        showIndex(0);
      }
    } else if (allAircraft.length > 0 && cycleTimer === null) {
      startCycle();
    } else if (cycleTimer !== null && allAircraft.length > 0) {
      const safeIdx = Math.min(currentIndex, allAircraft.length - 1);
      if (aircraftKey(allAircraft[safeIdx]) !== lastRenderedKey) {
        showIndex(safeIdx);
      }
    }
    try { window.parent.postMessage({ type: 'panel-status', panel: 'flight', ok: true }, '*'); } catch (_) {}
  } catch(e) {}
}

/* ── TICKER / AIRCRAFT LIST ── */
function updateTicker() {
  let countLabel;
  if (CLOSEST_ONLY) {
    countLabel = RADIUS_KM !== null
      ? (radiusFallback ? `NEAREST (NONE IN ${RADIUS_KM}KM)` : `NEAREST <${RADIUS_KM}KM`)
      : 'NEAREST';
  } else if (RADIUS_KM !== null) {
    countLabel = radiusFallback
      ? `${allAircraft.length} AC (NONE IN ${RADIUS_KM}KM)`
      : `${allAircraft.length} AC <${RADIUS_KM}KM`;
  } else {
    countLabel = allAircraft.length + ' AC';
  }
  document.getElementById('ac-count').textContent = countLabel;

  const items = allAircraft.slice(0, 30).map((ac, i) =>
    `<span class="ac-item${i === currentIndex ? ' active' : ''}" onclick="showIndex(${i})">${ac.flight.trim()}</span>`
  ).join('<span class="ac-sep">·</span>');
  document.getElementById('ac-list').innerHTML = items;
}

/* ── LIST VIEW ── */
function renderList() {
  const container = document.getElementById('main');
  if (!allAircraft.length) {
    container.innerHTML = '<div class="no-signal"><div class="no-signal-title">SCANNING...</div><div class="no-signal-sub">✈︎ AWAITING AIRCRAFT DATA ✈︎</div></div>';
    return;
  }
  const rows = allAircraft.slice(0, 60).map((ac, i) => {
    const cs       = (ac.flight || '').trim();
    const icaoCode = getAirlineCode(cs);
    const airline  = (AIRLINES[icaoCode] || icaoCode || cs).slice(0, 14);
    const alt      = ac.alt_baro === 'ground' ? 'GND'
                   : ac.alt_baro != null ? String(Math.round(ac.alt_baro / 100) * 100)
                   : '---';
    const spd    = ac.gs != null ? String(Math.round(ac.gs)) : '---';
    const vr     = ac.baro_rate || 0;
    const vrCls  = vr > 100 ? 'v-green' : vr < -100 ? 'v-red' : '';
    const vrSym  = vr > 100 ? '▲' : vr < -100 ? '▼' : '—';
    const dist   = ac._distKm != null ? ac._distKm.toFixed(0) : '---';
    const cached = routeCache[cs];
    const origin = cached?.origin?.iata_code || cached?.origin?.iata || '---';
    const dest   = cached?.destination?.iata_code || cached?.destination?.iata || '---';
    return `<tr>
      <td class="acl-cs">${escHtml(cs)}</td>
      <td class="acl-al">${escHtml(airline)}</td>
      <td class="acl-route">${escHtml(origin)}<span class="acl-arrow">▶</span>${escHtml(dest)}</td>
      <td class="acl-num">${escHtml(alt)}</td>
      <td class="acl-num">${escHtml(spd)}</td>
      <td class="acl-vr ${vrCls}">${vrSym}</td>
      <td class="acl-num">${escHtml(dist)}</td>
    </tr>`;
  }).join('');
  container.innerHTML =
    '<div class="ac-list-view"><table class="ac-table">' +
    '<thead><tr>' +
    '<th>FLIGHT</th><th>AIRLINE</th><th>ROUTE</th>' +
    '<th class="acl-num">ALT</th><th class="acl-num">SPD</th><th>V/R</th><th class="acl-num">DIST</th>' +
    '</tr></thead>' +
    '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

/* ── RENDER — dispatches to full or focus layout ── */
async function showIndex(idx) {
  if (!allAircraft.length) return;
  currentIndex = idx % allAircraft.length;
  const ac = allAircraft[currentIndex];
  lastRenderedKey = aircraftKey(ac);

  const icaoCode = getAirlineCode(ac.flight);
  const dbRow    = await lookupHex(ac.hex);
  const route    = await fetchRoute(ac);

  /* Airline name: local dict → route API → ICAO code → raw callsign */
  const airlineName =
    AIRLINES[icaoCode]                               ||
    (route?.airline?.name || '').toUpperCase().trim() ||
    icaoCode                                         ||
    (ac.flight || '').trim();

  const countryCode = ICAO_TO_COUNTRY[icaoCode] || '';
  const reg         = (ac.r || '').trim() || (dbRow?.reg || '').trim() || ac.hex.toUpperCase();
  const typeCode    = (ac.t || '').trim() || (dbRow?.type || '').trim();
  const typeName    = dbRow?.desc ? dbRow.desc.toUpperCase() : getTypeName(typeCode);

  const vr      = ac.baro_rate || 0;
  const vrSign  = vr > 0 ? '+' : '';
  const vrClass = vr > 100 ? 'v-green' : vr < -100 ? 'v-red' : '';
  const vsStr   = ac.baro_rate != null ? vrSign + fmt(ac.baro_rate) : '---';
  const altBaro = ac.alt_baro === 'ground' ? 'GND' : fmt(ac.alt_baro);
  const speed   = fmt(ac.gs);
  const track   = ac.track != null ? fmt(ac.track) + '°' : '---';
  const dist    = ac._distKm != null ? ac._distKm.toFixed(1) : '---';

  let status = 'EN ROUTE';
  if (ac.alt_baro === 'ground') status = 'ON GND';
  else if (vr >  300) status = 'CLIMBING';
  else if (vr < -300) status = 'DESCEND';
  const statusClass = vr > 300 ? 'v-green' : vr < -300 ? 'v-red' : '';

  const origin = route?.origin?.iata_code      || route?.origin?.iata      || '';
  const dest   = route?.destination?.iata_code || route?.destination?.iata || '';

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

  const logoUrl      = icaoCode ? `/airline_logos/airline_logo_${icaoCode}.png` : '';
  const flagUrl      = countryCode ? `/country_flags/country_flag_${countryCode}.png` : '';
  const flagHtml     = flagUrl
    ? `<img src="${flagUrl}" alt="${countryCode}" class="flag-img" onerror="this.style.display='none'">`
    : '';
  const logoFallback = `<img src="/images/plane.svg" class="plane-logo" alt="aircraft">`;

  if (FOCUS_MODE) {
    renderFocus({ ac, airlineName, rawCallsign: (ac.flight || '').trim(), typeCode, typeName,
                  flagHtml, logoUrl, logoFallback, origin, dest, route,
                  etaStr, routeDurStr, altBaro, speed, track, vsStr, vrClass,
                  status, statusClass, dist });
  } else {
    renderFull({ ac, airlineName, icaoCode, countryCode, typeCode, typeName,
                 flagHtml, logoUrl, logoFallback, origin, dest, route,
                 etaStr, routeDurStr, altBaro, speed, track, vsStr, vrClass,
                 status, statusClass, dist, vr });
  }

  updateTicker();
}

/* ── FULL LAYOUT ── */
function renderFull({ ac, airlineName, icaoCode, countryCode, typeCode, typeName,
                      flagHtml, logoUrl, logoFallback, origin, dest, route,
                      etaStr, routeDurStr, altBaro, speed, track, vsStr, vrClass,
                      status, statusClass, dist, vr }) {
  const rawCallsign = (ac.flight || '').trim();

  const mach     = ac.mach     != null ? ac.mach.toFixed(3)                       : '---';
  const lat      = ac.lat      != null ? ac.lat.toFixed(3) + '°'                  : '--°';
  const lon      = ac.lon      != null ? ac.lon.toFixed(3) + '°'                  : '--°';
  const ias      = ac.ias      != null ? fmt(ac.ias) + ' KTS'                      : '---';
  const rssi     = ac.rssi     != null ? ac.rssi.toFixed(1) + ' dBFS'             : '---';
  const squawk   = ac.squawk   || '----';
  const wind     = (ac.wd != null && ac.ws != null) ? `${fmt(ac.wd)}° / ${fmt(ac.ws)} KTS` : '---';
  const oat      = ac.oat      != null ? ac.oat.toFixed(1) + ' °C'                : '---';
  const navHdg   = ac.nav_heading != null ? fmt(ac.nav_heading) + '°'             : '---';
  const msgCount = ac.messages != null ? ac.messages.toLocaleString()             : '---';
  const seen     = ac.seen     != null ? ac.seen.toFixed(1) + 'S AGO'             : '---';
  const source   = srcLabel(ac.type);
  const squawkClass = ['7700','7500'].includes(squawk) ? 'v-red' : squawk === '7600' ? 'v-blue' : '';

  const airlineIata  = route?.airline?.iata || ICAO_TO_IATA[icaoCode] || '';
  const flightSuffix = icaoCode ? rawCallsign.replace(new RegExp('^' + icaoCode, 'i'), '').trim() : '';
  const derived      = (airlineIata && airlineIata !== icaoCode && flightSuffix) ? airlineIata + flightSuffix : '';
  const apiIata      = route?.callsign_iata || '';
  const iataFlight   = (apiIata && apiIata !== rawCallsign) ? apiIata : derived;

  const eAirline     = escHtml(airlineName);
  const eTypeCode    = escHtml(typeCode || '—');
  const eTypeName    = escHtml(typeName || '—');
  const eCallsign    = escHtml(rawCallsign);
  const eIataFlight  = iataFlight ? escHtml(iataFlight) : '';
  const eReg         = escHtml(reg);
  const eOrigin      = escHtml(origin || '---');
  const eDest        = escHtml(dest || '---');

  document.getElementById('main').innerHTML = `
    <div class="fade-in">

      <div class="ac-header">
        <div class="logo-box" id="logo-wrap">
          ${logoUrl ? `<img id="alogo" src="${escHtml(logoUrl)}" alt="${escHtml(icaoCode || '')}" onerror="this.src='/images/plane.svg';this.onerror=null;">` : logoFallback}
        </div>
        <div class="ac-identity">
          <div class="ac-topinfo">
            <span class="typecode-val">${eTypeCode}</span>
            ${flagHtml}
            <span class="reg-val">${eCallsign}</span>
          </div>
          <div class="ac-row">
            <div class="airline-val">${eAirline}</div>
            <div class="ac-route">
              <span class="route-apt${origin ? '' : ' unknown'}">${eOrigin}</span>
              <span class="route-arrow"> &#x25B6; </span>
              <span class="route-apt${dest ? '' : ' unknown'}">${eDest}</span>
            </div>
          </div>
          <div class="ac-row">
            <div class="callsign-val">${eCallsign}${eIataFlight ? ' — ' + eIataFlight : ''}</div>
            ${etaStr !== '---' ? `<div class="route-dur-line">LDG ${etaStr}</div>` : '<div></div>'}
          </div>
          <div class="ac-row">
            <div class="ac-type-line">${eTypeName}</div>
            ${routeDurStr !== '---' ? `<div class="route-dur-line">${routeDurStr} TOT</div>` : '<div></div>'}
          </div>
        </div>
      </div>

      <div class="data-grid">
        <div class="data-row"><div class="data-label">TRK</div><div class="data-value">${track}</div></div>
        <div class="data-row"><div class="data-label">ALT</div><div class="data-value">${altBaro} <span class="unit">FT</span></div></div>
        <div class="data-row"><div class="data-label">MACH</div><div class="data-value">${mach}</div></div>
        <div class="data-row"><div class="data-label">LAT</div><div class="data-value">${lat}</div></div>
        <div class="data-row"><div class="data-label">DIST</div><div class="data-value">${dist} <span class="unit">KM</span></div></div>
        <div class="data-row"><div class="data-label">SPD</div><div class="data-value">${speed} <span class="unit">KTS</span></div></div>
        <div class="data-row"><div class="data-label">LON</div><div class="data-value">${lon}</div></div>
        <div class="data-row"><div class="data-label">V/R</div><div class="data-value ${vrClass}">${vsStr} <span class="unit">FPM</span></div></div>
        <div class="data-row"><div class="data-label">STATUS</div><div class="data-value ${statusClass}">${status}</div></div>
      </div>

      <div class="telem-row">
        <div class="telem-cell"><div class="telem-lbl">SRC</div><div class="telem-val">${source}</div></div>
        <div class="telem-cell"><div class="telem-lbl">SIG</div><div class="telem-val">${rssi}</div></div>
        <div class="telem-cell"><div class="telem-lbl">SQK</div><div class="telem-val ${squawkClass}">${squawk}</div></div>
        <div class="telem-cell"><div class="telem-lbl">IAS</div><div class="telem-val">${ias}</div></div>
        <div class="telem-cell"><div class="telem-lbl">WIND</div><div class="telem-val">${wind}</div></div>
        <div class="telem-cell"><div class="telem-lbl">OAT</div><div class="telem-val">${oat}</div></div>
        <div class="telem-cell"><div class="telem-lbl">HDG</div><div class="telem-val">${navHdg}</div></div>
        <div class="telem-cell"><div class="telem-lbl">MSGS</div><div class="telem-val">${msgCount}</div></div>
        <div class="telem-cell"><div class="telem-lbl">SEEN</div><div class="telem-val">${seen}</div></div>
      </div>

    </div>
  `;

  if (logoUrl) {
    const img  = document.getElementById('alogo');
    const wrap = document.getElementById('logo-wrap');
    if (img) img.onerror = () => { wrap.innerHTML = logoFallback; };
  }
}

/* ── FOCUS LAYOUT ── */
function renderFocus({ ac, airlineName, rawCallsign, typeCode, typeName,
                       flagHtml, logoUrl, logoFallback, origin, dest, route,
                       etaStr, routeDurStr, altBaro, speed, track, vsStr, vrClass,
                       status, statusClass, dist }) {
  const originCity    = abbreviateAirport(route?.origin?.name      || '');
  const destCity      = abbreviateAirport(route?.destination?.name || '');
  const originCountry = (route?.origin?.country_name      || '').toUpperCase();
  const destCountry   = (route?.destination?.country_name || '').toUpperCase();

  const fEAirline      = escHtml(airlineName);
  const fECallsign     = escHtml(rawCallsign);
  const fETypeCode     = escHtml(typeCode || '—');
  const fETypeName     = typeName ? escHtml(typeName) : '';
  const fEReg          = escHtml((ac.r || '').trim() || ac.hex.toUpperCase());
  const fEOrigin       = escHtml(origin || '---');
  const fEDest         = escHtml(dest || '---');
  const fEOriginCity   = escHtml(originCity);
  const fEOriginCountry = escHtml(originCountry);
  const fEDestCity     = escHtml(destCity);
  const fEDestCountry  = escHtml(destCountry);

  document.getElementById('main').innerHTML = `
    <div class="fade-in">

      <div class="hero">

        <div class="hero-top">
          <div class="logo-box" id="logo-wrap">
            ${logoUrl ? `<img id="alogo" src="${escHtml(logoUrl)}" alt="${escHtml(typeCode || '')}">` : logoFallback}
          </div>
          <div class="hero-identity">
            <div class="airline-name">${fEAirline}</div>
            <div class="hero-sub">
              <span class="hero-callsign">${fECallsign}</span>
            </div>
          </div>
          <div class="hero-meta">
            <div class="hero-meta-row">
              <span class="typecode-val">${fETypeCode}</span>
              ${flagHtml}
              <span class="reg-val">${fEReg}</span>
            </div>
            ${fETypeName ? `<div class="hero-typename">${fETypeName}</div>` : ''}
          </div>
        </div>

        <div class="route-block">
          <div class="route-endpoint">
            <div class="route-iata${origin ? '' : ' unknown'}">${fEOrigin}</div>
            ${fEOriginCity    ? `<div class="route-city">${fEOriginCity}</div>`       : ''}
            ${fEOriginCountry ? `<div class="route-country">${fEOriginCountry}</div>` : ''}
          </div>
          <div class="route-center">
            <div class="route-line"></div>
            ${etaStr      !== '---' ? `<div class="route-eta">LDG ${etaStr}</div>`        : ''}
            ${routeDurStr !== '---' ? `<div class="route-total">${routeDurStr} TOT</div>` : ''}
          </div>
          <div class="route-endpoint dest">
            <div class="route-iata${dest ? '' : ' unknown'}">${fEDest}</div>
            ${fEDestCity    ? `<div class="route-city">${fEDestCity}</div>`       : ''}
            ${fEDestCountry ? `<div class="route-country">${fEDestCountry}</div>` : ''}
          </div>
        </div>

      </div>

      <div class="data-strip">
        <div class="ds-cell"><div class="ds-lbl">ALT</div><div class="ds-val">${altBaro} <span class="unit">FT</span></div></div>
        <div class="ds-cell"><div class="ds-lbl">SPD</div><div class="ds-val">${speed} <span class="unit">KTS</span></div></div>
        <div class="ds-cell"><div class="ds-lbl">TRK</div><div class="ds-val">${track}</div></div>
        <div class="ds-cell"><div class="ds-lbl">V/R</div><div class="ds-val ${vrClass}">${vsStr} <span class="unit">FPM</span></div></div>
        <div class="ds-cell"><div class="ds-lbl">STATUS</div><div class="ds-val ${statusClass}">${status}</div></div>
        <div class="ds-cell"><div class="ds-lbl">DIST</div><div class="ds-val">${dist} <span class="unit">KM</span></div></div>
      </div>

    </div>
  `;

  if (logoUrl) {
    const img  = document.getElementById('alogo');
    const wrap = document.getElementById('logo-wrap');
    if (img) img.onerror = () => { wrap.innerHTML = logoFallback; };
  }
}

/* ── CYCLE ── */
function startCycle() {
  if (CLOSEST_ONLY || LIST_MODE) return;
  /* Resume from currentIndex so unpin/re-pin doesn't jump back to aircraft #0 */
  showIndex(currentIndex);
  cycleTimer = setInterval(() => {
    if (!allAircraft.length) return;
    currentIndex = (currentIndex + 1) % Math.min(allAircraft.length, 30);
    showIndex(currentIndex);
  }, CYCLE_MS);
}

/* ── RADAR SYNC — dashboard relays radar-select here ── */
window.addEventListener('message', e => {
  if (e.data?.type !== 'select-aircraft') return;
  pinnedHex = e.data.hex || null;

  if (pinnedHex) {
    /* Pause auto-cycle and jump straight to the selected aircraft */
    clearInterval(cycleTimer);
    cycleTimer = null;
    const idx = allAircraft.findIndex(a => a.hex === pinnedHex);
    if (idx !== -1) showIndex(idx);
  } else {
    /* Radar deselected — resume normal cycle from where we are */
    if (!CLOSEST_ONLY && allAircraft.length > 0 && cycleTimer === null) {
      startCycle();
    }
  }
});

/* ── INIT ── */
setInterval(fetchAircraft, FETCH_MS);
fetchAircraft();

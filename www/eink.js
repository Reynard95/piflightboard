/* ── CONFIG ── */
const AIRCRAFT_JSON = '/tar1090/data/aircraft.json';
const ROUTE_API     = 'http://flighttracker.local:8088';
const DB_PATH       = '/tar1090/db-28a5940/';
const CYCLE_MS      = 20000;   /* slightly longer cycle for e-ink */
const FETCH_MS      = 5000;

/* ── STATE ── */
let allAircraft = [], currentIndex = 0, routeCache = {}, cycleTimer = null;

/* ── CLOCK ── */
function tick() {
  document.getElementById('clock').textContent = new Date().toTimeString().slice(0, 8);
}
setInterval(tick, 1000); tick();

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
    allAircraft = (data.aircraft || [])
      .filter(a => a.lat && a.lon && a.flight && a.flight.trim())
      .sort((a, b) => (b.rssi || -99) - (a.rssi || -99));
    updateTicker();
    if (allAircraft.length > 0 && cycleTimer === null) startCycle();
  } catch(e) {}
}

/* ── TICKER ── */
function updateTicker() {
  document.getElementById('ac-count').textContent = allAircraft.length + ' AIRCRAFT';
  const items = allAircraft.slice(0, 30).map((ac, i) =>
    `<span class="ticker-item${i === currentIndex ? ' active' : ''}" onclick="showIndex(${i})">${ac.flight.trim()}</span><span class="ticker-sep"> ◆ </span>`
  ).join('');
  document.getElementById('ticker').innerHTML = items + items;
}

/* ── RENDER ── */
async function showIndex(idx) {
  if (!allAircraft.length) return;
  currentIndex = idx % allAircraft.length;
  const ac          = allAircraft[currentIndex];
  const icaoCode    = getAirlineCode(ac.flight);
  const countryCode = ICAO_TO_COUNTRY[icaoCode] || '';
  const airlineName = AIRLINES[icaoCode] || icaoCode || (ac.flight || '').trim();

  const dbRow    = await lookupHex(ac.hex);
  const reg      = (ac.r || '').trim() || (dbRow?.reg || '').trim() || ac.hex.toUpperCase();
  const typeCode = (ac.t || '').trim() || (dbRow?.type || '').trim();
  const typeName = dbRow?.desc ? dbRow.desc.toUpperCase() : getTypeName(typeCode);

  const route = await fetchRoute(ac);

  const vr       = ac.baro_rate || 0;
  const vrSign   = vr > 0 ? '+' : '';
  const vrClass  = vr > 100 ? 'v-green' : vr < -100 ? 'v-red' : '';
  const vsStr    = ac.baro_rate != null ? vrSign + fmt(ac.baro_rate) : '---';
  const altBaro  = ac.alt_baro === 'ground' ? 'GND' : fmt(ac.alt_baro);
  const speed    = fmt(ac.gs);
  const ias      = ac.ias      != null ? fmt(ac.ias) + ' KTS'          : '---';
  const mach     = ac.mach     != null ? ac.mach.toFixed(3)            : '---';
  const track    = ac.track    != null ? fmt(ac.track) + '°'           : '---';
  const dist     = ac.r_dst               ? ac.r_dst.toFixed(1)        : '---';
  const lat      = ac.lat      != null ? ac.lat.toFixed(3) + '°'       : '--°';
  const lon      = ac.lon      != null ? ac.lon.toFixed(3) + '°'       : '--°';
  const rssi     = ac.rssi     != null ? ac.rssi.toFixed(1) + ' dBFS'  : '---';
  const source   = srcLabel(ac.type);
  const squawk   = ac.squawk || '----';
  const wind     = (ac.wd != null && ac.ws != null) ? `${fmt(ac.wd)}° / ${fmt(ac.ws)} KTS` : '---';
  const oat      = ac.oat      != null ? ac.oat.toFixed(1) + ' °C'     : '---';
  const navHdg   = ac.nav_heading != null ? fmt(ac.nav_heading) + '°'  : '---';
  const msgCount = ac.messages != null ? ac.messages.toLocaleString()  : '---';
  const seen     = ac.seen     != null ? ac.seen.toFixed(1) + 'S AGO'  : '---';

  let status = 'EN ROUTE';
  if (ac.alt_baro === 'ground') status = 'ON GROUND';
  else if (vr >  300) status = 'CLIMBING';
  else if (vr < -300) status = 'DESCENDING';

  const origin = route?.origin?.iata_code || route?.origin?.iata || '';
  const dest   = route?.destination?.iata_code || route?.destination?.iata || '';

  const rawCallsign  = (ac.flight || '').trim();
  const airlineIata  = route?.airline?.iata || ICAO_TO_IATA[icaoCode] || '';
  const flightSuffix = icaoCode ? rawCallsign.replace(new RegExp('^' + icaoCode, 'i'), '').trim() : '';
  const derived      = (airlineIata && airlineIata !== icaoCode && flightSuffix) ? airlineIata + flightSuffix : '';
  const apiIata      = route?.callsign_iata || '';
  const iataFlight   = (apiIata && apiIata !== rawCallsign) ? apiIata : derived;

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

  const logoUrl      = icaoCode ? `/tar1090/airline_logos/airline_logo_${icaoCode}.png` : '';
  const flagUrl      = countryCode ? `/tar1090/country_flags/country_flag_${countryCode}.png` : '';
  const flagHtml     = flagUrl
    ? `<img src="${flagUrl}" alt="${countryCode}" class="flag-img" onerror="this.style.display='none'">`
    : '';
  const logoFallback = `<div class="logo-fallback"><div>✈︎</div><div>${(icaoCode || '?')}</div></div>`;

  const squawkClass = ['7700','7500'].includes(squawk) ? 'v-red' : squawk === '7600' ? 'v-blue' : '';

  const statusClass = vr > 300 ? 'v-green' : vr < -300 ? 'v-red' : '';

  document.getElementById('main').innerHTML = `
    <div class="fade-in">

      <div class="ac-header">
        <div class="logo-box" id="logo-wrap">
          ${logoUrl ? `<img id="alogo" src="${logoUrl}" alt="${icaoCode}">` : logoFallback}
        </div>
        <div class="ac-identity">
          <div class="ac-topinfo">
            <span class="typecode-val">${typeCode || '—'}</span>
            ${flagHtml}
            <span class="reg-val">${reg}</span>
          </div>
          <div class="ac-row">
            <div class="airline-val">${airlineName}</div>
            <div class="ac-route">
              <span class="route-apt${origin ? '' : ' unknown'}">${origin || '---'}</span>
              <span class="route-arrow"> &#x25B6; </span>
              <span class="route-apt${dest ? '' : ' unknown'}">${dest || '---'}</span>
            </div>
          </div>
          <div class="ac-row">
            <div class="callsign-val">${rawCallsign}${iataFlight ? ' — ' + iataFlight : ''}</div>
            ${etaStr !== '---' ? `<div class="route-dur-line">LANDING ${etaStr}</div>` : '<div></div>'}
          </div>
          <div class="ac-row">
            <div class="ac-type-line">${typeName || '—'}</div>
            ${routeDurStr !== '---' ? `<div class="route-dur-line">${routeDurStr} TOTAL</div>` : '<div></div>'}
          </div>
        </div>
      </div>

      <div class="data-grid">
        <div class="data-row">
          <div class="data-label">TRACK</div>
          <div class="data-value">${track}</div>
        </div>
        <div class="data-row">
          <div class="data-label">ALTITUDE</div>
          <div class="data-value">${altBaro} <span class="unit">FT</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">MACH</div>
          <div class="data-value">${mach}</div>
        </div>
        <div class="data-row">
          <div class="data-label">LAT</div>
          <div class="data-value">${lat}</div>
        </div>
        <div class="data-row">
          <div class="data-label">DISTANCE</div>
          <div class="data-value">${dist} <span class="unit">KM</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">SPEED</div>
          <div class="data-value">${speed} <span class="unit">KTS</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">LON</div>
          <div class="data-value">${lon}</div>
        </div>
        <div class="data-row">
          <div class="data-label">VERT RATE</div>
          <div class="data-value ${vrClass}">${vsStr} <span class="unit">FPM</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">STATUS</div>
          <div class="data-value ${statusClass}">${status}</div>
        </div>
      </div>

      <div class="telem-row">
        <div class="telem-cell"><div class="telem-lbl">SOURCE</div><div class="telem-val">${source}</div></div>
        <div class="telem-cell"><div class="telem-lbl">SIGNAL</div><div class="telem-val">${rssi}</div></div>
        <div class="telem-cell"><div class="telem-lbl">SQUAWK</div><div class="telem-val ${squawkClass}">${squawk}</div></div>
        <div class="telem-cell"><div class="telem-lbl">IAS</div><div class="telem-val">${ias}</div></div>
        <div class="telem-cell"><div class="telem-lbl">WIND</div><div class="telem-val">${wind}</div></div>
        <div class="telem-cell"><div class="telem-lbl">OAT</div><div class="telem-val">${oat}</div></div>
        <div class="telem-cell"><div class="telem-lbl">NAV HDG</div><div class="telem-val">${navHdg}</div></div>
        <div class="telem-cell"><div class="telem-lbl">MSGS</div><div class="telem-val">${msgCount}</div></div>
        <div class="telem-cell"><div class="telem-lbl">LAST SEEN</div><div class="telem-val">${seen}</div></div>
      </div>

    </div>
  `;

  if (logoUrl) {
    const img  = document.getElementById('alogo');
    const wrap = document.getElementById('logo-wrap');
    if (img) img.onerror = () => { wrap.innerHTML = logoFallback; };
  }

  updateTicker();
  resetProgress();
}

/* ── CYCLE ── */
function resetProgress() {
  const bar = document.getElementById('progress');
  bar.style.transition = 'none';
  bar.style.width = '0%';
  requestAnimationFrame(() => {
    bar.style.transition = `width ${CYCLE_MS}ms linear`;
    bar.style.width = '100%';
  });
}

function startCycle() {
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

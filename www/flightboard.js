/* ── CONFIG ── */
const AIRCRAFT_JSON = '/tar1090/data/aircraft.json';
const ROUTE_API     = 'http://flighttracker.local:8088';
const DB_PATH       = '/tar1090/db-28a5940/';
const CYCLE_MS      = 15000;
const FETCH_MS      = 5000;

/* ── STATE ── */
let allAircraft = [], currentIndex = 0, routeCache = {}, cycleTimer = null;

/* ── CLOCK ── */
function tick() {
  const n = new Date();
  document.getElementById('clock').textContent = n.toTimeString().slice(0, 8);
  document.getElementById('date-line').textContent =
    n.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }).toUpperCase();
}
setInterval(tick, 1000); tick();

/* ── HELPERS ── */
function fmt(v, d = 0) {
  if (v == null || isNaN(v)) return '---';
  return Number(v).toLocaleString('en-GB', { maximumFractionDigits: d, minimumFractionDigits: d });
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

  /* tar1090 db files use variable-length prefixes.
     Try longest first: 3-char, 2-char, 1-char.
     Files are plain JSON objects: {"HEXCODE":["reg","type","flags","desc"]} */
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

/* ── ROUTE PROXY ── */
async function fetchRoute(ac) {
  const cs = (ac.flight || '').trim();
  if (!cs || routeCache[cs] !== undefined) return routeCache[cs] || null;
  routeCache[cs] = null;
  try {
    const res = await fetch(ROUTE_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ icao: ac.hex, callsign: cs, lat: ac.lat || 0, lng: ac.lon || 0, postime: Date.now() })
    });
    if (!res.ok) return null;
    const data = await res.json();
    const r = data?.route?.[0];
    if (r) { routeCache[cs] = r; return r; }
  } catch(e) {}
  return null;
}

/* ── FETCH AIRCRAFT.JSON ── */
async function fetchAircraft() {
  try {
    const res  = await fetch(AIRCRAFT_JSON + '?_=' + Date.now());
    const data = await res.json();
    document.getElementById('msg-count').textContent = 'MESSAGES: ' + (data.messages || 0).toLocaleString();
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

  /* DB lookup for registration and type */
  const dbRow    = await lookupHex(ac.hex);
  const reg      = (ac.r || '').trim() || (dbRow?.reg || '').trim() || ac.hex.toUpperCase();
  const typeCode = (ac.t || '').trim() || (dbRow?.type || '').trim();
  const typeName = dbRow?.desc ? dbRow.desc.toUpperCase() : getTypeName(typeCode);

  const route = await fetchRoute(ac);

  /* Flight data */
  const vr       = ac.baro_rate || 0;
  const vrSign   = vr > 0 ? '+' : '';
  const vrClass  = vr > 100 ? 'v-green' : vr < -100 ? 'v-red' : '';
  const vsStr    = ac.baro_rate != null ? vrSign + fmt(ac.baro_rate) : '---';
  const altBaro  = ac.alt_baro === 'ground' ? 'GND' : fmt(ac.alt_baro);
  const speed    = fmt(ac.gs);
  const ias      = ac.ias      != null ? fmt(ac.ias) + ' KTS'          : '---';
  const mach     = ac.mach     != null ? ac.mach.toFixed(3)            : '---';
  const track    = ac.track    != null ? fmt(ac.track) + '°'           : '---';
  const dist     = ac.r_dst               ? ac.r_dst.toFixed(1) + ' KM': '---';
  const lat      = ac.lat      != null ? ac.lat.toFixed(3)             : '--°';
  const lon      = ac.lon      != null ? ac.lon.toFixed(3)             : '--°';
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

  const origin = route?.origin?.iata || '';
  const dest   = route?.destination?.iata || '';

  /* IATA flight number: swap ICAO prefix for IATA prefix, keep numeric suffix */
  const rawCallsign  = (ac.flight || '').trim();
  const iataPrefix   = route?.airline?.iata || ICAO_TO_IATA[icaoCode] || '';
  const flightSuffix = icaoCode
    ? rawCallsign.replace(new RegExp('^' + icaoCode, 'i'), '')
    : rawCallsign.replace(/^[A-Z]{2,3}/i, '');
  const iataFlight   = iataPrefix && flightSuffix ? (iataPrefix + flightSuffix) : '—--';
  
  /* Local assets */
  const logoUrl      = icaoCode ? `/tar1090/airline_logos/airline_logo_${icaoCode}.png` : '';
  const flagUrl      = countryCode ? `/tar1090/country_flags/country_flag_${countryCode}.png` : '';
  const flagHtml     = flagUrl
    ? `<img src="${flagUrl}" alt="${countryCode}" style="height:42px;width:auto;vertical-align:middle;border-radius:2px;" onerror="this.style.display='none'">`
    : '';
  const logoFallback = `<div>
                          <span class="tlogo-fallback">✈︎</span>
                          <span class="tlogo-fallback">✈${(icaoCode || '?')}</span>
                        </div>`;

  const squawkClass = ['7700','7500'].includes(squawk) ? 'v-red' : squawk === '7600' ? 'v-blue' : '';

  document.getElementById('main').innerHTML = `
    <div class="fade-in">

      <div class="ac-header">
        <div class="logo-box" id="logo-wrap">
          ${logoUrl ? `<img id="alogo" src="${logoUrl}" alt="${icaoCode}">` : logoFallback}
        </div>
        <div class="ac-identity">
          <div class="ac-top-row">
            <div class="ac-topinfo">
              <span class="typecode-val">${typeCode || '—'}</span>
              <span class="reg-val">${reg}</span>
              ${flagHtml}
            </div>
            <div class="ac-route">
              <span class="route-apt${origin ? '' : ' unknown'}">${origin || '---'}</span>
              <span class="route-arrow"> &#x25B6; </span>
              <span class="route-apt${dest ? '' : ' unknown'}">${dest || '---'}</span>
            </div>
          </div>
          <div class="airline-call-row">
            <span class="airline-val">${airlineName}</span>
            <span class="sep-val">&#x2014;</span>
            <span class="callsign-val">${rawCallsign}</span>
          </div>
          <div class="ac-type-line">${typeName || '—'}</div>
          <div class="ac-flight-line">FLIGHT: ${iataFlight}</div>
        </div>
      </div>

      <div class="data-grid">
        <div class="data-row">
          <div class="data-label">TRACK</div>
          <div class="data-value v-blue">${track}</div>
        </div>
        <div class="data-row">
          <div class="data-label">ALTITUDE</div>
          <div class="data-value">${altBaro} <span class="unit">FT</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">STATUS</div>
          <div class="data-value v-gold">${status}</div>
        </div>
        <div class="data-row">
          <div class="data-label">DISTANCE</div>
          <div class="data-value v-pink">${dist}</div>
        </div>
        <div class="data-row">
          <div class="data-label">SPEED</div>
          <div class="data-value">${speed} <span class="unit">KTS</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">VERT RATE</div>
          <div class="data-value ${vrClass}">${vsStr} <span class="unit">FPM</span></div>
        </div>
        <div class="data-row">
          <div class="data-label">MACH</div>
          <div class="data-value">${mach}</div>
        </div>
        <div class="data-row">
          <div class="data-label">LAT</div>
          <div class="data-value">${lat}<span class="unit">°</span></div></div>
        </div>
        <div class="data-row">
          <div class="data-label">LON</div>
          <div class="data-value">${lon}<span class="unit">°</span></div></div>
        </div>
      </div>

      <div class="telem-row">
        <div class="telem-cell">
          <div class="telem-lbl">SOURCE</div>
          <div class="telem-val">${source}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">SIGNAL</div>
          <div class="telem-val">${rssi}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">SQUAWK</div>
          <div class="telem-val ${squawkClass}">${squawk}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">IAS</div>
          <div class="telem-val">${ias}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">MACH</div>
          <div class="telem-val">${mach}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">WIND</div>
          <div class="telem-val">${wind}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">OAT</div>
          <div class="telem-val">${oat}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">NAV HDG</div>
          <div class="telem-val">${navHdg}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">MSGS</div>
          <div class="telem-val">${msgCount}</div>
        </div>
        <div class="telem-cell">
          <div class="telem-lbl">LAST SEEN</div>
          <div class="telem-val">${seen}</div>
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

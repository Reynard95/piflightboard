/* weather.js — Weather dashboard fetch + render */

const FETCH_MS = 60_000;   /* re-fetch every 60 s (backend caches 10 min) */

/* ── Wind helpers ── */

const COMPASS_16 = [
  'N','NNE','NE','ENE','E','ESE','SE','SSE',
  'S','SSW','SW','WSW','W','WNW','NW','NNW',
];

/* Unicode arrows for the 8 main compass points */
const DIR_ARROWS = {
  N:'↓', NNE:'↓', NE:'↙', ENE:'←', E:'←',
  ESE:'←', SE:'↖', SSE:'↑', S:'↑', SSW:'↑',
  SW:'↗', WSW:'→', W:'→', WNW:'→', NW:'↘', NNW:'↓',
};

function degToCompass(deg) {
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16;
  return COMPASS_16[idx];
}

function degToArrow(deg) {
  /* Arrow points FROM where wind is coming FROM (towards viewer) */
  /* We rotate a ↑ arrow: wind from N means blowing south → arrow points down */
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘'];
  const idx = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return arrows[idx];
}

/* ── Formatting helpers ── */

function fmt1(v) { return v !== null && v !== undefined ? v.toFixed(1) : '—'; }
function fmtRound(v) { return v !== null && v !== undefined ? Math.round(v).toString() : '—'; }

/* ── UV index category ── */

function uvLabel(uv) {
  if (uv === null || uv === undefined) return '—';
  const u = Math.round(uv);
  if (u <= 2) return u + ' LOW';
  if (u <= 5) return u + ' MOD';
  if (u <= 7) return u + ' HIGH';
  if (u <= 10) return u + ' V.HIGH';
  return u + ' EXTREME';
}

/* ── Pressure trend (compare to cached previous value) ── */

let _prevPressure = null;

function pressureTrend(hpa) {
  if (_prevPressure === null) { _prevPressure = hpa; return 'STEADY'; }
  const diff = hpa - _prevPressure;
  _prevPressure = hpa;
  if (diff > 0.3)  return '▲ RISING';
  if (diff < -0.3) return '▼ FALLING';
  return '— STEADY';
}

/* ── DOM update ── */

function set(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function render(d) {
  /* Temperature */
  set('w-temp', fmt1(d.temperature));
  set('w-feels', 'FEELS  ' + fmt1(d.feels_like) + ' °C');
  set('w-dewpoint', 'DEW  ' + fmt1(d.dew_point) + ' °C');

  /* Wind */
  const dir = degToCompass(d.wind_dir);
  document.getElementById('w-wind-arrow').textContent = degToArrow(d.wind_dir);
  set('w-wind-spd', fmtRound(d.wind_speed));
  set('w-wind-dir', 'FROM  ' + dir + '  (' + Math.round(d.wind_dir) + '°)');
  set('w-wind-gust', 'GUSTS  ' + fmtRound(d.wind_gusts) + ' km/h');

  /* Pressure */
  set('w-pressure', fmtRound(d.pressure));
  set('w-pressure-trend', pressureTrend(d.pressure));
  set('w-humidity', 'HUMIDITY  ' + fmtRound(d.humidity) + '%');

  /* Conditions */
  set('w-condition', d.condition || '—');
  set('w-cloud', 'CLOUD  ' + fmtRound(d.cloud_cover) + '%');
  const visMetre = d.visibility;
  const visText  = visMetre !== null
    ? (visMetre >= 9500 ? '10+ km' : (visMetre / 1000).toFixed(1) + ' km')
    : '—';
  set('w-visibility', 'VIS  ' + visText);
  set('w-uv', 'UV  ' + uvLabel(d.uv_index));

  /* Header */
  set('w-loc', d.lat.toFixed(3) + '°  ' + d.lon.toFixed(3) + '°');
  set('w-updated', 'UPD  ' + (d.updated || '—').replace('T', '  ').slice(0, 19));

  /* Footer strip */
  set('w-precip', fmt1(d.precipitation) + ' mm');
  set('w-cloud2', fmtRound(d.cloud_cover) + '%');
  set('w-vis2', visText);
  const uvEl = document.getElementById('w-uv2');
  if (uvEl) {
    uvEl.textContent = uvLabel(d.uv_index);
    const uv = d.uv_index ?? 0;
    uvEl.classList.remove('warn', 'danger');
    if (uv >= 8) uvEl.classList.add('danger');
    else if (uv >= 6) uvEl.classList.add('warn');
  }
  set('w-dew2', fmt1(d.dew_point) + ' °C');
  set('w-hum2', fmtRound(d.humidity) + '%');

  /* Forecast chart */
  if (d.forecast) drawForecast(d.forecast);
}

/* ── Forecast canvas ── */

function drawForecast(fc) {
  const canvas = document.getElementById('forecast-canvas');
  if (!canvas) return;

  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  canvas.width  = W;
  canvas.height = H;

  const ctx   = canvas.getContext('2d');
  const style = getComputedStyle(document.documentElement);
  const fg     = (style.getPropertyValue('--fg')     || '#FFA040').trim();
  const fgMid  = (style.getPropertyValue('--fg-mid') || '#CC7020').trim();
  const fgDim  = (style.getPropertyValue('--fg-dim') || '#7A4010').trim();
  const sep    = (style.getPropertyValue('--sep')    || '#3A1E08').trim();
  const bg     = (style.getPropertyValue('--bg')     || '#050200').trim();
  const warn   = (style.getPropertyValue('--warn')   || '#FFC040').trim();

  /* Layout */
  const ML = 42, MR = 10, MT = 8, MB = 22;
  const plotW = W - ML - MR;
  const plotH = H - MT - MB;

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const temps      = fc.temps      || [];
  const precipProb = fc.precip_prob || [];
  const hours      = fc.times      || [];
  const n          = Math.min(temps.length, 25);
  if (n < 2) return;

  const minTemp = Math.floor(Math.min(...temps.slice(0, n)) - 2);
  const maxTemp = Math.ceil(Math.max(...temps.slice(0, n)) + 2);
  const tempRange = maxTemp - minTemp || 1;

  function xOf(i) { return ML + (i / (n - 1)) * plotW; }
  function yOfTemp(t) { return MT + plotH - ((t - minTemp) / tempRange) * plotH; }

  /* ── Precipitation probability bars (background) ── */
  const barW = plotW / n;
  precipProb.slice(0, n).forEach((prob, i) => {
    const x   = ML + i * barW;
    const bh  = (prob / 100) * plotH;
    const alpha = Math.round((prob / 100) * 0x50).toString(16).padStart(2, '0');
    ctx.fillStyle = fgDim + alpha;
    ctx.fillRect(x, MT + plotH - bh, barW - 1, bh);
  });

  /* ── Temperature grid lines ── */
  const tempStep = tempRange <= 8 ? 1 : tempRange <= 16 ? 2 : 5;
  let tg = Math.ceil(minTemp / tempStep) * tempStep;
  ctx.font      = '9px "Share Tech Mono"';
  ctx.textAlign = 'right';
  while (tg <= maxTemp) {
    const y = yOfTemp(tg);
    ctx.strokeStyle = sep;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(ML, y);
    ctx.lineTo(ML + plotW, y);
    ctx.stroke();
    ctx.fillStyle = fgDim;
    ctx.fillText(tg + '°', ML - 3, y + 4);
    tg += tempStep;
  }

  /* ── Temperature filled area ── */
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xOf(i), y = yOfTemp(temps[i]);
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.lineTo(xOf(n - 1), MT + plotH);
  ctx.lineTo(ML, MT + plotH);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, MT, 0, MT + plotH);
  grad.addColorStop(0,   fg + 'BB');
  grad.addColorStop(0.7, fg + '33');
  grad.addColorStop(1,   fg + '08');
  ctx.fillStyle = grad;
  ctx.fill();

  /* ── Temperature line ── */
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const x = xOf(i), y = yOfTemp(temps[i]);
    if (i === 0) ctx.moveTo(x, y);
    else         ctx.lineTo(x, y);
  }
  ctx.strokeStyle = fg;
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  /* ── Temperature labels at 6h intervals ── */
  ctx.font      = '9px "Share Tech Mono"';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i += 1) {
    const y = yOfTemp(temps[i]);
    /* Draw dot at each point */
    if (i % 6 === 0 || i === n - 1) {
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.arc(xOf(i), y, 2, 0, Math.PI * 2);
      ctx.fill();
      /* Temp label */
      ctx.fillStyle = fg;
      ctx.fillText(Math.round(temps[i]) + '°', xOf(i), y - 6);
    }
  }

  /* ── Hour axis labels ── */
  ctx.font      = '9px "Share Tech Mono"';
  ctx.textAlign = 'center';
  for (let i = 0; i < n; i++) {
    if (i % 6 !== 0 && i !== n - 1) continue;
    const x     = xOf(i);
    const label = hours[i] ? hours[i].slice(11, 16) : '';  /* HH:MM */
    ctx.strokeStyle = fgDim;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x, MT + plotH);
    ctx.lineTo(x, MT + plotH + 4);
    ctx.stroke();
    ctx.fillStyle = fgDim;
    ctx.fillText(label, x, H - 4);
  }

  /* ── Axes ── */
  ctx.strokeStyle = sep;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(ML, MT);
  ctx.lineTo(ML, MT + plotH);
  ctx.lineTo(ML + plotW, MT + plotH);
  ctx.stroke();

  /* Precip probability legend mark */
  ctx.fillStyle   = fgDim + '80';
  ctx.fillRect(ML + plotW - 60, MT + 4, 10, 8);
  ctx.fillStyle   = fgDim;
  ctx.font        = '9px "Share Tech Mono"';
  ctx.textAlign   = 'left';
  ctx.fillText('PRECIP%', ML + plotW - 48, MT + 12);
}

/* ── Fetch ── */

async function fetchWeather() {
  try {
    const res = await fetch('/api/weather');
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      set('w-condition', err.error || 'FETCH ERROR');
      return;
    }
    const d = await res.json();
    if (d.error) { set('w-condition', d.error); return; }
    render(d);
  } catch (_) { /* network error — silent */ }
}

/* ── Clock ── */

function tickClock() {
  const el = document.getElementById('w-time');
  if (!el) return;
  const now = new Date();
  el.textContent =
    String(now.getHours()).padStart(2, '0') + ':' +
    String(now.getMinutes()).padStart(2, '0') + ':' +
    String(now.getSeconds()).padStart(2, '0');
}

/* ── Init ── */

window.addEventListener('DOMContentLoaded', () => {
  tickClock();
  setInterval(tickClock, 1000);

  fetchWeather();
  setInterval(fetchWeather, FETCH_MS);

  /* Redraw forecast chart on resize */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fetchWeather, 200);
  });
});

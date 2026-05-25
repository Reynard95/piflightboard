/* spectrum.js — RF Spectrum Waterfall */

/* ── Layout constants ── */
const ML = 54;   /* margin left  (dB axis) */
const MR = 10;   /* margin right */
const MT = 8;    /* margin top   */
const MB = 28;   /* margin bottom (freq axis) */
const SPEC_RATIO = 0.28;   /* fraction of plot height for spectrum line */

/* ── Fetch ── */
const FETCH_MS   = 1000;
const MIN_DB     = -90;
const MAX_DB     = -20;
const DB_RANGE   = MAX_DB - MIN_DB;

/* ── Band annotations ── */
const BANDS = [
  { label: 'FM',      lo: 88,   hi: 108  },
  { label: 'AIRCRAFT',lo: 118,  hi: 137  },
  { label: 'NOAA',    lo: 162,  hi: 163  },
  { label: 'ISM 433', lo: 433,  hi: 435  },
  { label: 'ISM 868', lo: 868,  hi: 870  },
  { label: 'ADS-B',   lo: 1089, hi: 1091 },
];

/* ── State ── */
let canvas, ctx;
let W = 0, H = 0;
let plotW = 0, plotH = 0;
let specH = 0, wfH = 0;
let wfTop = 0;

/* Latest data */
let freqs    = [];   /* MHz */
let powers   = [];   /* dB  */
let minFreq  = 88;
let maxFreq  = 1100;
let dataSource = 'simulated';

/* Waterfall: off-screen ImageData row buffer */
let wfBuf    = null;  /* ImageData (plotW × wfH) */

/* ── Color LUT — 256 entries in amber palette ── */
/* Stops: [index 0-255, r, g, b] */
const LUT_STOPS = [
  [0,   5,   2,   0],   /* #050200  bg        */
  [40,  26,  10,  2],   /* very faint          */
  [90,  58,  30,  8],   /* #3A1E08  sep        */
  [140, 122, 64,  16],  /* #7A4010  fg-dim     */
  [185, 204, 112, 32],  /* #CC7020  fg-mid     */
  [225, 255, 160, 64],  /* #FFA040  fg         */
  [255, 255, 192, 64],  /* #FFC040  warn/peak  */
];

const LUT = buildLut();

function buildLut() {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    /* Find surrounding stops */
    let s0 = LUT_STOPS[0];
    let s1 = LUT_STOPS[LUT_STOPS.length - 1];
    for (let j = 0; j < LUT_STOPS.length - 1; j++) {
      if (i >= LUT_STOPS[j][0] && i <= LUT_STOPS[j + 1][0]) {
        s0 = LUT_STOPS[j];
        s1 = LUT_STOPS[j + 1];
        break;
      }
    }
    const span = s1[0] - s0[0];
    const t    = span === 0 ? 1 : (i - s0[0]) / span;
    lut[i * 4 + 0] = Math.round(s0[1] + (s1[1] - s0[1]) * t);
    lut[i * 4 + 1] = Math.round(s0[2] + (s1[2] - s0[2]) * t);
    lut[i * 4 + 2] = Math.round(s0[3] + (s1[3] - s0[3]) * t);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

function dbToLut(db) {
  return Math.max(0, Math.min(255, Math.round(((db - MIN_DB) / DB_RANGE) * 255)));
}

/* ── Canvas sizing ── */

function resize() {
  const body = document.querySelector('.spectrum-body');
  W = body.offsetWidth;
  H = body.offsetHeight;
  canvas.width  = W;
  canvas.height = H;
  plotW = W - ML - MR;
  plotH = H - MT - MB;
  specH = Math.floor(plotH * SPEC_RATIO);
  wfH   = plotH - specH;
  wfTop = MT + specH;

  /* Rebuild waterfall buffer at new size */
  if (plotW > 0 && wfH > 0) {
    wfBuf = ctx.createImageData(plotW, wfH);
    /* Fill with background color */
    const [r, g, b] = [LUT[0], LUT[1], LUT[2]];
    for (let i = 0; i < wfBuf.data.length; i += 4) {
      wfBuf.data[i]     = r;
      wfBuf.data[i + 1] = g;
      wfBuf.data[i + 2] = b;
      wfBuf.data[i + 3] = 255;
    }
  }

  draw();
}

/* ── Coordinate helpers ── */

function freqToX(mhz) {
  return ML + ((mhz - minFreq) / (maxFreq - minFreq)) * plotW;
}

function dbToY(db, top, height) {
  /* MIN_DB → bottom, MAX_DB → top */
  return top + height - ((db - MIN_DB) / DB_RANGE) * height;
}

/* ── Waterfall ── */

function pushWaterfallRow() {
  if (!wfBuf || freqs.length === 0) return;
  const d    = wfBuf.data;
  const rowBytes = plotW * 4;

  /* Shift all rows DOWN by 1 (newest at top) */
  for (let row = wfH - 1; row > 0; row--) {
    const dst = row * rowBytes;
    const src = (row - 1) * rowBytes;
    for (let i = 0; i < rowBytes; i++) {
      d[dst + i] = d[src + i];
    }
  }

  /* Write new row at top (row 0) */
  for (let px = 0; px < plotW; px++) {
    /* Map pixel x → frequency → power */
    const mhz = minFreq + (px / plotW) * (maxFreq - minFreq);
    /* Find nearest bin */
    const binIdx = Math.round((mhz - minFreq) / (maxFreq - minFreq) * (freqs.length - 1));
    const db     = powers[Math.max(0, Math.min(powers.length - 1, binIdx))] ?? MIN_DB;
    const li     = dbToLut(db) * 4;
    const off    = px * 4;
    d[off]     = LUT[li];
    d[off + 1] = LUT[li + 1];
    d[off + 2] = LUT[li + 2];
    d[off + 3] = 255;
  }
}

/* ── Draw ── */

function draw() {
  if (!ctx || W === 0 || H === 0) return;

  const style    = getComputedStyle(document.documentElement);
  const fg       = (style.getPropertyValue('--fg')     || '#FFA040').trim();
  const fgMid    = (style.getPropertyValue('--fg-mid') || '#CC7020').trim();
  const fgDim    = (style.getPropertyValue('--fg-dim') || '#7A4010').trim();
  const sep      = (style.getPropertyValue('--sep')    || '#3A1E08').trim();
  const bg       = (style.getPropertyValue('--bg')     || '#050200').trim();

  /* Background */
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  /* ── Waterfall ── */
  if (wfBuf) {
    ctx.putImageData(wfBuf, ML, wfTop);
  }

  /* ── Spectrum section background ── */
  ctx.fillStyle = bg;
  ctx.fillRect(ML, MT, plotW, specH);

  /* dB grid lines in spectrum section */
  const dbSteps = [-80, -70, -60, -50, -40, -30];
  ctx.font      = '10px "Share Tech Mono"';
  ctx.textAlign = 'right';
  dbSteps.forEach(db => {
    if (db < MIN_DB || db > MAX_DB) return;
    const y = dbToY(db, MT, specH);
    ctx.strokeStyle = sep;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(ML, y);
    ctx.lineTo(ML + plotW, y);
    ctx.stroke();
    /* Label */
    ctx.fillStyle = fgDim;
    ctx.fillText(db + 'dB', ML - 4, y + 4);
  });

  /* Divider between spectrum and waterfall */
  ctx.strokeStyle = sep;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(ML, wfTop);
  ctx.lineTo(ML + plotW, wfTop);
  ctx.stroke();

  /* ── Spectrum line ── */
  if (freqs.length > 0 && powers.length > 0) {
    /* Filled area */
    ctx.beginPath();
    let first = true;
    for (let i = 0; i < freqs.length; i++) {
      const x = freqToX(freqs[i]);
      const y = dbToY(powers[i], MT, specH);
      if (first) { ctx.moveTo(x, y); first = false; }
      else        ctx.lineTo(x, y);
    }
    /* Close area to bottom */
    ctx.lineTo(freqToX(freqs[freqs.length - 1]), MT + specH);
    ctx.lineTo(freqToX(freqs[0]), MT + specH);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, MT, 0, MT + specH);
    grad.addColorStop(0,   fg + 'CC');
    grad.addColorStop(0.6, fg + '44');
    grad.addColorStop(1,   fg + '08');
    ctx.fillStyle = grad;
    ctx.fill();

    /* Line */
    ctx.beginPath();
    first = true;
    for (let i = 0; i < freqs.length; i++) {
      const x = freqToX(freqs[i]);
      const y = dbToY(powers[i], MT, specH);
      if (first) { ctx.moveTo(x, y); first = false; }
      else        ctx.lineTo(x, y);
    }
    ctx.strokeStyle = fg;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }

  /* ── Band annotations ── */
  ctx.font      = '9px "Share Tech Mono"';
  ctx.textAlign = 'center';
  BANDS.forEach(b => {
    const x0 = freqToX(b.lo);
    const x1 = freqToX(b.hi);
    if (x1 < ML || x0 > ML + plotW) return;
    const cx = (x0 + x1) / 2;
    const bw = x1 - x0;

    /* Highlight column in spectrum area (very faint) */
    ctx.fillStyle = fgDim + '18';
    ctx.fillRect(x0, MT, bw, specH);

    /* Thin vertical markers */
    ctx.strokeStyle = fgDim + '60';
    ctx.lineWidth   = 1;
    [x0, x1].forEach(x => {
      ctx.beginPath();
      ctx.moveTo(x, MT);
      ctx.lineTo(x, MT + specH);
      ctx.stroke();
    });

    /* Label — only if wide enough */
    if (bw >= 14) {
      ctx.fillStyle = fgMid;
      ctx.fillText(b.label, Math.max(ML + 2, Math.min(ML + plotW - 2, cx)), MT + 11);
    }
  });

  /* ── Frequency axis ── */
  const freqTicks = buildFreqTicks(minFreq, maxFreq);
  ctx.font      = '10px "Share Tech Mono"';
  ctx.textAlign = 'center';
  freqTicks.forEach(mhz => {
    const x = freqToX(mhz);
    if (x < ML || x > ML + plotW) return;
    /* Tick */
    ctx.strokeStyle = fgDim;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(x, H - MB);
    ctx.lineTo(x, H - MB + 4);
    ctx.stroke();
    /* Label */
    ctx.fillStyle = fgDim;
    const label = mhz >= 1000 ? (mhz / 1000).toFixed(1) + 'G' : mhz + 'M';
    ctx.fillText(label, x, H - MB + 16);
  });

  /* Axis lines */
  ctx.strokeStyle = sep;
  ctx.lineWidth   = 1;
  /* Left (dB) */
  ctx.beginPath();
  ctx.moveTo(ML, MT);
  ctx.lineTo(ML, H - MB);
  ctx.stroke();
  /* Bottom (freq) */
  ctx.beginPath();
  ctx.moveTo(ML, H - MB);
  ctx.lineTo(ML + plotW, H - MB);
  ctx.stroke();

  /* dB axis label */
  ctx.save();
  ctx.translate(14, MT + specH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.font      = '10px "Share Tech Mono"';
  ctx.textAlign = 'center';
  ctx.fillStyle = fgDim;
  ctx.fillText('dBm', 0, 0);
  ctx.restore();
}

/* Build nice round frequency tick marks for the given range */
function buildFreqTicks(lo, hi) {
  const span   = hi - lo;
  const targets = [10, 20, 25, 50, 100, 200, 250];
  let step = 10;
  for (const t of targets) {
    if (span / t <= 20) { step = t; break; }
  }
  const ticks = [];
  let f = Math.ceil(lo / step) * step;
  while (f <= hi) { ticks.push(f); f += step; }
  return ticks;
}

/* ── Fetch ── */

let firstFetch = true;

async function fetchSpectrum() {
  try {
    const res = await fetch('/api/spectrum');
    if (!res.ok) return;
    const d = await res.json();

    freqs      = d.freqs_mhz;
    powers     = d.powers_db;
    minFreq    = d.min_freq_mhz;
    maxFreq    = d.max_freq_mhz;
    dataSource = d.source;

    /* Update header */
    const rangeEl = document.getElementById('s-range');
    if (rangeEl) rangeEl.textContent = minFreq + ' – ' + maxFreq + ' MHz';

    const dotEl = document.getElementById('s-dot');
    const srcEl = document.getElementById('s-source');
    if (dotEl && srcEl) {
      const sim = dataSource === 'simulated';
      dotEl.classList.toggle('sim', sim);
      srcEl.classList.toggle('sim', sim);
      srcEl.textContent = sim ? 'SIM' : 'LIVE';
    }

    /* On first fetch, pre-fill the entire waterfall so it looks populated */
    if (firstFetch && wfBuf) {
      firstFetch = false;
      for (let row = 0; row < wfH; row++) {
        prefillWaterfallRow(row);
      }
    }

    /* Add new waterfall row then redraw */
    pushWaterfallRow();
    draw();
  } catch (_) { /* network error — silent */ }
}

/*
 * Write a synthetic row at a specific position in the waterfall buffer,
 * aged by how far down it is (older = dimmer).
 */
function prefillWaterfallRow(row) {
  if (!wfBuf || freqs.length === 0) return;
  const d        = wfBuf.data;
  const rowBytes = plotW * 4;
  /* age factor: row 0 = newest (full brightness), row wfH-1 = oldest (dim) */
  const age = row / wfH;  /* 0..1 */

  for (let px = 0; px < plotW; px++) {
    const mhz    = minFreq + (px / plotW) * (maxFreq - minFreq);
    const binIdx = Math.round((mhz - minFreq) / (maxFreq - minFreq) * (freqs.length - 1));
    const db     = powers[Math.max(0, Math.min(powers.length - 1, binIdx))] ?? MIN_DB;
    /* Fade older rows towards the noise floor */
    const agedDb = db + age * (MIN_DB - db) * 0.6;
    const li     = dbToLut(agedDb) * 4;
    const off    = row * rowBytes + px * 4;
    d[off]     = LUT[li];
    d[off + 1] = LUT[li + 1];
    d[off + 2] = LUT[li + 2];
    d[off + 3] = 255;
  }
}

/* ── Init ── */

window.addEventListener('DOMContentLoaded', () => {
  canvas = document.getElementById('spectrum-canvas');
  ctx    = canvas.getContext('2d');

  resize();
  window.addEventListener('resize', resize);

  fetchSpectrum();
  setInterval(fetchSpectrum, FETCH_MS);
});

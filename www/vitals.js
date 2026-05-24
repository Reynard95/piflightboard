/* vitals.js — System Vitals fetch + render */

const FETCH_MS      = 2000;
const SPARKLINE_LEN = 90;   /* samples to keep (~3 min at 2s) */

/* Thresholds */
const T = {
  cpu:  { warn: 60, danger: 80 },
  temp: { warn: 55, danger: 70 },
  mem:  { warn: 70, danger: 85 },
  disk: { warn: 70, danger: 85 },
};

/* State */
let sparkBuf = [];   /* circular CPU % history */

/* ── Helpers ── */

function cls(el, pct, thresholds) {
  el.classList.remove('warn', 'danger');
  if (pct >= thresholds.danger) el.classList.add('danger');
  else if (pct >= thresholds.warn) el.classList.add('warn');
}

function fmtBytes(bps) {
  if (bps === null || bps === undefined) return '—';
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + ' MB/s';
  if (bps >= 1_000)     return (bps / 1_000).toFixed(1) + ' KB/s';
  return Math.round(bps) + ' B/s';
}

function fmtPct(v) {
  return v === null ? '—' : Math.round(v) + '%';
}

/* ── Sparkline ── */

function drawSparkline() {
  const canvas = document.getElementById('cpu-sparkline');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;

  ctx.clearRect(0, 0, W, H);
  if (sparkBuf.length < 2) return;

  const max = 100;
  const step = W / (SPARKLINE_LEN - 1);

  /* Compute style values once */
  const style  = getComputedStyle(document.documentElement);
  const fg     = (style.getPropertyValue('--fg')     || '#FFA040').trim();
  const fgDim  = (style.getPropertyValue('--fg-dim') || '#7A4010').trim();

  /* Build path from oldest to newest, left to right */
  const startIdx = Math.max(0, SPARKLINE_LEN - sparkBuf.length);
  ctx.beginPath();
  sparkBuf.forEach((v, i) => {
    const x = (startIdx + i) * step;
    const y = H - (v / max) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });

  /* Filled area */
  const lastX = (startIdx + sparkBuf.length - 1) * step;
  const firstX = startIdx * step;
  ctx.lineTo(lastX, H);
  ctx.lineTo(firstX, H);
  ctx.closePath();

  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, fg + 'AA');
  grad.addColorStop(1, fg + '18');
  ctx.fillStyle = grad;
  ctx.fill();

  /* Line on top */
  ctx.beginPath();
  sparkBuf.forEach((v, i) => {
    const x = (startIdx + i) * step;
    const y = H - (v / max) * H;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = fg;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function sizeSparkline() {
  const canvas = document.getElementById('cpu-sparkline');
  if (!canvas) return;
  canvas.width  = canvas.offsetWidth;
  canvas.height = canvas.offsetHeight;
  drawSparkline();
}

/* ── DOM updates ── */

function applyBar(barId, pct, thresholds) {
  const bar = document.getElementById(barId);
  if (!bar) return;
  bar.style.width = Math.min(100, pct || 0) + '%';
  cls(bar, pct || 0, thresholds);
}

function render(d) {
  /* CPU */
  const cpuEl = document.getElementById('v-cpu-pct');
  if (d.cpu_pct !== null) {
    cpuEl.textContent = fmtPct(d.cpu_pct);
    cls(cpuEl, d.cpu_pct, T.cpu);
    sparkBuf.push(d.cpu_pct);
    if (sparkBuf.length > SPARKLINE_LEN) sparkBuf.shift();
    drawSparkline();
  }
  const cpuSub = document.getElementById('v-cpu-sub');
  if (cpuSub) cpuSub.textContent = d.cpu_pct !== null ? d.cpu_cores + ' CORE' + (d.cpu_cores !== 1 ? 'S' : '') : 'WAITING FOR DATA';

  /* Temperature */
  const tempEl = document.getElementById('v-temp');
  if (tempEl && d.cpu_temp !== null) {
    tempEl.textContent = d.cpu_temp.toFixed(1);
    cls(tempEl, d.cpu_temp, T.temp);
  }
  applyBar('bar-temp', d.cpu_temp !== null ? (d.cpu_temp / 85) * 100 : 0, T.temp);
  const tempSub = document.getElementById('v-temp-sub');
  if (tempSub) tempSub.textContent = d.cpu_temp !== null ? (d.cpu_temp >= T.temp.danger ? 'HOT' : d.cpu_temp >= T.temp.warn ? 'WARM' : 'NORMAL') : '—';

  /* Memory */
  const memEl = document.getElementById('v-mem-pct');
  if (memEl) {
    memEl.textContent = fmtPct(d.mem_pct);
    cls(memEl, d.mem_pct || 0, T.mem);
  }
  applyBar('bar-mem', d.mem_pct, T.mem);
  const memSub = document.getElementById('v-mem-sub');
  if (memSub && d.mem_used_mb !== null) {
    memSub.textContent = Math.round(d.mem_used_mb) + ' / ' + Math.round(d.mem_total_mb) + ' MB';
  }

  /* Disk */
  const diskEl = document.getElementById('v-disk-pct');
  if (diskEl) {
    diskEl.textContent = fmtPct(d.disk_pct);
    cls(diskEl, d.disk_pct || 0, T.disk);
  }
  applyBar('bar-disk', d.disk_pct, T.disk);
  const diskSub = document.getElementById('v-disk-sub');
  if (diskSub && d.disk_used_gb !== null) {
    diskSub.textContent = d.disk_used_gb.toFixed(1) + ' / ' + d.disk_total_gb.toFixed(1) + ' GB';
  }

  /* Network */
  const txEl = document.getElementById('v-net-tx');
  const rxEl = document.getElementById('v-net-rx');
  if (txEl) txEl.textContent = fmtBytes(d.net_tx_bps);
  if (rxEl) rxEl.textContent = fmtBytes(d.net_rx_bps);

  /* System */
  const uptimeEl = document.getElementById('v-uptime');
  if (uptimeEl) uptimeEl.textContent = d.uptime || '—';

  const loadEl = document.getElementById('v-load');
  if (loadEl && d.load) {
    loadEl.textContent = d.load.map(v => v.toFixed(2)).join('  ');
  }

  /* Hostname (once) */
  const hostEl = document.getElementById('v-hostname');
  if (hostEl && d.hostname && hostEl.textContent === '—') {
    hostEl.textContent = d.hostname.toUpperCase();
  }
}

/* ── Fetch ── */

async function fetchVitals() {
  try {
    const res = await fetch('/api/vitals');
    if (!res.ok) return;
    const d = await res.json();
    render(d);
  } catch (_) { /* network error — silent */ }
}

/* ── Clock ── */

function tickClock() {
  const el = document.getElementById('v-time');
  if (!el) return;
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  const ss  = String(now.getSeconds()).padStart(2, '0');
  el.textContent = hh + ':' + mm + ':' + ss;
}

/* ── Init ── */

window.addEventListener('DOMContentLoaded', () => {
  sizeSparkline();
  window.addEventListener('resize', sizeSparkline);

  tickClock();
  setInterval(tickClock, 1000);

  fetchVitals();
  setInterval(fetchVitals, FETCH_MS);
});

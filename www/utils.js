/* utils.js — Shared formatting helpers
   Load after themes.js, before any page-specific script.
   All functions are plain globals (no module syntax).    */

/* ── Number formatting ───────────────────────────────────── */

/** Format to 1 decimal place; returns '—' for null/undefined */
function fmt1(v) {
  return v !== null && v !== undefined ? v.toFixed(1) : '—';
}

/** Round to nearest integer string; returns '—' for null/undefined */
function fmtRound(v) {
  return v !== null && v !== undefined ? Math.round(v).toString() : '—';
}

/** Format bytes-per-second to a human-readable rate string */
function fmtBytes(bps) {
  if (bps === null || bps === undefined) return '—';
  if (bps >= 1_000_000) return (bps / 1_000_000).toFixed(1) + ' MB/s';
  if (bps >= 1_000)     return (bps / 1_000).toFixed(1) + ' KB/s';
  return Math.round(bps) + ' B/s';
}

/** Format a 0-100 percentage; returns '—' for null/undefined */
function fmtPct(v) {
  return v === null || v === undefined ? '—' : Math.round(v) + '%';
}

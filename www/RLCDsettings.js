/**
 * RLCDsettings.js — RLCD e-paper board settings page
 *
 * Self-contained (doesn't share code with setup.js) but reuses the same
 * fb_token sessionStorage key, so a login on either page unlocks both.
 *
 * Flow:
 *   1. On load: try GET /api/settings with any stored token.
 *      - 401 / no token → show PIN gate (login only — PIN creation lives
 *        in setup.html, not duplicated here).
 *      - ok → populate the form from settings.epaper.
 *   2. Save buttons POST /api/settings/epaper with just the changed field.
 */

'use strict';

const API = ''; // same-origin — routed through lighttpd proxy to port 8089

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function getToken() { return sessionStorage.getItem('fb_token') || ''; }
function setToken(t) { sessionStorage.setItem('fb_token', t); }
function clearToken() { sessionStorage.removeItem('fb_token'); }

async function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...(opts.headers || {}),
  };
  const res = await fetch(`${API}${path}`, { ...opts, headers });
  if (res.status === 401) {
    clearToken();
    showPinGate();
    throw new Error('Unauthorised');
  }
  return res;
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
function show(id) { $(id).classList.remove('hidden'); }
function hide(id) { $(id).classList.add('hidden'); }
function setError(id, msg) { $(id).textContent = msg || ''; }

function flashOk(id) {
  show(id);
  clearTimeout(flashOk._t && flashOk._t[id]);
  flashOk._t = flashOk._t || {};
  flashOk._t[id] = setTimeout(() => hide(id), 3000);
}

// ---------------------------------------------------------------------------
// PIN gate
// ---------------------------------------------------------------------------

function showPinGate() {
  hide('app');
  show('pin-gate');
  setError('pin-error', '');
  $('pin-input').value = '';
  setTimeout(() => $('pin-input').focus(), 50);
}

function hidePinGate() {
  hide('pin-gate');
  show('app');
}

/** Detect the no-PIN-set-yet case so we can point at setup.html instead of
 * duplicating PIN creation here. */
async function checkPinMode() {
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === 'no_pin_set') {
      show('no-pin-hint');
      $('pin-input').disabled = true;
      $('pin-submit').disabled = true;
    }
  } catch (_) {
    // API unreachable — still show the gate, login attempt will fail with a clear error
  }
}

async function submitPin() {
  const pin = $('pin-input').value;
  if (!pin) return;
  $('pin-submit').disabled = true;
  setError('pin-error', '');
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      setToken(data.token);
      hidePinGate();
      await loadSettings();
    } else {
      setError('pin-error', data.error || 'Incorrect PIN');
    }
  } catch (err) {
    setError('pin-error', 'Cannot reach settings API');
  } finally {
    $('pin-submit').disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Compass preview
// ---------------------------------------------------------------------------

function updateNeedle(deg) {
  $('facing-needle').style.transform = `translateX(-50%) rotate(${deg}deg)`;
}

function clampFacing(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

// ---------------------------------------------------------------------------
// Settings load / save
// ---------------------------------------------------------------------------

async function loadSettings() {
  const res = await apiFetch('/api/settings');
  if (!res.ok) return;
  const data = await res.json();
  const epaper = data.epaper || { facing_deg: 0, wifi_tx_power_dbm: 8.5 };

  $('facing-input').value = epaper.facing_deg;
  updateNeedle(epaper.facing_deg);

  const opt = [...$('txpower-select').options]
    .find((o) => Number(o.value) === Number(epaper.wifi_tx_power_dbm));
  if (opt) $('txpower-select').value = opt.value;
}

async function saveFacing() {
  const deg = clampFacing(Number($('facing-input').value) || 0);
  $('facing-input').value = deg;
  updateNeedle(deg);
  setError('facing-error', '');
  try {
    const res = await apiFetch('/api/settings/epaper', {
      method: 'POST',
      body: JSON.stringify({ facing_deg: deg }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) flashOk('facing-ok');
    else setError('facing-error', data.error || 'Save failed');
  } catch (_) {
    // 401 already handled by apiFetch (shows PIN gate)
  }
}

async function saveTxPower() {
  const dbm = Number($('txpower-select').value);
  setError('txpower-error', '');
  try {
    const res = await apiFetch('/api/settings/epaper', {
      method: 'POST',
      body: JSON.stringify({ wifi_tx_power_dbm: dbm }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) flashOk('txpower-ok');
    else setError('txpower-error', data.error || 'Save failed');
  } catch (_) {
    // 401 already handled by apiFetch (shows PIN gate)
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function wireEvents() {
  $('pin-submit').addEventListener('click', submitPin);
  $('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') submitPin(); });

  $('facing-minus').addEventListener('click', () => {
    $('facing-input').value = clampFacing(Number($('facing-input').value) - 5);
    updateNeedle(Number($('facing-input').value));
  });
  $('facing-plus').addEventListener('click', () => {
    $('facing-input').value = clampFacing(Number($('facing-input').value) + 5);
    updateNeedle(Number($('facing-input').value));
  });
  $('facing-input').addEventListener('input', () => {
    updateNeedle(clampFacing(Number($('facing-input').value) || 0));
  });
  $('save-facing-btn').addEventListener('click', saveFacing);
  $('save-txpower-btn').addEventListener('click', saveTxPower);
}

async function init() {
  wireEvents();
  if (getToken()) {
    try {
      await loadSettings();
      hidePinGate();
      return;
    } catch (_) {
      // apiFetch already showed the PIN gate on 401
    }
  }
  showPinGate();
  await checkPinMode();
}

document.addEventListener('DOMContentLoaded', init);

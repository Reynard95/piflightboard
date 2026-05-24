/**
 * setup.js — Flight Board Setup / Settings Page
 *
 * Flow:
 *   1. On load: check for stored token → try GET /api/settings
 *      - 401 or no token → show PIN gate
 *      - ok + setup_complete=false → show wizard
 *      - ok + setup_complete=true  → show settings panel
 *
 *   2. PIN gate: login or set-PIN mode
 *   3. Wizard: 3-step first-run flow
 *   4. Settings panel: tabbed interface for returning users
 */

'use strict';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const API = ''; // same-origin — routed through lighttpd proxy to port 8089

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

function getToken() {
  return sessionStorage.getItem('fb_token') || '';
}

function setToken(t) {
  sessionStorage.setItem('fb_token', t);
}

function clearToken() {
  sessionStorage.removeItem('fb_token');
}

/** Fetch wrapper that injects Bearer token and handles 401 → PIN gate. */
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

const $  = (id) => document.getElementById(id);
const el = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt !== undefined) e.textContent = txt;
  return e;
};

function show(id)  { $(id).classList.remove('hidden'); }
function hide(id)  { $(id).classList.add('hidden'); }
function toggle(id, visible) { visible ? show(id) : hide(id); }

function setError(id, msg) {
  const el = $(id);
  if (el) el.textContent = msg || '';
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

/**
 * Render a status badge into a container element.
 * @param {HTMLElement} container
 * @param {'ok'|'warn'|'err'|'off'} type
 * @param {string} label
 */
function renderBadge(container, type, label) {
  container.className = `status-badge ${type}`;
  container.innerHTML =
    `<span class="status-dot ${type}"></span>` +
    `<span class="status-label">${label}</span>`;
}

/**
 * Update a status badge element by ID given a service status object.
 * @param {string} badgeId
 * @param {{ active: boolean, status: string }} svc
 */
function updateServiceBadge(badgeId, svc) {
  const el = $(badgeId);
  if (!el) return;
  if (!svc || svc.status === 'not installed') {
    renderBadge(el, 'off', 'not installed');
  } else if (svc.active) {
    renderBadge(el, 'ok', 'running');
  } else {
    renderBadge(el, 'warn', 'stopped');
  }
}

// ---------------------------------------------------------------------------
// PIN GATE
// ---------------------------------------------------------------------------

let pinMode = 'login'; // 'login' | 'set'

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

/**
 * Check whether a PIN is set yet by attempting a dummy login.
 * The API returns 403 + {error: "no_pin_set"} if none exists.
 */
async function checkPinMode() {
  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: '' }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403 && data.error === 'no_pin_set') {
      pinMode = 'set';
      $('pin-gate-title').textContent = 'Create PIN';
      $('pin-gate-subtitle').textContent = 'First run — set a PIN to protect this page';
      $('pin-submit').textContent = 'Set PIN';
      $('pin-input').setAttribute('placeholder', 'Choose a PIN');
    } else {
      pinMode = 'login';
      $('pin-gate-title').textContent = 'Flight Board';
      $('pin-gate-subtitle').textContent = 'Enter your PIN to continue';
      $('pin-submit').textContent = 'Unlock';
    }
  } catch (_) {
    // API unreachable — still show login gate
  }
}

async function submitPin() {
  const pin = $('pin-input').value.trim();
  if (!pin) {
    setError('pin-error', 'Please enter a PIN');
    return;
  }
  setError('pin-error', '');
  $('pin-submit').disabled = true;

  try {
    const endpoint = pinMode === 'set' ? '/api/auth/set' : '/api/auth/login';
    const res = await fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.token) {
      setToken(data.token);
      hidePinGate();
      await initApp();
    } else {
      setError('pin-error', data.error || 'Failed');
    }
  } catch (err) {
    setError('pin-error', 'Cannot reach settings API');
  } finally {
    $('pin-submit').disabled = false;
  }
}

// PIN enter key
$('pin-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitPin();
});
$('pin-submit').addEventListener('click', submitPin);

// ---------------------------------------------------------------------------
// App init
// ---------------------------------------------------------------------------

let appSettings = {};

async function initApp() {
  // Load current settings
  try {
    const res = await apiFetch('/api/settings');
    if (!res.ok) {
      showPinGate();
      return;
    }
    appSettings = await res.json();
  } catch (err) {
    if (err.message === 'Unauthorised') return;
    showPinGate();
    return;
  }

  if (appSettings.setup_complete) {
    showSettingsPanel();
  } else {
    showWizard();
  }
}

// ---------------------------------------------------------------------------
// WIZARD
// ---------------------------------------------------------------------------

let wizardStep = 1;
let wizardState = {
  locationSaved: false,
  fr24Done: false,
  faDone: false,
};

function showWizard() {
  hide('settings-panel');
  show('wizard');

  // Pre-fill location inputs if we have saved coords
  const loc = appSettings.location || {};
  if (loc.lat) $('lat-input').value = loc.lat;
  if (loc.lon) $('lon-input').value = loc.lon;

  goToWizardStep(1);
  checkFeederInstallStatus();
}

function goToWizardStep(n) {
  wizardStep = n;
  // Show/hide step cards
  for (let i = 1; i <= 3; i++) {
    const card = $(`wiz-step-${i}`);
    if (card) toggle(`wiz-step-${i}`, i === n);
  }
  // Update step indicator
  for (let i = 1; i <= 3; i++) {
    const item = $(`step-item-${i}`);
    if (!item) continue;
    item.classList.remove('active', 'done');
    if (i < n) item.classList.add('done');
    else if (i === n) item.classList.add('active');
    // Update dot content
    const dot = item.querySelector('.step-dot');
    if (dot) dot.textContent = i < n ? '✓' : String(i);
  }
}

// ── Step 1: Location ──

function nudge(inputId, delta) {
  const inp = $(inputId);
  const val = parseFloat(inp.value) || 0;
  inp.value = (val + delta).toFixed(3);
}

$('lat-minus').addEventListener('click', () => nudge('lat-input', -0.001));
$('lat-plus').addEventListener('click',  () => nudge('lat-input', +0.001));
$('lon-minus').addEventListener('click', () => nudge('lon-input', -0.001));
$('lon-plus').addEventListener('click',  () => nudge('lon-input', +0.001));

$('use-location-btn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('geo-hint').textContent = 'Geolocation not available in this browser.';
    return;
  }
  $('geo-hint').textContent = 'Requesting location...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('lat-input').value = pos.coords.latitude.toFixed(5);
      $('lon-input').value = pos.coords.longitude.toFixed(5);
      $('geo-hint').textContent = `Located: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    },
    (err) => {
      $('geo-hint').textContent = `Location error: ${err.message}`;
    }
  );
});

$('save-location-btn').addEventListener('click', async () => {
  const lat = parseFloat($('lat-input').value);
  const lon = parseFloat($('lon-input').value);
  if (isNaN(lat) || isNaN(lon)) {
    setError('location-error', 'Please enter valid coordinates');
    return;
  }
  if (lat < -90 || lat > 90) {
    setError('location-error', 'Latitude must be between -90 and 90');
    return;
  }
  if (lon < -180 || lon > 180) {
    setError('location-error', 'Longitude must be between -180 and 180');
    return;
  }
  setError('location-error', '');
  $('save-location-btn').disabled = true;

  try {
    const res = await apiFetch('/api/settings/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lon }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      wizardState.locationSaved = true;
      appSettings.location = { lat, lon };
      goToWizardStep(2);
    } else {
      setError('location-error', data.error || 'Save failed');
    }
  } catch (err) {
    if (err.message !== 'Unauthorised') setError('location-error', 'Request failed');
  } finally {
    $('save-location-btn').disabled = false;
  }
});

// ── Step 2: Feeders ──

$('back-to-step1').addEventListener('click', () => goToWizardStep(1));
$('skip-feeders-btn').addEventListener('click', () => goToWizardStep(3));
$('done-feeders-btn').addEventListener('click', () => {
  goToWizardStep(3);
  buildWizardSummary();
});

async function checkFeederInstallStatus() {
  // FR24
  try {
    const res = await fetch(`${API}/api/feeder/fr24/install-status`);
    const data = await res.json();
    updateInstallBadge('fr24-install-badge', data.installed);
  } catch (_) {
    updateInstallBadge('fr24-install-badge', false);
  }
  // PiAware
  try {
    const res = await fetch(`${API}/api/feeder/flightaware/install-status`);
    const data = await res.json();
    updateInstallBadge('fa-install-badge', data.installed);
  } catch (_) {
    updateInstallBadge('fa-install-badge', false);
  }
}

function updateInstallBadge(badgeId, installed) {
  const badge = $(badgeId);
  if (!badge) return;
  if (installed) {
    renderBadge(badge, 'ok', 'installed');
  } else {
    renderBadge(badge, 'off', 'not installed');
  }
}

// Wizard FR24 — install only, signup via FR24's built-in web UI on port 8754
$('fr24-install-btn-wiz').addEventListener('click', async () => {
  const termWrap   = $('fr24-terminal-wiz');
  const termOut    = $('fr24-terminal-out-wiz');
  const termStatus = $('fr24-terminal-status-wiz');

  termWrap.classList.add('visible');
  termOut.textContent = '';
  termStatus.innerHTML = '<span class="spinner"></span>';

  const success = await runSseInstall('/api/feeder/fr24/install', termOut, termStatus);
  if (success) {
    // Show post-install panel with link to FR24's built-in signup web UI
    const host = window.location.hostname;
    $('fr24-webui-link').href = `http://${host}:8754`;
    $('fr24-post-install').classList.remove('hidden');
    wizardState.fr24Done = true;
    await checkFeederInstallStatus();
  }
});

// Wizard FA — install PiAware, then show generated feeder ID
$('fa-install-btn-wiz').addEventListener('click', async () => {
  const termWrap   = $('fa-terminal-wiz');
  const termOut    = $('fa-terminal-out-wiz');
  const termStatus = $('fa-terminal-status-wiz');

  termWrap.classList.add('visible');
  termOut.textContent = '';
  termStatus.innerHTML = '<span class="spinner"></span>';

  const success = await runSseInstall('/api/feeder/flightaware/install', termOut, termStatus);
  if (success) {
    await showFaFeederId('fa-feeder-id-display');
    $('fa-post-install').classList.remove('hidden');
    wizardState.faDone = true;
    await checkFeederInstallStatus();
  }
});

$('fa-configure-only-btn-wiz').addEventListener('click', async () => {
  await showFaFeederId('fa-feeder-id-display');
  $('fa-post-install').classList.remove('hidden');
  wizardState.faDone = true;
});

/** Fetch and display the PiAware feeder ID. */
async function showFaFeederId(elementId) {
  try {
    const res  = await apiFetch('/api/feeder/flightaware/feeder-id');
    const data = await res.json().catch(() => ({}));
    $(elementId).textContent = data.feeder_id || 'Run: sudo piaware-config feeder-id';
  } catch (_) {
    $(elementId).textContent = 'Run: sudo piaware-config feeder-id';
  }
}

// ── Step 3: Done ──

function buildWizardSummary() {
  const ul = $('wizard-summary');
  ul.innerHTML = '';

  const loc = appSettings.location || {};
  addSummaryItem(ul, '📍', 'Location',
    wizardState.locationSaved && loc.lat
      ? `${parseFloat(loc.lat).toFixed(4)}, ${parseFloat(loc.lon).toFixed(4)}`
      : 'Not set'
  );
  addSummaryItem(ul, '📡', 'Flightradar24',
    wizardState.fr24Done ? 'Configured' : 'Skipped');
  addSummaryItem(ul, '✈', 'FlightAware',
    wizardState.faDone ? 'Configured' : 'Skipped');

  // Mark setup complete on server
  apiFetch('/api/settings', {
    method: 'POST',
    body: JSON.stringify({ setup_complete: true }),
  }).catch(() => {});
  appSettings.setup_complete = true;
}

function addSummaryItem(ul, icon, key, val) {
  const li = document.createElement('li');
  li.innerHTML =
    `<span class="summary-icon">${icon}</span>` +
    `<span class="summary-key">${key}</span>` +
    `<span class="summary-val">${val}</span>`;
  ul.appendChild(li);
}

$('go-to-settings-btn').addEventListener('click', () => {
  hide('wizard');
  showSettingsPanel();
});

// ---------------------------------------------------------------------------
// SETTINGS PANEL
// ---------------------------------------------------------------------------

async function showSettingsPanel() {
  hide('wizard');
  show('settings-panel');

  // Pre-fill location
  const loc = appSettings.location || {};
  if (loc.lat) $('s-lat-input').value = loc.lat;
  if (loc.lon) $('s-lon-input').value = loc.lon;

  // Load service statuses
  await loadServiceStatuses();
}

// ── Tab switching ──

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const target = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = $(`tab-${target}`);
    if (panel) panel.classList.add('active');
    if (target === 'services') loadServiceStatuses();
    if (target === 'feeders') loadFeederStatuses();
  });
});

// ── Location tab ──

$('s-lat-minus').addEventListener('click', () => nudge('s-lat-input', -0.001));
$('s-lat-plus').addEventListener('click',  () => nudge('s-lat-input', +0.001));
$('s-lon-minus').addEventListener('click', () => nudge('s-lon-input', -0.001));
$('s-lon-plus').addEventListener('click',  () => nudge('s-lon-input', +0.001));

$('s-use-location-btn').addEventListener('click', () => {
  if (!navigator.geolocation) {
    $('s-geo-hint').textContent = 'Geolocation not available.';
    return;
  }
  $('s-geo-hint').textContent = 'Requesting location...';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      $('s-lat-input').value = pos.coords.latitude.toFixed(5);
      $('s-lon-input').value = pos.coords.longitude.toFixed(5);
      $('s-geo-hint').textContent =
        `Located: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
    },
    (err) => { $('s-geo-hint').textContent = `Error: ${err.message}`; }
  );
});

$('s-save-location-btn').addEventListener('click', async () => {
  const lat = parseFloat($('s-lat-input').value);
  const lon = parseFloat($('s-lon-input').value);
  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    setError('s-location-error', 'Invalid coordinates');
    return;
  }
  setError('s-location-error', '');
  $('s-save-location-btn').disabled = true;

  try {
    const res = await apiFetch('/api/settings/location', {
      method: 'POST',
      body: JSON.stringify({ lat, lon }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      appSettings.location = { lat, lon };
      setError('s-location-error', '');
      $('s-geo-hint').textContent = 'Saved. readsb restarted.';
      $('s-geo-hint').style.color = 'var(--ok)';
    } else {
      setError('s-location-error', data.error || 'Save failed');
    }
  } catch (err) {
    if (err.message !== 'Unauthorised') setError('s-location-error', 'Request failed');
  } finally {
    $('s-save-location-btn').disabled = false;
  }
});

// ── Feeders tab ──

async function loadFeederStatuses() {
  try {
    const res = await apiFetch('/api/status');
    if (!res.ok) return;
    const statuses = await res.json();
    updateServiceBadge('s-fr24-svc-badge', statuses.fr24feed);
    updateServiceBadge('s-fa-svc-badge',   statuses.piaware);

    // Auto-reveal post-install panels if feeders are already installed
    if (statuses.fr24feed && statuses.fr24feed.status !== 'not installed') {
      showFr24PostInstall('s-fr24-webui-link', 's-fr24-post-install');
    }
    if (statuses.piaware && statuses.piaware.status !== 'not installed') {
      // Only fetch feeder ID if the panel isn't already shown
      if ($('s-fa-post-install').classList.contains('hidden')) {
        await showFaFeederId('s-fa-feeder-id-display');
        $('s-fa-post-install').classList.remove('hidden');
      }
    }
  } catch (_) {}
}

// Settings panel — FR24 install
$('s-fr24-install-btn').addEventListener('click', async () => {
  const termWrap   = $('s-fr24-terminal');
  const termOut    = $('s-fr24-terminal-out');
  const termStatus = $('s-fr24-terminal-status');

  termWrap.classList.add('visible');
  termOut.textContent = '';
  termStatus.innerHTML = '<span class="spinner"></span>';

  const success = await runSseInstall('/api/feeder/fr24/install', termOut, termStatus);
  if (success) {
    showFr24PostInstall('s-fr24-webui-link', 's-fr24-post-install');
    await loadFeederStatuses();
  }
});

$('s-fr24-already-btn').addEventListener('click', () => {
  showFr24PostInstall('s-fr24-webui-link', 's-fr24-post-install');
});

// Settings panel — PiAware install
$('s-fa-install-btn').addEventListener('click', async () => {
  const termWrap   = $('s-fa-terminal');
  const termOut    = $('s-fa-terminal-out');
  const termStatus = $('s-fa-terminal-status');

  termWrap.classList.add('visible');
  termOut.textContent = '';
  termStatus.innerHTML = '<span class="spinner"></span>';

  const success = await runSseInstall('/api/feeder/flightaware/install', termOut, termStatus);
  if (success) {
    await showFaFeederId('s-fa-feeder-id-display');
    $('s-fa-post-install').classList.remove('hidden');
    await loadFeederStatuses();
  }
});

$('s-fa-already-btn').addEventListener('click', async () => {
  await showFaFeederId('s-fa-feeder-id-display');
  $('s-fa-post-install').classList.remove('hidden');
});

function showFr24PostInstall(linkId, panelId) {
  const host = window.location.hostname;
  $(linkId).href = `http://${host}:8754`;
  $(panelId).classList.remove('hidden');
}

// ── Services tab ──

const SERVICE_NAMES = {
  readsb:      'readsb',
  lighttpd:    'lighttpd',
  route_proxy: 'route-proxy',
  settings_api:'settings-api',
  fr24feed:    'fr24feed',
  piaware:     'piaware',
};

async function loadServiceStatuses() {
  const container = $('service-table');
  if (!container) return;

  try {
    const res = await apiFetch('/api/status');
    if (!res.ok) {
      container.innerHTML = '<div class="text-err">Could not load status</div>';
      return;
    }
    const statuses = await res.json();
    container.innerHTML = '';

    const entries = [
      ['readsb',       'readsb',       statuses.readsb],
      ['lighttpd',     'lighttpd',     statuses.lighttpd],
      ['route-proxy',  'route_proxy',  statuses.route_proxy],
      ['settings-api', 'settings_api', statuses.settings_api],
      ['fr24feed',     'fr24feed',     statuses.fr24feed],
      ['piaware',      'piaware',      statuses.piaware],
    ];

    for (const [svcName, svcKey, svc] of entries) {
      const row = buildServiceRow(svcName, svc);
      container.appendChild(row);
    }
  } catch (err) {
    if (err.message !== 'Unauthorised') {
      container.innerHTML = '<div class="text-err">Could not load service status</div>';
    }
  }
}

function buildServiceRow(svcName, svc) {
  const row = document.createElement('div');
  row.className = 'service-row';

  const nameEl = el('span', 'service-name', svcName);

  const badge = el('span', 'status-badge');
  if (!svc || svc.status === 'not installed') {
    renderBadge(badge, 'off', 'not installed');
  } else if (svc.active) {
    renderBadge(badge, 'ok', svc.status.split(' ')[0] || 'active');
  } else {
    renderBadge(badge, 'warn', svc.status.split(' ')[0] || 'stopped');
  }

  // Settings-api can't be restarted from itself (would kill the request)
  const canRestart = svcName !== 'settings-api';
  const isInstalled = svc && svc.status !== 'not installed';

  const btnEl = el('button', 'btn btn-secondary btn-sm', 'Restart');
  btnEl.disabled = !canRestart || !isInstalled;
  if (canRestart && isInstalled) {
    btnEl.addEventListener('click', async () => {
      btnEl.disabled = true;
      btnEl.textContent = 'Restarting...';
      try {
        const res = await apiFetch('/api/service/restart', {
          method: 'POST',
          body: JSON.stringify({ service: svcName }),
        });
        const data = await res.json().catch(() => ({}));
        btnEl.textContent = res.ok ? 'Restarted ✓' : 'Failed ✗';
        btnEl.style.color = res.ok ? 'var(--ok)' : 'var(--err)';
      } catch (_) {
        btnEl.textContent = 'Error';
        btnEl.style.color = 'var(--err)';
      } finally {
        setTimeout(() => {
          btnEl.textContent = 'Restart';
          btnEl.style.color = '';
          btnEl.disabled = false;
        }, 2500);
      }
    });
  }

  row.appendChild(nameEl);
  row.appendChild(badge);
  row.appendChild(btnEl);
  return row;
}

// ── Account tab ──

$('change-pin-btn').addEventListener('click', async () => {
  const newPin     = $('new-pin-input').value;
  const confirmPin = $('confirm-pin-input').value;
  setError('pin-change-error', '');

  if (!newPin || newPin.length < 4) {
    setError('pin-change-error', 'PIN must be at least 4 characters');
    return;
  }
  if (newPin !== confirmPin) {
    setError('pin-change-error', 'PINs do not match');
    return;
  }

  $('change-pin-btn').disabled = true;
  try {
    const res = await apiFetch('/api/auth/set', {
      method: 'POST',
      body: JSON.stringify({ pin: newPin }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      if (data.token) setToken(data.token); // New token may be issued
      setError('pin-change-error', '');
      $('new-pin-input').value = '';
      $('confirm-pin-input').value = '';
      $('change-pin-btn').textContent = 'Updated ✓';
      $('change-pin-btn').style.color = 'var(--ok)';
      setTimeout(() => {
        $('change-pin-btn').textContent = 'Update PIN';
        $('change-pin-btn').style.color = '';
      }, 2500);
    } else {
      setError('pin-change-error', data.error || 'Update failed');
    }
  } catch (err) {
    if (err.message !== 'Unauthorised') setError('pin-change-error', 'Request failed');
  } finally {
    $('change-pin-btn').disabled = false;
  }
});

// ---------------------------------------------------------------------------
// SSE Install runner
// ---------------------------------------------------------------------------

/**
 * Run a POST SSE install stream.
 * Appends lines to termOut, updates termStatus.
 * Returns true on success, false on failure.
 * @param {string} endpoint
 * @param {HTMLElement} termOut
 * @param {HTMLElement} termStatus
 * @returns {Promise<boolean>}
 */
async function runSseInstall(endpoint, termOut, termStatus) {
  const token = getToken();
  return new Promise((resolve) => {
    // EventSource doesn't support POST or custom headers natively.
    // Use fetch with ReadableStream instead.
    fetch(`${API}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: '{}',
    })
    .then((res) => {
      if (res.status === 401) {
        clearToken();
        showPinGate();
        resolve(false);
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) {
            resolve(true);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          // Parse SSE events from buffer
          const parts = buffer.split('\n\n');
          buffer = parts.pop(); // last may be incomplete

          for (const part of parts) {
            for (const line of part.split('\n')) {
              if (line.startsWith('data: ')) {
                try {
                  const evt = JSON.parse(line.slice(6));
                  const cls = evt.line && evt.line.startsWith('$') ? 't-cmd' : '';
                  appendTermLine(termOut, evt.line, cls);

                  if (evt.done) {
                    if (evt.success) {
                      termStatus.textContent = '✓';
                      termStatus.style.color = 'var(--ok)';
                    } else {
                      termStatus.textContent = '✗';
                      termStatus.style.color = 'var(--err)';
                    }
                    resolve(evt.success);
                    return;
                  }
                } catch (_) {}
              }
            }
          }
          pump();
        });
      }
      pump();
    })
    .catch((err) => {
      appendTermLine(termOut, `Connection error: ${err.message}`, 't-err');
      termStatus.textContent = '✗';
      termStatus.style.color = 'var(--err)';
      resolve(false);
    });
  });
}

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

/**
 * Append a line to a terminal <pre> element and auto-scroll.
 * @param {HTMLElement} termEl
 * @param {string} text
 * @param {string} [cls] — extra class on the line span
 */
function appendTermLine(termEl, text, cls) {
  const span = document.createElement('span');
  span.className = 't-line' + (cls ? ` ${cls}` : '');
  span.textContent = text;
  termEl.appendChild(span);
  termEl.appendChild(document.createTextNode('\n'));
  // Auto-scroll to bottom
  termEl.scrollTop = termEl.scrollHeight;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async function boot() {
  const token = getToken();
  if (token) {
    // Try to load settings directly — apiFetch will redirect to PIN gate on 401
    try {
      const res = await apiFetch('/api/settings');
      if (res.ok) {
        appSettings = await res.json();
        hidePinGate();
        if (appSettings.setup_complete) {
          showSettingsPanel();
        } else {
          showWizard();
        }
        return;
      }
    } catch (_) {}
  }
  // No valid token — determine pin mode and show gate
  await checkPinMode();
  showPinGate();
})();

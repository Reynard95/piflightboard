/* ── E-INK THEME DEFINITIONS ── */
const EINK_THEMES = [
  {
    id: 'white', label: 'WHITE',
    vars: {
      '--fg':         '#000000',
      '--fg-dim':     '#555555',
      '--fg-mid':     '#222222',
      '--bg':         '#ffffff',
      '--sep':        '#cccccc',
      '--footer-bg':  '#000000',
      '--footer-fg':  '#ffffff',
    },
  },
  {
    id: 'black', label: 'BLACK',
    vars: {
      '--fg':         '#ffffff',
      '--fg-dim':     '#aaaaaa',
      '--fg-mid':     '#dddddd',
      '--bg':         '#000000',
      '--sep':        '#333333',
      '--footer-bg':  '#ffffff',
      '--footer-fg':  '#000000',
    },
  },
  {
    id: 'color', label: 'COLOR',
    vars: {
      '--fg':         '#FFA040',
      '--fg-dim':     '#7A4400',
      '--fg-mid':     '#C87828',
      '--bg':         '#050200',
      '--sep':        '#1c0e00',
      '--footer-bg':  '#0e0700',
      '--footer-fg':  '#FFA040',
    },
  },
];

/* ── STORAGE WRAPPER ── */
function einkStorageGet(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch(e) { return fallback; }
}
function einkStorageSet(key, val) {
  try { localStorage.setItem(key, val); } catch(e) {}
}

/* ── APPLY THEME ── */
function applyEinkTheme(theme) {
  if (!theme) return;
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, val);
  }
  einkStorageSet('eink-theme', theme.id);
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme.label;
}

/* ── CYCLE THEME ── */
function cycleTheme() {
  const current = einkStorageGet('eink-theme', 'white');
  const idx     = EINK_THEMES.findIndex(t => t.id === current);
  const next    = EINK_THEMES[(idx + 1) % EINK_THEMES.length];
  applyEinkTheme(next);
}

/* ── RESTORE ON LOAD ── */
(function () {
  try {
    const saved = einkStorageGet('eink-theme', 'white');
    const theme = EINK_THEMES.find(t => t.id === saved) || EINK_THEMES[0];
    applyEinkTheme(theme);
  } catch(e) {}
})();

/* ── THEME DEFINITIONS ── */
const THEMES = [
  {
    id: 'amber', label: 'AMBER',
    vars: {
      '--amber': '#FFA040', '--amber-dim': '#7A4400',
      '--amber-mid': '#C87828', '--amber-bright': '#FFD080',
      '--bg': '#050200', '--card': '#0e0700', '--sep': '#1c0e00',
    },
  },
  {
    id: 'green', label: 'GREEN',
    vars: {
      '--amber': '#33EE55', '--amber-dim': '#0C5520',
      '--amber-mid': '#20AA40', '--amber-bright': '#88FF99',
      '--bg': '#000802', '--card': '#001205', '--sep': '#001a08',
    },
  },
  {
    id: 'blue', label: 'BLUE FIDS',
    vars: {
      '--amber': '#4499FF', '--amber-dim': '#0A2266',
      '--amber-mid': '#2266CC', '--amber-bright': '#88CCFF',
      '--bg': '#000308', '--card': '#000812', '--sep': '#001030',
    },
  },
  {
    id: 'gold', label: 'GOLD',
    vars: {
      '--amber': '#FFD700', '--amber-dim': '#7A5500',
      '--amber-mid': '#CCA800', '--amber-bright': '#FFE85A',
      '--bg': '#060400', '--card': '#0e0a00', '--sep': '#1e1400',
    },
  },
  {
    id: 'red', label: 'RADAR',
    vars: {
      '--amber': '#FF3333', '--amber-dim': '#660000',
      '--amber-mid': '#CC1111', '--amber-bright': '#FF8888',
      '--bg': '#050000', '--card': '#0e0000', '--sep': '#1a0000',
    },
  },
  {
    id: 'cyan', label: 'CYAN',
    vars: {
      '--amber': '#00FFEE', '--amber-dim': '#005550',
      '--amber-mid': '#00CCBB', '--amber-bright': '#80FFF8',
      '--bg': '#000505', '--card': '#000e0c', '--sep': '#001a18',
    },
  },
  {
    id: 'purple', label: 'NEON',
    vars: {
      '--amber': '#CC44FF', '--amber-dim': '#440066',
      '--amber-mid': '#9922DD', '--amber-bright': '#EE88FF',
      '--bg': '#020005', '--card': '#08000e', '--sep': '#10001a',
    },
  },
  {
    id: 'white', label: 'WHITE',
    vars: {
      '--amber': '#FFFFFF', '--amber-dim': '#888888',
      '--amber-mid': '#CCCCCC', '--amber-bright': '#FFFFFF',
      '--bg': '#030303', '--card': '#0a0a0a', '--sep': '#181818',
    },
  },
];

/* ── APPLY A THEME ── */
function applyTheme(theme) {
  const root = document.documentElement;
  for (const [prop, val] of Object.entries(theme.vars)) {
    root.style.setProperty(prop, val);
  }
  localStorage.setItem('fb-theme', theme.id);
  /* Update button label if present */
  const btn = document.getElementById('theme-btn');
  if (btn) btn.textContent = theme.label;
}

/* ── CYCLE TO NEXT THEME ── */
function cycleTheme() {
  const current = localStorage.getItem('fb-theme') || 'amber';
  const idx     = THEMES.findIndex(t => t.id === current);
  const next    = THEMES[(idx + 1) % THEMES.length];
  applyTheme(next);
}

/* ── RESTORE ON LOAD ── */
(function () {
  const saved = localStorage.getItem('fb-theme') || 'amber';
  const theme = THEMES.find(t => t.id === saved) || THEMES[0];
  applyTheme(theme);
})();

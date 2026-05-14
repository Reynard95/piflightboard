/* ── E-INK CONFIG ───────────────────────────────────────────────────────────
 *  All URL parameters (combine freely):
 *
 *  ?theme=white          white bg, black text (default)
 *  ?theme=black          black bg, white text
 *  ?theme=color          dark bg, amber/orange text
 *
 *  ?orientation=landscape   side-by-side route (default)
 *  ?orientation=portrait    stacked vertical route
 *
 *  Examples:
 *    eink.html
 *    eink.html?theme=black&orientation=portrait
 *    eink-focus.html?theme=color&orientation=portrait&res=480x800
 *    eink-focus.html?theme=white&orientation=landscape&res=800x480
 * ───────────────────────────────────────────────────────────────────────── */

const EINK_THEMES = {
  white: {
    '--fg':     '#000000',
    '--fg-dim': '#555555',
    '--fg-mid': '#222222',
    '--bg':     '#ffffff',
    '--sep':    '#cccccc',
  },
  black: {
    '--fg':     '#ffffff',
    '--fg-dim': '#aaaaaa',
    '--fg-mid': '#dddddd',
    '--bg':     '#000000',
    '--sep':    '#333333',
  },
  color: {
    '--fg':     '#FFA040',
    '--fg-dim': '#7A4400',
    '--fg-mid': '#C87828',
    '--bg':     '#050200',
    '--sep':    '#1c0e00',
  },
};

(function () {
  try {
    const params = new URLSearchParams(window.location.search);
    const root   = document.documentElement;

    /* ── Theme ── */
    const theme = params.get('theme') || 'white';
    const vars  = EINK_THEMES[theme] || EINK_THEMES.white;
    for (const [prop, val] of Object.entries(vars)) {
      root.style.setProperty(prop, val);
    }

    /* ── Orientation — adds .portrait class; landscape is the default ── */
    if ((params.get('orientation') || 'landscape') === 'portrait') {
      root.classList.add('portrait');
    }

    /* ── Focus mode — enables focus-specific CSS overrides ── */
    if (params.has('focus')) {
      root.classList.add('focus-mode');
    }
  } catch(e) {}
})();

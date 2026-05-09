/* ── E-INK THEMES ──────────────────────────────────────────────────────────
 *  Theme is set via URL parameter:  ?theme=white  |  ?theme=black  |  ?theme=color
 *  Default when no parameter: white
 *
 *  Examples:
 *    http://flighttracker.local/tar1090/eink.html
 *    http://flighttracker.local/tar1090/eink.html?theme=black
 *    http://flighttracker.local/tar1090/eink.html?theme=color
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
    const param = new URLSearchParams(window.location.search).get('theme') || 'white';
    const vars  = EINK_THEMES[param] || EINK_THEMES.white;
    const root  = document.documentElement;
    for (const [prop, val] of Object.entries(vars)) {
      root.style.setProperty(prop, val);
    }
  } catch(e) {}
})();

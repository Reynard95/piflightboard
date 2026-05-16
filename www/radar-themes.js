/* radar-themes.js — manufacturer-inspired radar themes
 * Reads ?theme= and applies CSS custom properties to :root.
 * Default theme for radar.html is 'color' (set by inline script before this runs).
 */
(function () {
  const THEMES = {
    color: {
      '--bg':     '#050200',
      '--fg':     '#FFA040',
      '--fg-mid': '#CC7020',
      '--fg-dim': '#7A4010',
      '--sep':    '#3A1E08',
      '--accent': '#FF8000',
      '--land':   '#1E1208',   /* noticeably lighter than --bg for map contrast */
    },
    airbus: {
      '--bg':     '#06080F',
      '--fg':     '#7EB3E8',
      '--fg-mid': '#4A7AB0',
      '--fg-dim': '#243C5A',
      '--sep':    '#152030',
      '--accent': '#3A8FD4',
      '--land':   '#0F1828',
    },
    boeing: {
      '--bg':     '#060508',
      '--fg':     '#C8A84B',
      '--fg-mid': '#8A7030',
      '--fg-dim': '#483A18',
      '--sep':    '#28200C',
      '--accent': '#F0C040',
      '--land':   '#181208',
    },
    embraer: {
      '--bg':     '#050A09',
      '--fg':     '#5FC4B0',
      '--fg-mid': '#348878',
      '--fg-dim': '#1A4840',
      '--sep':    '#0E2824',
      '--accent': '#2EA898',
      '--land':   '#0D2018',
    },
    bombardier: {
      '--bg':     '#080505',
      '--fg':     '#E87070',
      '--fg-mid': '#A03838',
      '--fg-dim': '#581818',
      '--sep':    '#300C0C',
      '--accent': '#CC4444',
      '--land':   '#200C0C',
    },
    military: {
      '--bg':     '#030603',
      '--fg':     '#5EBF5E',
      '--fg-mid': '#388038',
      '--fg-dim': '#1A401A',
      '--sep':    '#0C200C',
      '--accent': '#3A9A3A',
      '--land':   '#0C1A0A',
    },
  };

  const params = new URLSearchParams(window.location.search);
  const key    = params.get('theme') || 'color';
  const theme  = THEMES[key] || THEMES.color;
  const root   = document.documentElement;

  Object.entries(theme).forEach(([prop, val]) => {
    root.style.setProperty(prop, val);
  });
})();

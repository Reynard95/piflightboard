/* themes.js — unified theme system for all pages
 *
 * Reads ?theme= from URL and applies CSS custom properties to :root.
 * Default theme is read from <html data-theme-default="..."> (falls back to 'color').
 *
 * Themes:
 *   white       — white bg, black text        (e-ink, animations disabled)
 *   black       — black bg, white text        (e-ink, animations disabled)
 *   color       — amber on near-black         (default for most pages)
 *   airbus      — steel blue on dark navy
 *   boeing      — gold on dark brown
 *   embraer     — teal on dark green-black
 *   bombardier  — coral red on near-black
 *   military    — radar green on near-black
 *
 * Also handles:
 *   ?orientation=portrait  → adds .portrait to <html>  (main.html)
 *   ?focus                 → adds .focus-mode to <html> (main.html)
 *
 * Exposes window.THEMES so radar.js can re-apply on menu change.
 */

(function () {
  const THEMES = {
    white: {
      '--bg':     '#ffffff',
      '--fg':     '#000000',
      '--fg-mid': '#444444',
      '--fg-dim': '#888888',
      '--sep':    '#cccccc',
      '--accent': '#000000',
      '--land':   '#e8e8e8',
      '--warn':   '#886600',
      '--danger': '#cc0000',
      _eink: true,
    },
    black: {
      '--bg':     '#000000',
      '--fg':     '#ffffff',
      '--fg-mid': '#bbbbbb',
      '--fg-dim': '#777777',
      '--sep':    '#333333',
      '--accent': '#ffffff',
      '--land':   '#111111',
      '--warn':   '#cccc00',
      '--danger': '#ff4444',
      _eink: true,
    },
    color: {
      '--bg':     '#050200',
      '--fg':     '#FFA040',
      '--fg-mid': '#CC7020',
      '--fg-dim': '#7A4010',
      '--sep':    '#3A1E08',
      '--accent': '#FF8000',
      '--land':   '#1E1208',
      '--warn':   '#FFC040',
      '--danger': '#FF5050',
    },
    airbus: {
      '--bg':     '#06080F',
      '--fg':     '#7EB3E8',
      '--fg-mid': '#4A7AB0',
      '--fg-dim': '#243C5A',
      '--sep':    '#152030',
      '--accent': '#3A8FD4',
      '--land':   '#0F1828',
      '--warn':   '#B0D8F8',
      '--danger': '#FF6060',
    },
    boeing: {
      '--bg':     '#060508',
      '--fg':     '#C8A84B',
      '--fg-mid': '#8A7030',
      '--fg-dim': '#483A18',
      '--sep':    '#28200C',
      '--accent': '#F0C040',
      '--land':   '#181208',
      '--warn':   '#F0D060',
      '--danger': '#FF6060',
    },
    embraer: {
      '--bg':     '#050A09',
      '--fg':     '#5FC4B0',
      '--fg-mid': '#348878',
      '--fg-dim': '#1A4840',
      '--sep':    '#0E2824',
      '--accent': '#2EA898',
      '--land':   '#0D2018',
      '--warn':   '#90E8D8',
      '--danger': '#FF6060',
    },
    bombardier: {
      '--bg':     '#080505',
      '--fg':     '#E87070',
      '--fg-mid': '#A03838',
      '--fg-dim': '#581818',
      '--sep':    '#300C0C',
      '--accent': '#CC4444',
      '--land':   '#200C0C',
      '--warn':   '#F8B0B0',
      '--danger': '#FF9090',
    },
    military: {
      '--bg':     '#030603',
      '--fg':     '#5EBF5E',
      '--fg-mid': '#388038',
      '--fg-dim': '#1A401A',
      '--sep':    '#0C200C',
      '--accent': '#3A9A3A',
      '--land':   '#0C1A0A',
      '--warn':   '#A0F0A0',
      '--danger': '#FF6060',
    },
  };

  /* Expose for radar.js applyThemeByName() */
  window.THEMES = THEMES;

  const params       = new URLSearchParams(window.location.search);
  const defaultTheme = document.documentElement.dataset.themeDefault || 'color';
  const key          = params.get('theme') || defaultTheme;
  const theme        = THEMES[key] || THEMES[defaultTheme];
  const root         = document.documentElement;

  /* Apply CSS custom properties */
  Object.entries(theme).forEach(([prop, val]) => {
    if (!prop.startsWith('_')) root.style.setProperty(prop, val);
  });

  /* E-ink: add classes and inject animation-kill rule */
  if (theme._eink) {
    root.classList.add('eink', 'no-anim');
    const s = document.createElement('style');
    s.textContent =
      'html.no-anim *, html.no-anim *::before, html.no-anim *::after ' +
      '{ animation: none !important; transition: none !important; }';
    document.head.appendChild(s);
  }

  /* Orientation (main.html) */
  if (params.get('orientation') === 'portrait') root.classList.add('portrait');

  /* Focus mode (main.html) */
  if (params.has('focus')) root.classList.add('focus-mode');
})();

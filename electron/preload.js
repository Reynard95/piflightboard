'use strict';

/* CRT preload — injected into the radar page by Electron before page scripts run.
 * Applies a phosphor-green palette and overlays scanlines, vignette, and flicker
 * on top of the existing radar UI without modifying any www/ source files.
 */

window.addEventListener('DOMContentLoaded', () => {

  /* ── 1. Phosphor green palette ────────────────────────────────────────────
   * Overrides whatever theme URL params set — themes.js runs first and sets
   * vars, but DOMContentLoaded fires after all inline scripts have run. */
  const root    = document.documentElement;
  const palette = {
    '--bg':      '#000a00',
    '--fg':      '#00ff41',
    '--fg-mid':  '#00cc33',
    '--fg-dim':  '#007a22',
    '--sep':     '#003311',
    '--accent':  '#00ff41',
    '--land':    '#001a00',
    '--warn':    '#aaff44',
    '--danger':  '#ff5555',
  };
  Object.entries(palette).forEach(([k, v]) => root.style.setProperty(k, v));

  /* ── 2. CRT overlay styles ───────────────────────────────────────────────*/
  const style = document.createElement('style');
  style.textContent = `

    /* Rounded screen — Electron window backgroundColor is the bezel */
    html, body {
      border-radius: 22px !important;
      overflow: hidden !important;
    }

    /* Full-screen scanlines */
    #crt-scanlines {
      position: fixed;
      inset: 0;
      z-index: 99999;
      pointer-events: none;
      border-radius: 22px;
      background: repeating-linear-gradient(
        0deg,
        transparent            0px,
        transparent            2px,
        rgba(0, 0, 0, 0.22)   2px,
        rgba(0, 0, 0, 0.22)   3px
      );
    }

    /* Edge vignette */
    #crt-vignette {
      position: fixed;
      inset: 0;
      z-index: 99998;
      pointer-events: none;
      border-radius: 22px;
      background: radial-gradient(
        ellipse 82% 88% at 50% 50%,
        transparent 48%,
        rgba(0, 0, 0, 0.82) 100%
      );
    }

    /* Slow screen flicker */
    @keyframes crt-flicker {
      0%,  100% { opacity: 1.000; }
      12%        { opacity: 0.960; }
      25%        { opacity: 1.000; }
      55%        { opacity: 1.000; }
      68%        { opacity: 0.975; }
      72%        { opacity: 1.000; }
    }
    body { animation: crt-flicker 9s ease-in-out infinite !important; }

    /* Phosphor glow on VT323 type (large display text) */
    .rf-val,
    .card-airline, .card-flight, .card-type, .card-field-val,
    .live-label, .radar-title, .rc-val,
    .menu-panel, .menu-section-title, .menu-opt {
      text-shadow:
        0 0 4px rgba(0, 255, 65, 0.9),
        0 0 12px rgba(0, 255, 65, 0.4) !important;
    }

    /* Dimmer glow on small labels */
    .rf-lbl, .card-field-lbl, .card-dist, .card-top-row,
    .lr-dist, .lr-cs, .lr-airline, .lr-type, .lr-alt, .lr-spd, .lr-route {
      text-shadow: 0 0 5px rgba(0, 255, 65, 0.35) !important;
    }

    /* Canvas — very slight brightness boost + phosphor bloom */
    #radar-canvas {
      filter: brightness(1.1) contrast(1.06) !important;
    }

    /* Stronger, more glowing sweep arm */
    .sweep-arm {
      opacity: 0.85 !important;
      filter: blur(0.5px) !important;
    }

    /* Live indicator pulse */
    .live-dot {
      box-shadow:
        0 0 4px var(--fg),
        0 0 10px var(--fg),
        0 0 20px rgba(0, 255, 65, 0.4) !important;
      animation: crt-pulse 2s ease-in-out infinite !important;
    }
    @keyframes crt-pulse {
      0%, 100% { opacity: 1.0; }
      50%       { opacity: 0.5; }
    }

    /* Aircraft card hover glow */
    .ac-card:hover, .ac-list-row:hover {
      box-shadow: 0 0 8px rgba(0, 255, 65, 0.25) !important;
    }
    .ac-card.selected, .ac-list-row.selected {
      box-shadow: 0 0 12px rgba(0, 255, 65, 0.45) !important;
    }

    /* Phosphor-green scrollbar */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: #000a00; }
    ::-webkit-scrollbar-thumb { background: #007a22; border-radius: 2px; }
    ::-webkit-scrollbar-thumb:hover { background: #00cc33; }

  `;
  document.head.appendChild(style);

  /* ── 3. Overlay elements ─────────────────────────────────────────────────*/
  const scanlines = document.createElement('div');
  scanlines.id = 'crt-scanlines';
  document.body.appendChild(scanlines);

  const vignette = document.createElement('div');
  vignette.id = 'crt-vignette';
  document.body.appendChild(vignette);

});

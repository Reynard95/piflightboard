#!/usr/bin/env node
/**
 * tests/check.js — Static analysis suite (no external dependencies)
 *
 * Run:  node tests/check.js
 * Exit: 0 = all pass, 1 = failures found
 *
 * Checks:
 *  1. JS syntax  — node --check on every .js file in www/
 *  2. HTML/JS    — node --check on every inline <script> block in www/*.html
 *  3. Integrity  — every HTML file ends with </html>, every JS file has a
 *                  non-empty last line (no truncation mid-statement)
 *  4. Dashboard  — invariants that have caused regressions:
 *                  · IIFE opens and closes
 *                  · GridStack.init( present
 *                  · No duplicate function declarations
 *                  · cfg-refresh querySelectorAll event-listener present
 *                  · </script> closes the inline block
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const WWW   = path.join(__dirname, '..', 'www');
const PASS  = '\x1b[32m✓\x1b[0m';
const FAIL  = '\x1b[31m✗\x1b[0m';
const WARN  = '\x1b[33m!\x1b[0m';

let failures = 0;

function pass(msg)  { console.log(`  ${PASS} ${msg}`); }
function fail(msg)  { console.error(`  ${FAIL} ${msg}`); failures++; }
function header(msg){ console.log(`\n\x1b[1m${msg}\x1b[0m`); }

/* ─── helpers ──────────────────────────────────────────────────────────── */

function nodeCheck(code, label) {
  const tmp = path.join(require('os').tmpdir(), `fc_check_${Date.now()}.js`);
  fs.writeFileSync(tmp, code);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status === 0) {
    pass(`syntax OK — ${label}`);
    return true;
  } else {
    // Extract the first meaningful error line
    const err = (r.stderr || '').split('\n')
      .filter(l => l.includes('SyntaxError') || l.match(/^\S+:\d+$/))
      .slice(0, 1).join('').replace(tmp, label);
    fail(`syntax ERROR — ${label}${err ? ': ' + err : ''}`);
    return false;
  }
}

function extractInlineScripts(html) {
  const scripts = [];
  const re = /<script(?!\s+src)(?:\s[^>]*)?>([^]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].trim()) scripts.push(m[1]);
  }
  return scripts;
}

/* ─── 1. JS file syntax ─────────────────────────────────────────────────── */

header('1. JS file syntax');

const jsFiles = fs.readdirSync(WWW)
  .filter(f => f.endsWith('.js'))
  .map(f => path.join(WWW, f));

for (const file of jsFiles) {
  const code = fs.readFileSync(file, 'utf8');
  nodeCheck(code, path.relative(process.cwd(), file));
}

/* ─── 2. Inline <script> syntax ─────────────────────────────────────────── */

header('2. Inline <script> syntax');

const htmlFiles = fs.readdirSync(WWW)
  .filter(f => f.endsWith('.html'))
  .map(f => path.join(WWW, f));

for (const file of htmlFiles) {
  const html    = fs.readFileSync(file, 'utf8');
  const scripts = extractInlineScripts(html);
  if (scripts.length === 0) {
    pass(`no inline scripts — ${path.basename(file)}`);
    continue;
  }
  scripts.forEach((code, i) => {
    const label = `${path.basename(file)} (script #${i + 1})`;
    nodeCheck(code, label);
  });
}

/* ─── 3. File integrity ─────────────────────────────────────────────────── */

header('3. File integrity (no truncation)');

for (const file of htmlFiles) {
  const content = fs.readFileSync(file, 'utf8').trimEnd();
  const label   = path.basename(file);
  if (content.endsWith('</html>')) {
    pass(`ends with </html> — ${label}`);
  } else {
    fail(`TRUNCATED — ${label} does not end with </html> (ends: ...${JSON.stringify(content.slice(-40))})`);
  }
}

for (const file of jsFiles) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const last  = lines[lines.length - 1];
  const label = path.basename(file);
  // A truncated file often ends mid-token (no semicolon/brace/comment)
  if (last.trim() === '' || last.trim().endsWith(';') || last.trim().endsWith('}') || last.trim().endsWith('*/')) {
    pass(`clean ending — ${label}`);
  } else {
    // Not necessarily wrong (e.g. trailing comment), just warn
    console.log(`  ${WARN} unexpected last line in ${label}: ${JSON.stringify(last.slice(0, 60))}`);
  }
}

/* ─── 4. Dashboard invariants ───────────────────────────────────────────── */

header('4. Dashboard-specific invariants');

const dashPath = path.join(WWW, 'dashboard.html');
const dash     = fs.readFileSync(dashPath, 'utf8');

// Helper: count occurrences
const count = (src, needle) => {
  let n = 0, pos = 0;
  while ((pos = src.indexOf(needle, pos)) !== -1) { n++; pos += needle.length; }
  return n;
};

const checks = [
  ['GridStack.init( present',                () => dash.includes('GridStack.init(')],
  ['IIFE wrapper opens — (function () {',    () => dash.includes('(function () {')],
  ['IIFE wrapper closes — })();',            () => dash.includes('})();')],
  ['computeCellHeight function defined',      () => dash.includes('function computeCellHeight()')],
  ['colCount function defined',               () => dash.includes('function colCount()')],
  ['window.innerHeight used (not offsetHeight)', () => dash.includes('window.innerHeight') && !dash.includes('grid-wrap.offsetHeight')],
  ['cfg-refresh querySelectorAll present',    () => dash.includes("querySelectorAll('#cfg-refresh")],
  ['CONFIG modal HTML present',               () => dash.includes('id="config-overlay"')],
  ['PRESETS modal HTML present',              () => dash.includes('id="preset-overlay"')],
  ['No duplicate function esc()',             () => count(dash, 'function esc(') === 1],
  ['No duplicate function computeCellHeight', () => count(dash, 'function computeCellHeight()') === 1],
  ['No duplicate GridStack.init',             () => count(dash, 'GridStack.init(') === 1],
  ['All 5 panels present (gs-id=)',           () => {
    const ids = ['flight', 'vitals', 'spectrum', 'weather', 'radar'];
    return ids.every(id => dash.includes(`gs-id="${id}"`));
  }],
  ['Inline script is closed (</script>)',     () => {
    // There should be exactly 2 </script> tags: CDN + inline
    return count(dash, '</script>') === 2;
  }],
  ['File ends with </html>',                  () => dash.trimEnd().endsWith('</html>')],
];

for (const [label, fn] of checks) {
  try {
    fn() ? pass(label) : fail(label);
  } catch (e) {
    fail(`${label} — threw: ${e.message}`);
  }
}

/* ─── 5. CSS file integrity ──────────────────────────────────────────────── */

header('5. CSS integrity');

const cssFiles = fs.readdirSync(WWW)
  .filter(f => f.endsWith('.css'))
  .map(f => path.join(WWW, f));

// Required classes per CSS file
const CSS_REQUIRES = {
  'main.css':     ['.board', '.data-grid', '.data-value', '.telem-row'],
  'base.css':     ['.page-shell', '.page-header'],
  'vitals.css':   ['.vitals-grid', '.vitals-card', '.sparkline'],
  'weather.css':  ['.wx-cards', '.wx-card', '.forecast-wrap'],
  'radar.css':    ['#radar-canvas'],
};

for (const file of cssFiles) {
  const css    = fs.readFileSync(file, 'utf8');
  const name   = path.basename(file);
  const needed = CSS_REQUIRES[name] || [];
  const missing = needed.filter(cls => !css.includes(cls));
  if (missing.length === 0) {
    pass(`required classes present — ${name}`);
  } else {
    fail(`missing classes in ${name}: ${missing.join(', ')}`);
  }
}

/* ─── Summary ───────────────────────────────────────────────────────────── */

console.log('');
if (failures === 0) {
  console.log(`\x1b[32m\x1b[1mAll checks passed.\x1b[0m`);
  process.exit(0);
} else {
  console.error(`\x1b[31m\x1b[1m${failures} check(s) failed.\x1b[0m`);
  process.exit(1);
}

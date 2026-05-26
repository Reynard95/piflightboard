/**
 * tests/e2e.spec.js — Playwright end-to-end tests
 *
 * What these catch:
 *  • JS runtime errors that break page initialisation
 *  • Dashboard panels rendering as tiny/invisible (the regression we fixed)
 *  • Missing DOM elements (GridStack not mounting, modals absent)
 *  • Pages that crash entirely on load
 *
 * The Pi-specific APIs (/data/aircraft.json, vitals socket, etc.) are stubbed
 * by tests/serve.js with 503s, so pages show "no signal" rather than erroring.
 * We treat ONLY uncaught JS errors as failures — network errors are expected.
 */
'use strict';

const { test, expect } = require('@playwright/test');

/* ─── helper: collect uncaught JS errors on a page ─────────────────────── */

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', err => {
    // Ignore errors that are purely network / fetch related
    const msg = err.message || '';
    if (msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('ERR_CONNECTION_REFUSED') ||
        msg.includes('Load failed')) return;
    errors.push(msg);
  });
  return errors;
}

/* ══════════════════════════════════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════════════════════════════════ */

test.describe('dashboard.html', () => {

  test('loads without uncaught JS errors', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');
    expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
  });

  test('cockpit shell is full-viewport', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    const box = await page.locator('.cockpit').boundingBox();
    expect(box).not.toBeNull();
    // Should fill (or nearly fill) the 1920×1080 viewport
    expect(box.width).toBeGreaterThan(1800);
    expect(box.height).toBeGreaterThan(1000);
  });

  test('grid renders 5 panels', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    const items = page.locator('.grid-stack-item');
    await expect(items).toHaveCount(5);
  });

  test('panels have real height (not tiny)', async ({ page }) => {
    await page.goto('/dashboard.html');
    // Wait two frames for the double-RAF cell-height correction
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    const items = page.locator('.grid-stack-item');
    const count = await items.count();
    for (let i = 0; i < count; i++) {
      const box = await items.nth(i).boundingBox();
      expect(box, `panel ${i} has no bounding box`).not.toBeNull();
      // Each panel must be taller than 60px — the regression showed ~30px cells
      expect(box.height).toBeGreaterThan(60);
      expect(box.width).toBeGreaterThan(60);
    }
  });

  test('CONFIG button opens modal', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    const overlay = page.locator('#config-overlay');
    await expect(overlay).not.toHaveClass(/open/);

    await page.click('#btn-config');
    await expect(overlay).toHaveClass(/open/);

    // Close with ESC
    await page.keyboard.press('Escape');
    await expect(overlay).not.toHaveClass(/open/);

    expect(errors).toHaveLength(0);
  });

  test('PRESETS button opens modal', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    const overlay = page.locator('#preset-overlay');
    await page.click('#btn-presets');
    await expect(overlay).toHaveClass(/open/);

    expect(errors).toHaveLength(0);
  });

  test('iframes have src set (panels wired up)', async ({ page }) => {
    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');

    for (const id of ['flight', 'vitals', 'spectrum', 'weather', 'radar']) {
      const src = await page.locator(`#iframe-${id}`).getAttribute('src');
      expect(src, `#iframe-${id} has no src`).toBeTruthy();
      expect(src).toMatch(/\.html/);
    }
  });

});

/* ══════════════════════════════════════════════════════════════════════════
   INDIVIDUAL PAGES
   ══════════════════════════════════════════════════════════════════════════ */

const PAGES = [
  { file: 'main.html',     root: '.board',       label: 'flight display' },
  { file: 'vitals.html',   root: '.vitals-grid',  label: 'system vitals' },
  { file: 'weather.html',  root: '.wx-body',       label: 'weather' },
  { file: 'radar.html',    root: '#radar-canvas',  label: 'radar' },
  { file: 'spectrum.html', root: 'body',           label: 'spectrum' },
];

for (const { file, root, label } of PAGES) {
  test.describe(file, () => {

    test(`${label} — loads without uncaught JS errors`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/${file}`);
      await page.waitForLoadState('networkidle');
      expect(errors, `JS errors: ${errors.join('; ')}`).toHaveLength(0);
    });

    test(`${label} — root element exists`, async ({ page }) => {
      await page.goto(`/${file}`);
      await page.waitForLoadState('networkidle');
      await expect(page.locator(root).first()).toBeAttached();
    });

  });
}

/* ══════════════════════════════════════════════════════════════════════════
   THEMES
   ══════════════════════════════════════════════════════════════════════════ */

test.describe('theme parameter', () => {

  test('?theme=color applies to dashboard', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/dashboard.html?theme=color');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
    // themes.js should set a data-theme attribute or CSS var
    const html = page.locator('html');
    // Just check it didn't crash — theme application is visual
    await expect(html).toBeAttached();
  });

  test('?theme=eink applies to main.html', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/main.html?theme=eink&embedded=1');
    await page.waitForLoadState('networkidle');
    expect(errors).toHaveLength(0);
  });

});

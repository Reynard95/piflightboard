// playwright.config.js
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir:  './tests',
  testMatch: '**/*.spec.js',
  timeout:   30_000,
  retries:   0,

  // Spin up a static file server over www/ before tests run
  webServer: {
    command: 'node tests/serve.js',
    url:     'http://localhost:3737',
    timeout:  10_000,
    reuseExistingServer: false,
  },

  use: {
    baseURL:           'http://localhost:3737',
    headless:          true,
    viewport:          { width: 1920, height: 1080 },
    // Ignore network errors to external APIs (Pi data, weather, etc.)
    ignoreHTTPSErrors: true,
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});

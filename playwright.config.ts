import { defineConfig, devices } from '@playwright/test';

// The default 4173 is also the port the deployed Folio container publishes on a
// dev box. reuseExistingServer then "finds a server", talks to the AUTHED one,
// gets a 401 and every spec fails looking for a canvas — an infra collision that
// reads exactly like a broken editor. Override the port to run beside it:
//   PLAYWRIGHT_PORT=4399 npx playwright test
const PORT = Number(process.env['PLAYWRIGHT_PORT'] ?? 4173);

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['list'],
    ['html', { outputFolder: 'tests/playwright-report', open: 'never' }],
  ],

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  // Visual regression snapshot directory
  snapshotDir: './tests/visual/snapshots',
  snapshotPathTemplate: '{snapshotDir}/{testFilePath}/{arg}{ext}',

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],

  // Start the preview server before running E2E tests
  webServer: {
    command: `npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});

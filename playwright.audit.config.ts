import { defineConfig, devices } from '@playwright/test';

// The default 4173 is also the port the deployed Folio container publishes on a
// dev box. reuseExistingServer then "finds a server", talks to the AUTHED one,
// gets a 401 and every spec fails looking for a canvas — an infra collision
// that reads exactly like broken chrome. Override the port to run beside it:
//   PLAYWRIGHT_PORT=4399 npx playwright test --config=playwright.audit.config.ts
const PORT = Number(process.env['PLAYWRIGHT_PORT'] ?? 4173);

export default defineConfig({
  testDir: './tests/ui-audit',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});

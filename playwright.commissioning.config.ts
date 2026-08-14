import { defineConfig, devices } from '@playwright/test';
import * as path from 'path';

/**
 * COMMISSIONING SUITE — "turn the plant on and check every output".
 *
 * Deliberately NOT the same setup as playwright.config.ts:
 *
 *  · It boots src/editor/static-server.ts (bun, straight from source) rather
 *    than `vite preview`, because that is what production runs AND it is the
 *    only one that serves /__project_files/* — without it no design can load
 *    an asset, so an asset check against `vite preview` would be meaningless.
 *  · FOLIO_PROJECTS_DIR points at committed fixtures, never the developer's
 *    own folio-projects/. A suite that reads real user data passes or fails
 *    for reasons that have nothing to do with the code.
 *  · A fixed token is supplied because the editor gates project files on auth
 *    in every environment; the suite exercises the real gate rather than a
 *    special unlocked mode.
 */
const PORT = Number(process.env['COMMISSIONING_PORT'] ?? 4477);
const TOKEN = process.env['FOLIO_COMMISSIONING_TOKEN'] ?? 'commissioning-token';
const FIXTURES = path.resolve(process.cwd(), 'tests/commissioning/fixtures/projects');

export default defineConfig({
  testDir: './tests/commissioning',
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: 'tests/commissioning/report', open: 'never' }]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    ...devices['Desktop Chrome'],
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'commissioning', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bun run src/editor/static-server.ts`,
    url: `http://localhost:${PORT}/`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      FOLIO_PROJECTS_DIR: FIXTURES,
      FOLIO_LIBRARY_DIR: path.join(FIXTURES, '.library/assets'),
      FOLIO_API_KEY: TOKEN,
    },
  },
});

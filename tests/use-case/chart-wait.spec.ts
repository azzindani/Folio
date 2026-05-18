/**
 * Quick verification: do charts in reports render if we wait longer?
 * Loads the marketing-funnel-report and screenshots at 350ms, 2s, 5s, 10s.
 */
import { test } from '@playwright/test';
import * as path from 'node:path';
import {
  attachConsoleCapture,
  ensureDir,
  loadYAMLIntoEditor,
  REPORT_ROOT,
  waitForFolioReady,
} from './_helpers';

const OUT = path.join(REPORT_ROOT, 'chart-wait');
ensureDir(OUT);

test('chart load timing', async ({ page }) => {
  test.setTimeout(60_000);
  attachConsoleCapture(page);
  await page.goto('/');
  await waitForFolioReady(page);

  const yaml = await page.evaluate(async () => {
    const r = await fetch('/templates/builtin/86-marketing-funnel-report.template.yaml');
    return r.text();
  });
  await loadYAMLIntoEditor(page, yaml);

  for (const ms of [350, 2000, 5000, 10000]) {
    await page.waitForTimeout(ms === 350 ? 350 : 2000); // cumulative
    await page.locator('.canvas-area').first().screenshot({ path: path.join(OUT, `funnel-${ms}ms.png`) });
  }
});

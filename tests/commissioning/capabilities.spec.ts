import { test, expect } from '@playwright/test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { designPath, serverExport, FIXTURE_PROJECT, TEST_TOKEN } from './lib/harness';

/**
 * CAPABILITIES — the promises beyond a still poster.
 *
 * Motion: production has no ffmpeg and no headless Chrome, so the exports that
 * have to work there are the binary-free ones. An export that "succeeds" while
 * writing a still frame is the failure to catch.
 *
 * Persistence: an edit that reaches the screen but not the disk is invisible
 * until the tab is closed, and then the work is simply gone.
 */

let OUT = '';
test.beforeAll(() => { OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-caps-')); });
test.afterAll(() => { fs.rmSync(OUT, { recursive: true, force: true }); });

interface AnimResult { ok: boolean; files: string[]; error?: string }

function exportMotion(type: 'svg' | 'html', out: string): AnimResult {
  // exportAnimation lives in engine-runtime-tools rather than the export tool,
  // so it needs its own invocation rather than serverExport's.
  const script = `
    import { exportAnimation } from ${JSON.stringify(path.join(process.cwd(), 'src/mcp/engine-runtime-tools.ts'))};
    const res = exportAnimation({
      design_path: ${JSON.stringify(designPath('motion'))},
      type: ${JSON.stringify(type)},
      output_path: ${JSON.stringify(out)},
      project_path: ${JSON.stringify(FIXTURE_PROJECT)},
    });
    process.stdout.write('@@' + JSON.stringify(res) + '@@');
  `;
  const run = spawnSync('bun', ['run', '-'], {
    input: script, cwd: process.cwd(), encoding: 'utf8', timeout: 120_000,
    env: {
      ...process.env,
      FOLIO_PROJECTS_DIR: path.dirname(FIXTURE_PROJECT),
      FOLIO_LIBRARY_DIR: path.join(path.dirname(FIXTURE_PROJECT), '.library/assets'),
    },
  });
  const raw = run.stdout?.match(/@@([\s\S]*?)@@/)?.[1];
  if (!raw) return { ok: false, files: [], error: (run.stderr || 'no output').slice(0, 300) };
  const res = JSON.parse(raw) as { success?: boolean; output_path?: string; output_paths?: string[] };
  const files = (res.output_paths ?? (res.output_path ? [res.output_path] : [])).filter(f => fs.existsSync(f));
  return { ok: res.success === true, files };
}

for (const type of ['svg', 'html'] as const) {
  test(`animated ${type.toUpperCase()} export contains real motion, not a still frame`, () => {
    const res = exportMotion(type, path.join(OUT, `motion.${type}`));
    expect(res.error ?? '', 'export errored').toBe('');
    expect(res.ok).toBe(true);
    expect(res.files.length, 'no file written').toBe(1);

    const body = fs.readFileSync(res.files[0] as string, 'utf8');
    expect(body.length, 'file is suspiciously small').toBeGreaterThan(300);
    // The whole point of the format: a still frame would carry neither.
    expect(body, 'no @keyframes — this is a still frame').toContain('@keyframes');
    expect(body, 'nothing is driven by the animation').toMatch(/animation:/);
    expect(body, 'the animated layer is missing').toContain('pulse');
  });
}

test('an edit made in the editor survives a reload, because it reached the disk', async ({ page }) => {
  // Work on a scratch copy: a test that mutates a committed fixture leaves the
  // repo dirty and the next run measuring different input.
  const scratchDisk = path.join(FIXTURE_PROJECT, 'designs', '_scratch-persist.design.yaml');
  fs.copyFileSync(designPath('poster-assets'), scratchDisk);
  const editorPath = '/home/folio/projects/commissioning/designs/_scratch-persist.design.yaml';

  try {
    await page.goto(`/?file=${encodeURIComponent(editorPath)}&token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="mark-shared"]')), undefined, { timeout: 45_000 });
    await page.waitForTimeout(1200);

    await page.click('.layer-row[data-layer-id="title"]');
    const sizeInput = page.locator('.properties-content input[data-prop="style.font_size"]');
    await expect(sizeInput, 'the properties panel did not open for the selected layer').toBeVisible();
    await expect(sizeInput).toHaveValue('64');

    await sizeInput.fill('96');
    await sizeInput.dispatchEvent('change');
    await sizeInput.press('Tab');
    await page.waitForTimeout(600);
    // The canvas must show the edit before persistence is even worth asking about.
    const onCanvas = await page.evaluate(() =>
      document.querySelector('[data-layer-id="title"] text')?.getAttribute('font-size') ?? '');
    expect(onCanvas, 'the edit never reached the canvas').toBe('96');

    // Focus has to leave the field first: the shortcut handler deliberately
    // ignores keystrokes while you are typing in an input, so a Ctrl+S sent
    // with the cursor still in a box does nothing at all.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.body.focus();
    });
    await page.keyboard.press('Control+s');
    await page.waitForTimeout(2500);

    // On disk — not merely on screen. Note that SAVING alone rewrites the file,
    // so "the file changed" proves nothing; the new VALUE has to be there.
    const saved = fs.readFileSync(scratchDisk, 'utf8');
    expect(saved, 'the edit never reached the disk').toMatch(/font_size:\s*96/);

    // …and it comes back after a reload, which is what the user actually checks.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(document.querySelector('[data-layer-id="title"]')), undefined, { timeout: 45_000 });
    await page.waitForTimeout(1200);
    const fontSize = await page.evaluate(() =>
      document.querySelector('[data-layer-id="title"] text')?.getAttribute('font-size') ?? '');
    expect(fontSize, 'the reloaded design does not show the saved size').toBe('96');
  } finally {
    fs.rmSync(scratchDisk, { force: true });
  }
});

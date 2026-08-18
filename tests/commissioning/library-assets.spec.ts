import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_PROJECTS, TEST_TOKEN } from './lib/harness';

/**
 * THE DESIGN LIBRARY'S ASSET DRAWER — the other front door.
 *
 * The editor's asset panel is not the only way people manage assets: the
 * Library at /library has its own drawer, with its own markup, its own verbs
 * and its own code (src/mcp/engine/library-assets.ts). It had NO coverage at
 * all, and it showed — "New folder" prompted "Upload into which folder?" and
 * then opened the file picker, so it never created a folder, and there was no
 * way to rename or delete one anywhere in the drawer. Folders were filter chips
 * and nothing more.
 *
 * Reported as "how can i delete asset folder?" followed by "i used it via
 * library not the editor engine". Every check that had been added for the
 * editor panel passed throughout.
 */
const SCRATCH = path.join(FIXTURE_PROJECTS, '_scratch-libassets');
const IMAGES = path.join(SCRATCH, 'assets', 'images');

test.beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(path.join(SCRATCH, 'designs'), { recursive: true });
  fs.mkdirSync(IMAGES, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, 'project.yaml'),
    '_protocol: project/v1\nmeta:\n  name: _scratch-libassets\n');
});
test.afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

/** Open the Library, then its asset drawer, pointed at the scratch project. */
async function openDrawer(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/library?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.click('#assetsbtn');
  await expect(page.locator('#adrawer')).toHaveClass(/open/);
  await page.selectOption('#aproj', '_scratch-libassets');
  await expect(page.locator('#afoot')).toContainText('_scratch-libassets');
}

test('the Library drawer creates a real folder, not an upload prompt', async ({ page }) => {
  await openDrawer(page);

  page.once('dialog', d => {
    // The prompt has to be about NAMING a folder. It used to read "Upload into
    // which folder?" and open the file picker, so cancelling the picker left
    // nothing behind and an empty folder could not be made at all.
    expect(d.message(), 'New folder is still asking about an upload').toContain('Name the new folder');
    void d.accept('shoot-notes');
  });
  await page.click('#anewfolder');

  await expect(page.locator('.achip', { hasText: 'shoot-notes' }),
    'the new folder never appeared in the drawer').toHaveCount(1, { timeout: 15_000 });
  expect(fs.existsSync(path.join(IMAGES, 'shoot-notes')),
    'nothing was created on disk — the button only primed an upload').toBe(true);
});

test('a folder can be renamed and deleted from the Library drawer', async ({ page }) => {
  await openDrawer(page);

  page.once('dialog', d => void d.accept('raw'));
  await page.click('#anewfolder');
  await expect(page.locator('.achip', { hasText: 'raw' })).toHaveCount(1, { timeout: 15_000 });

  // Creating it selects it, which is what arms the folder verbs — they act on
  // the folder in view and stand down when there isn't one.
  await expect(page.locator('#arenfolder'), 'Rename folder never became usable').toBeEnabled();
  await expect(page.locator('#adelfolder'), 'Delete folder never became usable').toBeEnabled();

  page.once('dialog', d => void d.accept('raw-shots'));
  await page.click('#arenfolder');
  await expect(page.locator('.achip', { hasText: 'raw-shots' })).toHaveCount(1, { timeout: 15_000 });
  expect(fs.existsSync(path.join(IMAGES, 'raw-shots')), 'rename did not reach the disk').toBe(true);
  expect(fs.existsSync(path.join(IMAGES, 'raw')), 'the old folder is still there').toBe(false);

  page.once('dialog', d => {
    expect(d.message(), 'the confirm does not say where things go').toContain('.trash');
    void d.accept();
  });
  await page.click('#adelfolder');
  await expect(page.locator('.achip', { hasText: 'raw-shots' }),
    'the folder survived a delete from the Library').toHaveCount(0, { timeout: 15_000 });
  expect(fs.existsSync(path.join(IMAGES, 'raw-shots')), 'still on disk after delete').toBe(false);
});

test('the folder verbs stand down when no folder is in view', async ({ page }) => {
  await openDrawer(page);
  // At the root there is no one folder to rename or delete, and a live button
  // that silently does nothing is the failure this whole thread is about.
  await expect(page.locator('#arenfolder')).toBeDisabled();
  await expect(page.locator('#adelfolder')).toBeDisabled();
});

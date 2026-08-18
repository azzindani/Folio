import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FIXTURE_PROJECTS, TEST_TOKEN, serverExport } from './lib/harness';
import { measureInk, fileToDataUri } from './lib/ink';

/**
 * ASSET MANAGER — can someone actually get a file INTO the project, and does
 * the engine then see it?
 *
 * This exists because of a bug that no test could have caught: the manager was
 * only ever constructed as a side effect of opening a server-backed design, so
 * anyone who came to the panel to upload something FIRST met an empty pane with
 * no controls at all. The server route was perfect. The unit tests passed. The
 * door was bricked up.
 *
 * So the checks here start at the same place a person does — open the editor,
 * find the panel — and end where it matters: the uploaded file painting pixels
 * in an export produced by the real engine.
 */

/** Its own project, created at run time, so the committed fixtures stay clean
 *  and an upload check cannot leave a stray file in the repo. */
const SCRATCH = path.join(FIXTURE_PROJECTS, '_scratch-assets');

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let OUT = '';

test.beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(path.join(SCRATCH, 'designs'), { recursive: true });
  fs.mkdirSync(path.join(SCRATCH, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, 'project.yaml'),
    '_protocol: project/v1\nmeta:\n  name: _scratch-assets\n');
  OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-assetmgr-'));
});

test.afterAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.rmSync(OUT, { recursive: true, force: true });
});

/** Open the editor with NO design — the state the bug lived in — and switch to
 *  the asset manager the way a person does, from the activity bar. */
async function openManager(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.click('.act-btn[data-panel="project-assets"]', { force: true });
  // Wait on the HOST, not on the manager's own markup: when the panel fails to
  // initialise the host is present and EMPTY, and a bare timeout on `.ax-list`
  // reports "selector not found" for what is really "the panel never opened".
  await expect(page.locator('.project-assets-content'),
    'the asset panel pane is empty — the manager never initialised')
    .not.toBeEmpty({ timeout: 30_000 });
  await page.waitForSelector('.ax-list, .ax-message', { timeout: 30_000 });
}

/** Point the manager at the scratch project via its own picker. */
async function selectScratch(page: import('@playwright/test').Page): Promise<void> {
  await page.selectOption('.ax-project', '_scratch-assets');
  await expect(page.locator('.ax-crumb').first()).toContainText('_scratch-assets');
}

test('the asset manager opens, and offers an upload, with no design loaded', async ({ page }) => {
  await openManager(page);

  // Every one of these was missing when the panel failed to initialise — the
  // pane rendered completely empty, which reads as "broken", not as "pick a
  // project first".
  await expect(page.locator('[data-act="upload"]'), 'no Upload control').toHaveCount(1);
  await expect(page.locator('.ax-project'), 'no project picker').toHaveCount(1);
  await expect(page.locator('.ax-file'), 'no file input to upload through').toHaveCount(1);

  const projects = await page.locator('.ax-project option').allTextContents();
  expect(projects.some(p => p.includes('_scratch-assets')), `picker missed a project: ${projects.join(', ')}`).toBe(true);
});

test('a file uploaded through the manager is on disk AND paints in an engine export', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);

  await page.setInputFiles('.ax-file', {
    name: 'uploaded-mark.png', mimeType: 'image/png', buffer: PNG_1PX,
  });
  await expect(page.locator('.ax-row', { hasText: 'uploaded-mark.png' })).toHaveCount(1, { timeout: 15_000 });

  // Landed where the store says it did — an upload the engine cannot resolve
  // by path is no upload at all.
  const onDisk = path.join(SCRATCH, 'assets', 'images', 'uploaded-mark.png');
  expect(fs.existsSync(onDisk), `not written to ${onDisk}`).toBe(true);

  // …and the real export path can find it. This is the half a route test
  // cannot reach: bytes on disk that the renderer refuses to resolve still
  // look like a successful upload in every other check.
  const design = path.join(SCRATCH, 'designs', 'uses-upload.design.yaml');
  fs.writeFileSync(design, [
    '_protocol: design/v1',
    '_mode: complete',
    'meta: { id: uses-upload, name: Uses Upload, type: poster }',
    'document: { width: 400, height: 400, unit: px, dpi: 96 }',
    'layers:',
    '  - { id: bg, type: rect, z: 0, x: 0, y: 0, width: 400, height: 400, fill: { type: solid, color: "#ffffff" } }',
    '  - { id: mark, type: image, z: 1, x: 100, y: 100, width: 200, height: 200, src: assets/images/uploaded-mark.png }',
    '',
  ].join('\n'));

  const res = serverExport(design, 'png', path.join(OUT, 'uses-upload.png'), SCRATCH);
  expect(res.ok, `export failed: ${res.error ?? res.notes.join(' · ')}`).toBe(true);

  const [stat] = await measureInk(page, fileToDataUri(res.files[0] as string), [
    { id: 'mark', kind: 'image', x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
  ]);
  expect(stat?.inkRatio ?? 0,
    `the uploaded asset is missing from the export (ink=${stat?.inkRatio.toFixed(3) ?? 'n/a'})`)
    .toBeGreaterThan(0.5);
});

/** Drive the panel's own New-folder dialog (not a browser prompt). */
async function newFolder(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.click('[data-act="newfolder"]');
  await page.fill('.ax-modal-input', name);
  await page.click('.ax-modal [data-x="ok"]');
  await expect(page.locator('.ax-modal')).toHaveCount(0, { timeout: 15_000 });
}

test('a folder made in the manager still exists after a reload', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);

  await newFolder(page, 'shoot-notes');
  await expect(page.locator('.ax-crumb-path')).toContainText('shoot-notes');

  // The listing used to derive folders from the files inside them, so a folder
  // you had just made vanished on the next refresh — which is every folder,
  // since a new one is empty by definition.
  await openManager(page);
  await selectScratch(page);
  await expect(page.locator('.ax-row.folder', { hasText: 'shoot-notes' }),
    'the new folder did not survive a reload').toHaveCount(1);
});

test('New folder works the same at any depth, not only at the root', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);

  // The reported symptom was "sometimes I can create a folder, sometimes not".
  // The store was one level deep, so from inside a folder the new one was
  // created somewhere ELSE and nothing appeared — indistinguishable from a
  // button that intermittently does nothing.
  await newFolder(page, 'clients');
  await newFolder(page, 'acme');
  await newFolder(page, 'logos');
  await expect(page.locator('.ax-crumb-path')).toContainText('clients');
  await expect(page.locator('.ax-crumb-path')).toContainText('acme');
  await expect(page.locator('.ax-crumb-path')).toContainText('logos');
  expect(fs.existsSync(path.join(SCRATCH, 'assets', 'images', 'clients', 'acme', 'logos')),
    'the nested folder is not on disk where its path says it is').toBe(true);

  // And each level is reachable again from the tree after a reload.
  await openManager(page);
  await selectScratch(page);
  await expect(page.locator('.ax-node[data-nav="project:clients/acme/logos"]')).toHaveCount(1);
});

test('a folder with files in it can be deleted, and says what it will take', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);

  await newFolder(page, 'binned');
  await page.setInputFiles('.ax-file', [
    { name: 'one.png', mimeType: 'image/png', buffer: PNG_1PX },
    { name: 'two.png', mimeType: 'image/png', buffer: PNG_1PX },
  ]);
  await expect(page.locator('.ax-row')).toHaveCount(2, { timeout: 15_000 });

  await page.click('.ax-crumb >> nth=0');
  await page.click('.ax-row.folder:has-text("binned")');
  await page.keyboard.press('Delete');

  // Selecting a folder and pressing Delete used to do nothing whatsoever:
  // folder keys never resolved through the asset list, so the selection came
  // back empty and the handler returned early, silently.
  await expect(page.locator('.ax-modal-body'), 'Delete did nothing on a folder')
    .toContainText('2 items');
  await page.click('.ax-modal [data-x="ok"]');

  await expect(page.locator('.ax-row.folder', { hasText: 'binned' })).toHaveCount(0, { timeout: 15_000 });
  expect(fs.existsSync(path.join(SCRATCH, 'assets', 'images', 'binned'))).toBe(false);
  // Contents go to .trash, exactly as a per-file delete does — that is what
  // makes deleting a folder safe enough to simply do.
  const trash = fs.readdirSync(path.join(SCRATCH, '.trash'));
  expect(trash.filter(f => f.endsWith('.png'))).toHaveLength(2);
});

test('the shared library is a separate branch, not mixed in with project folders', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);

  const headings = await page.locator('.ax-tree-h').allTextContents();
  expect(headings, 'the two stores are not labelled apart').toEqual([
    'This project', 'Shared with every project',
  ]);
  // They are not interchangeable: one travels with the project, the other is
  // visible to every project the account owns. A shared folder that looks like
  // a project folder is how something private ends up in the shared store.
  await expect(page.locator('.ax-node[data-nav="library:"]')).toHaveCount(1);
  await expect(page.locator('.ax-node[data-nav="project:"]')).toHaveCount(1);
});

test('files dropped from the desktop upload into the folder in view', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);

  await newFolder(page, 'dropzone');
  await expect(page.locator('.ax-crumb-path')).toContainText('dropzone');

  // Playwright cannot drive a real OS drag, so the DataTransfer is built in the
  // page — but everything after the drop event is the panel's own code path.
  await page.evaluate(() => {
    const bytes = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      c => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bytes], 'dragged.png', { type: 'image/png' }));
    const root = document.querySelector('.ax');
    root?.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  });

  await expect(page.locator('.ax-row', { hasText: 'dragged.png' })).toHaveCount(1, { timeout: 15_000 });
  expect(fs.existsSync(path.join(SCRATCH, 'assets', 'images', 'dropzone', 'dragged.png')),
    'dropped into the folder in view, but not filed there').toBe(true);
});

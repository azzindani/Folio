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

/**
 * Point the manager at the scratch project.
 *
 * Via Places, not by assuming the tree is on screen: in the sidebar the panel
 * is too narrow to dock a tree, and a check that only worked at full width
 * would miss that switching project is impossible there — which is most of what
 * the panel is for on a phone.
 */
async function selectScratch(page: import('@playwright/test').Page): Promise<void> {
  const node = page.locator('.ax-node.project[data-project="_scratch-assets"]');
  if (!await node.isVisible()) await page.click('[data-cmd="places"]');
  await node.click();
  await expect(page.locator('.ax-crumb').first()).toContainText('_scratch-assets');
}

test('the asset manager opens, and offers an upload, with no design loaded', async ({ page }) => {
  await openManager(page);

  // Every one of these was missing when the panel failed to initialise — the
  // pane rendered completely empty, which reads as "broken", not as "pick a
  // project first".
  await expect(page.locator('[data-cmd="upload"]'), 'no Upload control').toHaveCount(1);
  await expect(page.locator('.ax-file'), 'no file input to upload through').toHaveCount(1);
  // Every verb sits on top, disabled rather than absent — a menu you have no
  // reason to open may as well not exist.
  const verbs = await page.locator('.ax-cmd[data-cmd]').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['cmd']));
  for (const v of ['newfolder', 'upload', 'cut', 'copy', 'paste', 'rename', 'moveto', 'delete']) {
    expect(verbs, `command bar is missing ${v}`).toContain(v);
  }

  const projects = await page.locator('.ax-node.project').evaluateAll(els => els.map(e => (e as HTMLElement).dataset['project']));
  expect(projects.includes('_scratch-assets'), `tree missed a project: ${projects.join(', ')}`).toBe(true);

  // Reachable, not merely present. Opening as a window, the tree is docked and
  // the project is simply there to click.
  await expect(page.locator('.ax-node.project[data-project="_scratch-assets"]'),
    'the tree lists the project but does not show it').toBeVisible();

  // Docked back in the rail there is no room for a tree, and Places becomes the
  // only route to another project — the state a phone is always in.
  await page.click('[data-cmd="full"]');
  await expect(page.locator('.project-assets-content')).not.toHaveClass(/ax-full/);
  await page.click('[data-cmd="places"]');
  await expect(page.locator('.ax-node.project[data-project="_scratch-assets"]'),
    'no way to reach another project when the tree is folded').toBeVisible();
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
  await page.click('[data-cmd="newfolder"]');
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
  expect(headings.length, 'the two stores are not labelled apart').toBe(2);
  expect(headings[0]).toContain('Projects');
  expect(headings[1]).toContain('Shared with every project');

  // They are not interchangeable: one travels with the project, the other is
  // visible to every project the account owns. A shared folder that looks like
  // a project folder is how something private ends up in the shared store.
  await expect(page.locator('.ax-node[data-nav="library:"]')).toHaveCount(1);
  // Projects are containers, not folders — each is its own row, and creating
  // one is a verb on the Projects branch rather than on the file command bar.
  expect(await page.locator('.ax-node.project').count()).toBeGreaterThan(1);
  await expect(page.locator('[data-cmd="newproject"]')).toHaveCount(1);
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

/** Switch view the way the panel currently offers it: the segmented control on
 *  a bar with room, the dropdown on a narrow one. */
async function pickView(page: import('@playwright/test').Page, mode: string): Promise<void> {
  const seg = page.locator(`.ax-viewseg .ax-seg[data-view="${mode}"]`);
  if (await seg.isVisible()) { await seg.click(); return; }
  await page.click('[data-cmd="viewmenu"]');
  await page.click(`.ax-vmode[data-view="${mode}"]`);
}

test('every view mode shows the same files — a view is not a filter', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);
  // No click to go full-window: the manager opens as one now.

  await newFolder(page, 'views');
  await page.setInputFiles('.ax-file', [
    { name: 'one.png', mimeType: 'image/png', buffer: PNG_1PX },
    { name: 'two.png', mimeType: 'image/png', buffer: PNG_1PX },
  ]);
  await expect(page.locator('.ax-list > *')).toHaveCount(2, { timeout: 15_000 });

  // Six modes because they answer different questions — artwork, facts, or the
  // most names in the least space. What they must NOT do is disagree about
  // what is in the folder.
  for (const mode of ['xl', 'large', 'medium', 'tiles', 'list', 'details']) {
    await pickView(page, mode);
    await expect(page.locator('.ax-list'), `${mode} did not apply`).toHaveClass(new RegExp(`\\b${mode}\\b`));
    const names = await page.locator('.ax-list .ax-nm').allTextContents();
    expect(names.sort(), `${mode} shows a different set`).toEqual(['one.png', 'two.png']);
  }
});

test('copy in one project, paste into another — the file lands and the original stays', async ({ page }) => {
  await openManager(page);
  await selectScratch(page);
  // No click to go full-window: the manager opens as one now.

  await newFolder(page, 'source');
  await page.setInputFiles('.ax-file', { name: 'shared-mark.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.locator('.ax-row', { hasText: 'shared-mark.png' })).toHaveCount(1, { timeout: 15_000 });

  await page.click('.ax-row:has-text("shared-mark.png")');
  await expect(page.locator('[data-cmd="copy"]'), 'Copy stayed disabled with a file selected').toBeEnabled();
  await page.click('[data-cmd="copy"]');
  await expect(page.locator('.ax-status')).toContainText('1 item copied');

  // Into the SHARED library, which is the cross-store case: a copy there is how
  // a project's mark gets promoted without the project losing it.
  await page.click('.ax-node[data-nav="library:"]');
  await page.click('[data-cmd="paste"]');
  await expect(page.locator('.ax-row', { hasText: 'shared-mark.png' })).toHaveCount(1, { timeout: 20_000 });

  const libRoot = path.join(FIXTURE_PROJECTS, '.library', 'assets');
  expect(fs.existsSync(path.join(libRoot, 'shared-mark.png')), 'not written into the library').toBe(true);
  expect(fs.existsSync(path.join(SCRATCH, 'assets', 'images', 'source', 'shared-mark.png')),
    'a copy must leave the original where it was').toBe(true);

  // Leave the shared library as it was found — it is committed fixture data.
  fs.rmSync(path.join(libRoot, 'shared-mark.png'), { force: true });
});


/** Command-bar verbs whose box falls outside the bar's own box — present in
 *  the DOM, absent to the person looking at the panel. */
async function clippedVerbs(page: import('@playwright/test').Page): Promise<string[]> {
  const bar = await page.locator('.ax-cmdbar').boundingBox();
  if (!bar) return ['<no command bar at all>'];
  const cmds = page.locator('.ax-cmd[data-cmd]');
  const out: string[] = [];
  for (let i = 0; i < await cmds.count(); i++) {
    const btn = cmds.nth(i);
    const box = await btn.boundingBox();
    // No box at all means deliberately hidden for this layout — the dropdown
    // stands down when the modes are on the bar. Clipped is different: the
    // control is laid out, just past the edge of the bar that holds it, which
    // is how nine verbs went missing while every test still passed.
    if (!box) continue;
    const id = (await btn.getAttribute('data-cmd')) ?? '?';
    if (box.x < bar.x - 1 || box.x + box.width > bar.x + bar.width + 1) out.push(id);
  }
  return out;
}

test('the manager opens as a file manager, not as a column', async ({ page }) => {
  // Every other check here either drove the panel full-window on purpose or
  // reached its controls by selector, so all of them passed while what a person
  // actually got was the old panel: docked in the rail at a layer list's width,
  // tree folded away, filename column squeezed to nothing, and nine of the
  // twelve verbs past the right edge of a bar that scrolled with its scrollbar
  // hidden. Nothing on screen said they were there.
  await openManager(page);

  // A window, because the rail cannot hold a file manager — the editor grid
  // protects a canvas floor, so the left column lands near 400px however wide
  // the panel asks to be, under the width at which the tree docks.
  await expect(page.locator('.project-assets-content'),
    'the manager opened as a sidebar column, not a window').toHaveClass(/ax-full/);

  await expect(page.locator('.ax-cmd[data-cmd]'),
    'the command bar lost its verbs').not.toHaveCount(0);
  expect(await clippedVerbs(page), 'verbs clipped off the command bar').toEqual([]);

  // "List and grid preview" is only delivered if the modes are ON the bar —
  // behind a dropdown at the far right they read as absent, which is how they
  // were reported.
  await expect(page.locator('.ax-viewseg .ax-seg'),
    'the view modes are not on the command bar').toHaveCount(6);

  // Wide enough to dock the tree, so Projects and the shared library are on
  // screen rather than behind a drawer nobody knows to open.
  await expect(page.locator('.ax'), 'too narrow to dock its tree').toHaveClass(/is-wide/);
  await expect(page.locator('.ax-tree')).toBeVisible();

  // And Escape a second time does leave, or there is no way back to the canvas.
  await page.keyboard.press('Escape');
  await expect(page.locator('.project-assets-content')).not.toHaveClass(/ax-full/);

  // Docked in the rail is where clipping actually happens — full-window there
  // is room for all twelve verbs on one line whatever the bar does, so the
  // check above cannot fail even with the overflow bug back in place. This is
  // the state the panel used to open in, and the one that hid nine verbs.
  await expect(page.locator('.ax-cmdbar')).toBeVisible();
  expect(await clippedVerbs(page),
    'verbs clipped off the command bar once docked in the rail').toEqual([]);
});

test('a folder can be deleted from the tree, and the views are on the bar', async ({ page }) => {
  // Both of these existed and both were reported missing, which is the same
  // thing as missing. Deleting a folder meant knowing to select its row in the
  // file pane — right-clicking it in the TREE, where a file manager puts folder
  // management, opened an empty menu. And the six view modes lived only behind
  // a dropdown at the far right of the bar, next to Refresh.
  await openManager(page);
  await selectScratch(page);
  await newFolder(page, 'to-remove');
  await page.setInputFiles('.ax-file', { name: 'inside.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.locator('.ax-row', { hasText: 'inside.png' })).toHaveCount(1, { timeout: 15_000 });

  // The modes are on the bar itself, not folded into a menu.
  const seg = page.locator('.ax-viewseg .ax-seg');
  await expect(seg, 'the view modes are not on the command bar').toHaveCount(6);
  await seg.filter({ has: page.locator('[aria-label], svg') }).first().waitFor();
  await page.click('.ax-viewseg .ax-seg[data-view="list"]');
  await expect(page.locator('.ax-list'), 'the bar\'s list button did not change the view')
    .toHaveClass(/\blist\b/);
  await page.click('.ax-viewseg .ax-seg[data-view="details"]');

  // Right-click the folder in the TREE and delete it from there.
  const node = page.locator('.ax-node[data-nav="project:to-remove"]');
  await expect(node, 'the open project does not show its folders in the tree').toHaveCount(1);
  await node.click({ button: 'right' });
  const items = await page.locator('.ax-menu button').allTextContents();
  expect(items.join(' | '), `the tree menu offers no way to delete: ${items.join(' | ')}`)
    .toMatch(/Delete folder/);

  await page.click('.ax-menu button:has-text("Delete folder")');
  // Picking a verb has to actually run it. A `blur` listener registered with
  // capture fires for EVERY element losing focus, not just the window, so
  // pressing a menu item tore the menu down before the click could land on it —
  // every verb in every right-click menu silently did nothing.
  await expect(page.locator('.ax-modal'),
    'picking Delete folder from the menu did nothing — no confirm ever appeared')
    .toHaveCount(1, { timeout: 10_000 });
  // It must say what it is about to take with it — the folder is not empty.
  await expect(page.locator('.ax-modal')).toContainText('to-remove');
  await expect(page.locator('.ax-modal'), 'the confirm does not say what goes with it')
    .toContainText('1 item');
  await page.click('.ax-modal [data-x="ok"]');

  await expect(page.locator('.ax-node[data-nav="project:to-remove"]'),
    'the folder survived a delete from the tree').toHaveCount(0, { timeout: 15_000 });
  expect(fs.existsSync(path.join(SCRATCH, 'assets', 'images', 'to-remove')),
    'still on disk after being deleted from the tree').toBe(false);
});

test('Escape unwinds one layer at a time, not the whole manager', async ({ page }) => {
  await openManager(page);
  // Narrow the window rather than opening narrow: below 768px the activity bar
  // is hidden, and this is about the layers, not about getting in. At this
  // width the view dropdown and the Places drawer are both in play — they are
  // the layers Escape has to unwind, in order.
  await page.setViewportSize({ width: 460, height: 820 });
  await expect(page.locator('.ax')).not.toHaveClass(/is-wide/);
  await expect(page.locator('.project-assets-content')).toHaveClass(/ax-full/);

  await page.click('[data-cmd="viewmenu"]');
  await expect(page.locator('.ax-viewmenu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.ax-viewmenu'), 'Escape did not close the picker').toBeHidden();
  await expect(page.locator('.project-assets-content'),
    'Escape closed the whole manager instead of just the picker').toHaveClass(/ax-full/);

  await page.click('[data-cmd="places"]');
  await expect(page.locator('.ax-tree')).toHaveClass(/open/);
  await page.keyboard.press('Escape');
  await expect(page.locator('.ax-tree'), 'Escape did not close the drawer').not.toHaveClass(/open/);
  await expect(page.locator('.project-assets-content'),
    'Escape closed the whole manager instead of just the drawer').toHaveClass(/ax-full/);

  // Only with nothing layered over it does Escape leave, or there is no way
  // back to the canvas.
  await page.keyboard.press('Escape');
  await expect(page.locator('.project-assets-content')).not.toHaveClass(/ax-full/);
});

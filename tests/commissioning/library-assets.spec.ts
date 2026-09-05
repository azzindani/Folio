import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { FIXTURE_PROJECTS, TEST_TOKEN, UPLOAD_SETTLE } from './lib/harness';

/**
 * THE OTHER FRONT DOOR — the Design Library at /library.
 *
 * Folio shipped two asset managers. The editor's panel and the Library's drawer
 * shared only the HTTP endpoints, so five rounds of "the file manager is
 * broken" were fixed in the editor while the person reporting them was standing
 * in the Library the whole time. Every fix landed. Every check passed. Nothing
 * changed for them. The Library's own drawer had a "New folder" button that
 * only primed an upload, and no way to delete a folder at all.
 *
 * The drawer now HOSTS the editor's explorer rather than reimplementing it, so
 * these checks are the same work as asset-manager.spec.ts done through the
 * other door. What they defend is that the door still opens onto the real
 * thing — the failure mode is not "a verb is broken" but "this surface quietly
 * went back to being its own app".
 */
const SCRATCH = path.join(FIXTURE_PROJECTS, '_scratch-libassets');
const IMAGES = path.join(SCRATCH, 'assets', 'images');
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.beforeAll(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  fs.mkdirSync(path.join(SCRATCH, 'designs'), { recursive: true });
  fs.mkdirSync(IMAGES, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, 'project.yaml'),
    '_protocol: project/v1\nmeta:\n  name: _scratch-libassets\n');
});
test.afterAll(() => fs.rmSync(SCRATCH, { recursive: true, force: true }));

/** Open the Library and its drawer, pointed at the scratch project. */
async function openDrawer(page: import('@playwright/test').Page): Promise<void> {
  await page.goto(`/library?assets=_scratch-libassets&token=${TEST_TOKEN}`,
    { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#adrawer')).toHaveClass(/open/);
  // Wait on the manager itself. The bundle is deferred, so a check that only
  // waited for the drawer would race it and report "no controls" for "not here
  // yet" — the same confusion as an empty pane.
  await expect(page.locator('.ax'),
    'the drawer opened but the shared file manager never mounted into it')
    .toHaveCount(1, { timeout: 30_000 });
  await page.waitForSelector('.ax-list, .ax-message', { timeout: 30_000 });
  await expect(page.locator('.ax-crumb').first()).toContainText('_scratch-libassets');
}

async function newFolder(page: import('@playwright/test').Page, name: string): Promise<void> {
  await page.click('[data-cmd="newfolder"]');
  await page.fill('.ax-modal-input', name);
  await page.click('.ax-modal [data-x="ok"]');
  await expect(page.locator('.ax-modal')).toHaveCount(0, { timeout: UPLOAD_SETTLE });
  // Wait for the folder to actually SHOW UP, not just for the dialog to shut.
  // The modal closes when the request is sent; the pane repaints when it comes
  // back. Returning in between let the next step upload into a listing that was
  // still being rebuilt, so the row for the uploaded file never appeared —
  // intermittently, and more often through the Library's deep link, which has
  // more async ahead of it. Raising the timeout did not help, because nothing
  // was slow.
  //
  // Accept EITHER shape: the manager navigates into the folder it just made, so
  // the name lands in the breadcrumb; asserting only on a folder row failed 8
  // tests that were passing before.
  await expect(page.locator('.ax-crumb', { hasText: name })
    .or(page.locator('.ax-row.folder', { hasText: name })).first(),
  `"${name}" was created but the pane never caught up`).toBeVisible({ timeout: UPLOAD_SETTLE });
}

test('the Library opens the real file manager, not a second one', async ({ page }) => {
  await openDrawer(page);

  // The same verbs the editor's panel offers. If this thins out, the Library
  // has started reimplementing again — which is the actual regression, and it
  // is invisible from the editor side.
  const verbs = await page.locator('.ax-cmd[data-cmd]')
    .evaluateAll(els => els.map(e => (e as HTMLElement).dataset['cmd']));
  for (const v of ['newfolder', 'upload', 'cut', 'copy', 'paste', 'rename', 'moveto', 'delete']) {
    expect(verbs, `the Library is missing ${v}`).toContain(v);
  }
  await expect(page.locator('.ax-viewseg .ax-seg'),
    'the six view modes did not come through to the Library').toHaveCount(6);
  await expect(page.locator('.ax-node.project').first(),
    'no project tree — the drawer is not hosting the explorer').toBeVisible();

  // The Library page has its own palette; the shared stylesheet is written in
  // the editor's tokens. Unmapped, they resolve to nothing and the manager
  // renders as unstyled text on a transparent ground.
  const painted = await page.locator('.ax').evaluate(el => {
    const s = getComputedStyle(el);
    return { bg: s.backgroundColor, fg: s.color };
  });
  expect(painted.bg, 'the palette bridge is not applied').not.toBe('rgba(0, 0, 0, 0)');
  expect(painted.fg).not.toBe('');
});

test('a folder can be made and deleted from the Library, and it reaches the disk', async ({ page }) => {
  await openDrawer(page);

  await newFolder(page, 'shoot-notes');
  expect(fs.existsSync(path.join(IMAGES, 'shoot-notes')),
    'New folder in the Library created nothing — it used to only prime an upload').toBe(true);

  await page.setInputFiles('.ax-file', { name: 'inside.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect(page.locator('.ax-row', { hasText: 'inside.png' })).toHaveCount(1, { timeout: UPLOAD_SETTLE });

  // Delete it from the tree, which is where a file manager expects folders to
  // be managed and where the Library offered nothing at all.
  const node = page.locator('.ax-node[data-nav="project:shoot-notes"]');
  await expect(node, 'the open project does not show its folders in the tree').toHaveCount(1);
  await node.click({ button: 'right' });
  const items = await page.locator('.ax-menu button').allTextContents();
  expect(items.join(' | '), `no way to delete a folder from the Library: ${items.join(' | ')}`)
    .toMatch(/Delete folder/);

  await page.click('.ax-menu button:has-text("Delete folder")');
  await expect(page.locator('.ax-modal')).toContainText('shoot-notes');
  await page.click('.ax-modal [data-x="ok"]');

  await expect(page.locator('.ax-node[data-nav="project:shoot-notes"]'),
    'the folder survived the delete').toHaveCount(0, { timeout: UPLOAD_SETTLE });
  expect(fs.existsSync(path.join(IMAGES, 'shoot-notes')),
    'still on disk after being deleted from the Library').toBe(false);
});

test('the Library opens on the SHARED store, not on someone\'s project', async ({ page }) => {
  // The Design Library is cross-project. Landing on one project's asset folder
  // — picked for you out of two hundred — answers a question nobody asked, and
  // puts the shared store hundreds of tree rows below the fold. Assets here
  // belong to everything, so that is where it opens.
  await page.goto(`/library?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.click('#assetsbtn');
  await page.waitForSelector('.ax-list, .ax-message', { timeout: 30_000 });

  await expect(page.locator('.ax-crumb').first(),
    'the Library opened onto a project instead of the shared store')
    .toContainText('Shared library');

  // And the branch you are in is the one at the top, or "opens on shared" is
  // true in name only — you would still be looking at a list of projects.
  const firstHeading = await page.locator('.ax-tree-h').first().textContent();
  expect(firstHeading, 'the shared branch is buried under every project')
    .toContain('Shared');
});

test('a project deep link still wins over the shared default', async ({ page }) => {
  // ?assets=<project> is someone asking for that project by name.
  await page.goto(`/library?assets=_scratch-libassets&token=${TEST_TOKEN}`,
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.ax-list, .ax-message', { timeout: 30_000 });
  await expect(page.locator('.ax-crumb').first()).toContainText('_scratch-libassets');
});

test('the manager still opens when the URL carries no token', async ({ page }) => {
  // Deliberately NOT a proof of cookie auth: this harness runs with no auth
  // configured, so a check here passes even with credentials stripped out of
  // every request — it was written as one, and rehearsing showed it could not
  // fail. That concern lives where it can bite: asset-explorer-io.test.ts
  // asserts credentials:'include' on reads and mutations alike.
  //
  // What this DOES defend is the token-free path through the drawer: the
  // editor always has ?token= in the URL, so a mount that quietly depended on
  // reading one would break the Library alone.
  // One visit WITH the token to establish the session, then the real case: the
  // page reloaded, or opened from a bookmark, with nothing in the URL. Dropping
  // the first visit does not make the check stricter, it just leaves the page
  // unauthenticated and times out on a button that was never served.
  await page.goto(`/library?token=${TEST_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await page.goto('/library', { waitUntil: 'domcontentloaded' });
  await page.click('#assetsbtn');
  await expect(page.locator('.ax'),
    'the manager did not mount without a token in the URL').toHaveCount(1, { timeout: 30_000 });
  await page.waitForSelector('.ax-list, .ax-message', { timeout: 30_000 });
  await expect(page.locator('.ax-node.project').first()).toBeVisible();
});

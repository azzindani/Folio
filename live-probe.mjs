// Can a person actually DELETE a folder, and by what routes?
import { chromium } from 'playwright';
import { execSync } from 'child_process';

const KEY = execSync('docker exec folio printenv FOLIO_API_KEY').toString().trim();
const SP = '/tmp/claude-0/-root-Folio/5067a7c3-8654-40a5-b0c8-03e919da8ecd/scratchpad';

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));

await page.goto(`https://folio.casava.space/?token=${KEY}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.click('.act-btn[data-panel="project-assets"]', { force: true });
await page.waitForSelector('.ax-list, .ax-message', { timeout: 30000 });
await page.waitForTimeout(1500);

const node = page.locator('.ax-node.project[data-project="zz-probe-fm"]');
await node.scrollIntoViewIfNeeded();
await node.click();
await page.waitForTimeout(1200);

// ── Route A: right-click a folder row ───────────────────────────
await page.locator('.ax-row.folder').first().click({ button: 'right' });
await page.waitForTimeout(500);
const menu = await page.evaluate(() => {
  const m = document.querySelector('.ax-menu, .ctx-menu, [class*="menu"]:not(.ax-viewmenu)');
  return {
    found: !!m,
    cls: m?.className,
    items: [...document.querySelectorAll('.ax-menu button, .ax-menu-item, .ctx-menu button')]
      .map(e => e.textContent.trim()),
  };
});
console.log('RIGHT-CLICK ON FOLDER ROW:', JSON.stringify(menu, null, 2));
await page.screenshot({ path: `${SP}/probe-ctx.png` });
await page.keyboard.press('Escape');
await page.waitForTimeout(300);

// ── Route B: right-click the folder in the TREE ─────────────────
const treeFolder = page.locator('.ax-node[data-nav]:not(.project):not(.root)').first();
const treeCount = await treeFolder.count();
console.log('tree folder nodes available:', treeCount);
if (treeCount) {
  await treeFolder.click({ button: 'right' });
  await page.waitForTimeout(400);
  console.log('tree right-click menu items:', JSON.stringify(
    await page.locator('.ax-menu button').allTextContents()));
  await page.keyboard.press('Escape');
}

// ── Route C: select + Delete button, all the way through ────────
await page.locator('.ax-row.folder').first().click();
await page.waitForTimeout(400);
await page.click('[data-cmd="delete"]');
await page.waitForTimeout(600);
const dlg = await page.evaluate(() => {
  const d = document.querySelector('.ax-modal');
  return { open: !!d, text: d?.textContent?.trim().slice(0, 240) };
});
console.log('DELETE DIALOG:', JSON.stringify(dlg, null, 2));
await page.screenshot({ path: `${SP}/probe-del.png` });

if (dlg.open) {
  await page.click('.ax-modal [data-x="ok"]');
  await page.waitForTimeout(1500);
  console.log('rows after delete:', JSON.stringify(
    await page.locator('.ax-row').evaluateAll(e => e.map(x => x.textContent.trim().slice(0, 40)))));
  console.log('status:', await page.locator('.ax-status').textContent());
}
await browser.close();

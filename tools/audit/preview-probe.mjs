// Diagnostic: what controls does the preview frame expose, and does clicking a
// NON-active one actually change state?
import { chromium } from 'playwright';

const TOKEN = process.env.FOLIO_API_KEY;
const FILE = '/home/folio/projects/folio-motion-lab/designs/preview-interactivity-check-2.design.yaml';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
page.on('pageerror', e => console.log('PAGE ERROR:', String(e)));
await page.goto(`http://localhost:4173/?file=${encodeURIComponent(FILE)}&token=${TOKEN}`, { waitUntil: 'networkidle' });
await page.locator('.mode-btn[data-mode="preview"]').click();
await page.waitForSelector('.live-preview iframe', { state: 'visible' });
await page.waitForTimeout(4000);

const frame = page.frameLocator('.live-preview iframe');

const controls = frame.locator('button, [role="tab"], select, input');
const n = await controls.count();
console.log('controls:', n);
for (let i = 0; i < n; i++) {
  const c = controls.nth(i);
  console.log(` [${i}]`, await c.evaluate(el => `${el.tagName}.${el.className} "${(el.textContent || el.value || '').trim().slice(0, 30)}"`));
}

// Click the second tab (index chosen after listing) and diff the panel area.
const tabs = frame.locator('.ic-tab');
console.log('tab-like count:', await tabs.count());
if (await tabs.count() > 1) {
  const before = await frame.locator('body').innerText();
  await tabs.nth(1).click();
  await page.waitForTimeout(500);
  const after = await frame.locator('body').innerText();
  console.log('tab click changed text:', before !== after);
}

// Accordion
const acc = frame.locator('.ic-acc-head');
console.log('accordion headers:', await acc.count());
if (await acc.count() > 0) {
  const before = await frame.locator('body').innerText();
  await acc.first().click();
  await page.waitForTimeout(500);
  const after = await frame.locator('body').innerText();
  console.log('accordion click changed text:', before !== after);
}

// Filter chips: click "slow" and see whether the table + chart narrow.
const chips = frame.locator('.ic-chip');
console.log('filter chips:', await chips.count());
if (await chips.count() > 1) {
  const rowsBefore = await frame.locator('table tbody tr').count();
  const labels = [];
  for (let i = 0; i < await chips.count(); i++) labels.push((await chips.nth(i).innerText()).trim());
  console.log('chip labels:', labels.join(' | '));
  const slow = chips.filter({ hasText: 'slow' });
  if (await slow.count() > 0) {
    await slow.first().click();
    await page.waitForTimeout(900);
    const rowsAfter = await frame.locator('table tbody tr').count();
    console.log(`filter slow: table rows ${rowsBefore} -> ${rowsAfter}`);
    console.log('chip now active:', (await slow.first().getAttribute('class') || '').includes('active'));
  }
}

// Does the frame contain any script at all?
const html = await frame.locator('body').innerHTML();
console.log('body length:', html.length);
await browser.close();

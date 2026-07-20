// Verify the editor's live interactive preview against the LIVE container.
// Proves three things a unit test cannot: the iframe actually loads, Chart.js
// actually paints inside it, and interacting with a control actually changes
// the DOM. Run: node tools/audit/preview-check.mjs
import { chromium } from 'playwright';

const TOKEN = process.env.FOLIO_API_KEY;
const FILE = '/home/folio/projects/folio-motion-lab/designs/preview-interactivity-check.design.yaml';
const URL = `http://localhost:4173/?file=${encodeURIComponent(FILE)}&token=${TOKEN}`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.canvas-section', { timeout: 20000 });

const previewBtn = page.locator('.mode-btn[data-mode="preview"]');
console.log('preview button present :', await previewBtn.count() === 1);
await previewBtn.click();

await page.waitForSelector('.live-preview iframe', { state: 'visible', timeout: 10000 });
const frame = page.frameLocator('.live-preview iframe');

// The report runtime lives inside the frame; give Chart.js time to paint.
await page.waitForTimeout(4000);

const canvasCount = await frame.locator('canvas').count();
console.log('canvases in frame     :', canvasCount);

// A canvas element can exist and still be blank. The preview frame is
// sandboxed with an opaque origin, so it cannot be scripted from here — screen
// -shot the chart and measure colour variety instead. A painted chart has many
// distinct pixel values; an empty one is a single flat colour.
let distinctColours = 0;
if (canvasCount > 0) {
  const shot = await frame.locator('canvas').first().screenshot();
  const seen = new Set();
  for (let i = 0; i < shot.length - 3; i += 401) {
    seen.add(`${shot[i]},${shot[i + 1]},${shot[i + 2]}`);
  }
  distinctColours = seen.size;
}
console.log('chart distinct colours:', distinctColours, distinctColours > 5 ? '(painted)' : '(BLANK)');

const tableRows = await frame.locator('table tbody tr').count();
console.log('table rows in frame   :', tableRows);
const kpis = await frame.locator('[class*="kpi"]').count();
console.log('kpi elements in frame :', kpis);

// Interactivity: click a real control and see whether the DOM responds.
const buttons = frame.locator('button, .tab, [role="tab"]');
const btnCount = await buttons.count();
console.log('clickable controls    :', btnCount);
if (btnCount > 0) {
  const before = await frame.locator('body').innerHTML();
  await buttons.first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(600);
  const after = await frame.locator('body').innerHTML();
  console.log('DOM changed on click  :', before !== after);
}

await page.screenshot({ path: 'preview-check.png', fullPage: false });
console.log('page errors           :', errors.length ? errors.slice(0, 3) : 'none');
await browser.close();

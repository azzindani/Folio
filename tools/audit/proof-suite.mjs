// Rigorous proof the editor loads the ACTUAL file (not a sample), plus
// standalone-export render. argv: <tokenLaunch> <tokenProof>
import { chromium } from 'playwright';
import fs from 'node:fs';

const [tLaunch, tProof] = process.argv.slice(2);
const BASE = 'https://folio.casava.space';
const MCP = encodeURIComponent(BASE);
const fLaunch = encodeURIComponent('/home/folio/projects/demo-live/designs/launch-poster.design.yaml');
const fProof  = encodeURIComponent('/home/folio/projects/demo-live/designs/proof-card.design.yaml');

const scenarios = [
  { name: 'neg-control', url: `${BASE}/?mcp_url=${MCP}&token=${tLaunch}`,            wait: null,            kind: 'editor' },
  { name: 'launch',      url: `${BASE}/?file=${fLaunch}&mcp_url=${MCP}&token=${tLaunch}`, wait: 'FOLIO ENGINE',  kind: 'editor' },
  { name: 'proof',       url: `${BASE}/?file=${fProof}&mcp_url=${MCP}&token=${tProof}`,   wait: 'MARK-',         kind: 'editor' },
  { name: 'export-html', url: `${BASE}/__project_files/demo-live/designs/launch-poster.html?token=${tLaunch}`, wait: 'FOLIO ENGINE', kind: 'standalone' },
];

const browser = await chromium.launch({ headless: true });
fs.mkdirSync('/root/Folio/tools/audit/vision', { recursive: true });
const out = [];

for (const s of scenarios) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const net = [];
  page.on('response', r => { const u = r.url(); if (u.includes('__project_files')) net.push(`${r.status()} ${u.split('casava.space')[1].split('?')[0]}`); });
  const status = (await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 }))?.status();

  let matched = null;
  if (s.wait) {
    for (let i = 0; i < 40; i++) {
      const t = await page.evaluate(() => (document.querySelector('.canvas-svg-container svg') || document.querySelector('svg') || document.body)?.textContent || '');
      if (t.includes(s.wait)) { matched = true; break; }
      await page.waitForTimeout(250);
    }
    if (matched === null) matched = false;
  } else {
    await page.waitForTimeout(3000); // let editor settle; expect NO design
  }
  await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => {
    const svg = document.querySelector('.canvas-svg-container svg') || document.querySelector('svg');
    const texts = svg ? Array.from(svg.querySelectorAll('text')).map(t => t.textContent.trim()).filter(Boolean) : [];
    return { hasSvg: !!svg, vb: svg?.getAttribute('viewBox') ?? null, rects: svg ? svg.querySelectorAll('rect').length : 0, texts };
  });
  await page.screenshot({ path: `/root/Folio/tools/audit/vision/proof-${s.name}.png` });
  out.push({ name: s.name, status, matched, waitFor: s.wait, network: net, ...info });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 2));

// High-fidelity export worker — renders a Folio design through headless Chrome
// (Playwright) with its real web fonts, so the output MATCHES the editor (resvg
// can't load web fonts). Produces:
//   <name>-hifi.png  — editor-fidelity raster (2×)
//   <name>-hifi.pdf  — VECTOR PDF: selectable text, crisp at any zoom, and every
//                      layer with an `href` becomes a clickable PDF link.
//
// Prereq: export the design to SVG first (export_design format:"svg"); this reads
// <name>.svg + <name>.design.yaml from the same dir.
//
// Usage:  node tools/hifi-export/render.mjs <project/name | /abs/path.design.yaml>
import { chromium } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

const arg = process.argv[2];
if (!arg) { console.error('usage: render.mjs <project/name | /abs/path.design.yaml>'); process.exit(1); }

let designPath = arg;
if (!designPath.endsWith('.design.yaml')) {
  const [proj, name] = arg.split('/');
  designPath = `/root/Folio/folio-projects/${proj}/designs/${name}.design.yaml`;
}
const dir = path.dirname(designPath);
const base = path.basename(designPath).replace(/\.design\.yaml$/, '');
const svgPath = `${dir}/${base}.svg`;
if (!fs.existsSync(svgPath)) { console.error(`Missing ${svgPath} — run export_design format:"svg" first.`); process.exit(1); }

const svg = fs.readFileSync(svgPath, 'utf8');
const design = yaml.load(fs.readFileSync(designPath, 'utf8')) ?? {};
const W = design?.document?.width ?? 1080;
const H = design?.document?.height ?? 1350;

// Collect every layer (recursing into groups) that carries an href → link overlay.
const links = [];
const walk = (layers) => { for (const l of layers ?? []) {
  if (l && l.href) {
    const x = l.x ?? l.pos?.[0] ?? 0, y = l.y ?? l.pos?.[1] ?? 0, w = l.width ?? l.pos?.[2] ?? 0, h = l.height ?? l.pos?.[3] ?? 0;
    links.push({ href: l.href, x, y, w, h });
  }
  if (Array.isArray(l?.layers)) walk(l.layers);
} };
walk(design?.layers);

// Web fonts actually used in the SVG → Google Fonts <link> so Chrome renders them.
const fams = [...new Set((svg.match(/font-family="([^"]+)"/g) || []).map(m => m.replace(/font-family="|"/g, '')))]
  .filter(f => f && !/^(sans-serif|monospace|serif|ui-monospace)$/i.test(f.trim()));
const fontLink = fams.length
  ? `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?${fams.map(f => 'family=' + f.trim().replace(/ /g, '+') + ':wght@400;500;600;700;800').join('&')}&display=swap">`
  : '';
const overlays = links.map(l => `<a href="${l.href}" style="left:${l.x}px;top:${l.y}px;width:${l.w}px;height:${l.h}px"></a>`).join('');

const html = `<!doctype html><html><head><meta charset="utf8">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>${fontLink}
<style>@page{size:${W}px ${H}px;margin:0}*{margin:0;padding:0;box-sizing:border-box}
#wrap{position:relative;width:${W}px;height:${H}px;overflow:hidden}#wrap svg{position:absolute;inset:0}a{position:absolute;display:block}</style></head>
<body><div id="wrap">${svg}${overlays}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: `${dir}/${base}-hifi.png` });
await page.pdf({ path: `${dir}/${base}-hifi.pdf`, width: `${W}px`, height: `${H}px`, printBackground: true, pageRanges: '1' });
await browser.close();
console.log(`✓ ${base}-hifi.png + ${base}-hifi.pdf — ${links.length} link(s); fonts: ${fams.join(', ') || 'default'}`);

// Design Library gallery — a self-contained HTML "file manager" over the whole
// collection. One page: every project, every design, as a thumbnail card with its
// name/type/size and a click-through to open it in the editor, with a live search
// box. Written to <projects>/library.html (+ cached thumbnails under .library/),
// so you can open the file and browse everything you've ever made in one place.
//
// Thumbnails reuse the same SVG→PNG path as render_preview (renderToSVGString +
// resvg), but skip component resolution (fine at thumbnail size) so this module
// never imports engine.ts — no import cycle. Thumbs are CACHED by mtime: a second
// build only re-renders designs that changed, and a per-call cap bounds wall time.

import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-js';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { okResult, errResult, buildContext, pOk, pInfo, readYAML } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { collectLibrary, type LibraryDesign } from './library';

const esc = (s: string): string => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const slug = (s: string): string => s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120);

/** Render a design's first page to a small PNG, or null if it can't render. */
function renderThumb(designPath: string): Buffer | null {
  try {
    const spec = readYAML<DesignSpec>(designPath);
    const renderSpec = spec.pages?.length
      ? ({ ...spec, layers: spec.pages[0]?.layers ?? [], pages: undefined } as DesignSpec)
      : spec;
    const svg = renderToSVGString(renderSpec, undefined, undefined, undefined);
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 360 }, background: '#ffffff', font: resvgFontOption() }).render().asPng());
  } catch { return null; }
}

/** Ensure a cached thumbnail exists for a design; return its relative href or null. */
function thumbFor(d: LibraryDesign, thumbsDir: string, relBase: string, budget: { left: number }): string | null {
  const file = `${slug(path.basename(path.dirname(path.dirname(d.design_path))))}__${slug(path.basename(d.design_path))}.png`;
  const abs = path.join(thumbsDir, file);
  const rel = `${relBase}/${file}`;
  try {
    const dMtime = fs.statSync(d.design_path).mtimeMs;
    if (fs.existsSync(abs) && fs.statSync(abs).mtimeMs >= dMtime) return rel; // cache hit
  } catch { /* fall through to render */ }
  if (budget.left <= 0) return null;                        // per-call render cap reached
  const png = renderThumb(d.design_path);
  budget.left--;
  if (!png) return null;
  try { fs.mkdirSync(thumbsDir, { recursive: true }); fs.writeFileSync(abs, png); } catch { return null; }
  return rel;
}

function card(d: LibraryDesign, project: string, href: string | null): string {
  const dims = d.width && d.height ? `${d.width}×${d.height}` : '';
  const pages = d.pages && d.pages > 1 ? ` · ${d.pages}p` : '';
  const link = d.open_url ?? '#';
  const thumb = href
    ? `<img loading="lazy" src="${esc(href)}" alt="">`
    : `<div class="ph">${esc(d.type)}</div>`;
  return `<a class="card" href="${esc(link)}" target="_blank" data-name="${esc((d.name + ' ' + d.type + ' ' + project).toLowerCase())}" data-type="${esc(d.type.toLowerCase())}">
    <div class="thumb">${thumb}</div>
    <div class="meta"><span class="nm">${esc(d.name)}</span><span class="sub">${esc(d.type)} · ${dims}${pages}</span><span class="proj">${esc(project)}</span></div>
  </a>`;
}

const STYLE = `*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;background:#0E1116;color:#E6EAF0}
header{position:sticky;top:0;background:#0E1116ee;backdrop-filter:blur(8px);padding:20px 28px;border-bottom:1px solid #222833;z-index:5}
h1{margin:0 0 10px;font-size:20px;font-weight:700}.stat{color:#8A93A6;font-size:13px}
#q{margin-top:12px;width:100%;max-width:420px;padding:9px 14px;border-radius:10px;border:1px solid #2A323F;background:#161B22;color:#E6EAF0;font-size:14px}
.proj{padding:22px 28px}.chips{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:5px 12px;border-radius:999px;border:1px solid #2A323F;background:#161B22;color:#9AA3B6;font-size:12px;cursor:pointer;user-select:none}
.chip:hover{border-color:#3B82F6}.chip.on{background:#3B82F6;border-color:#3B82F6;color:#fff}
.grid{padding:22px 28px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
.card{text-decoration:none;color:inherit;background:#161B22;border:1px solid #232A35;border-radius:12px;overflow:hidden;transition:.15s;display:block}
.card:hover{border-color:#3B82F6;transform:translateY(-2px)}
.thumb{aspect-ratio:1;background:#0A0D12;display:flex;align-items:center;justify-content:center;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:contain}.ph{color:#3D4759;font-size:13px;text-transform:uppercase;letter-spacing:.08em}
.meta{padding:10px 12px}.nm{display:block;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{color:#7A839A;font-size:11px}.proj{display:block;color:#566076;font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.empty{display:none;padding:60px;text-align:center;color:#5C6678}`;

const SCRIPT = `const q=document.getElementById('q'),cards=[...document.querySelectorAll('.card')],chips=[...document.querySelectorAll('.chip')];
let type='';
function apply(){const t=q.value.toLowerCase().trim();let any=false;
for(const c of cards){const m=(!t||c.dataset.name.includes(t))&&(!type||c.dataset.type===type);c.style.display=m?'':'none';if(m)any=true;}
document.getElementById('empty').style.display=any?'none':'block';}
q.addEventListener('input',apply);
for(const ch of chips){ch.addEventListener('click',()=>{const v=ch.dataset.t||'';type=type===v?'':v;for(const x of chips)x.classList.toggle('on',x.dataset.t===type&&type!=='');apply();});}`;

export function exportLibraryGallery(args: { output_path?: string; max_thumbnails?: number; search?: string; type?: string }): ToolResult {
  const op = 'export_library_gallery';
  const root = process.env['FOLIO_PROJECTS_DIR'];
  if (!root || !fs.existsSync(root)) return errResult(op, 'No projects directory found', 'FOLIO_PROJECTS_DIR is not set, or the path does not exist.');

  const { projects, totalProjects, totalDesigns } = collectLibrary({ search: args.search, type: args.type, sort: 'modified', includeLinks: true });
  const outPath = args.output_path ? path.resolve(args.output_path) : path.join(root, 'library.html');
  const thumbsDir = path.join(path.dirname(outPath), '.library', 'thumbs');
  const relBase = '.library/thumbs';
  const budget = { left: Math.max(0, Math.min(args.max_thumbnails ?? 120, 600)) };

  // One flat, dense grid of every design — newest first, project shown per card.
  // 333 projects with ~1 design each makes per-project sections mostly whitespace;
  // a single grid + live search/type-chips is the file-manager browse you want.
  const flat: { d: LibraryDesign; project: string }[] = [];
  for (const p of projects) for (const d of p.designs) flat.push({ d, project: p.name });
  flat.sort((a, b) => b.d.modified.localeCompare(a.d.modified));
  const cards = flat.map(({ d, project }) => card(d, project, thumbFor(d, thumbsDir, relBase, budget))).join('\n');
  const types = [...new Set(flat.map(x => x.d.type.toLowerCase()))].filter(Boolean).sort();
  const chips = types.map(t => `<span class="chip" data-t="${esc(t)}">${esc(t)}</span>`).join('');

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio — Design Library</title><style>${STYLE}</style></head>
<body><header><h1>Design Library</h1><div class="stat">${totalProjects} projects · ${totalDesigns} designs${(args.search || args.type) ? ` · filtered` : ''}</div><input id="q" type="search" placeholder="Search designs, projects…" autocomplete="off">${chips ? `<div class="chips">${chips}</div>` : ''}</header>
<div class="grid">${cards}</div>
<div id="empty" class="empty">No designs match your search.</div>
<script>${SCRIPT}</script></body></html>`;

  try { fs.writeFileSync(outPath, html); } catch (err) { return errResult(op, `Could not write gallery: ${(err as Error).message}`, 'Check output_path is writable.'); }
  const rendered = (args.max_thumbnails ?? 120) - budget.left;
  const progress = [
    pOk(`Wrote gallery for ${totalProjects} project(s) · ${totalDesigns} design(s)`, outPath),
    pInfo(`Rendered ${rendered} new thumbnail(s)`, budget.left <= 0 ? 'thumbnail cap reached — re-run to fill the rest (cached)' : 'cached by mtime'),
  ];
  const context = buildContext(op, `Design Library gallery → ${outPath}`, [{ type: 'gallery', path: outPath, role: 'created' }]);
  return okResult(op, { gallery_path: outPath, total_projects: totalProjects, total_designs: totalDesigns, thumbnails_rendered: rendered, progress, context });
}

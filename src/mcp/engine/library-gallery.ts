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
import { loadCollections, allCollections, effectiveCollection, relKey } from './library-collections';

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

function card(d: LibraryDesign, project: string, href: string | null, key: string, col: string, cols: string[]): string {
  const dims = d.width && d.height ? `${d.width}×${d.height}` : '';
  const pages = d.pages && d.pages > 1 ? ` · ${d.pages}p` : '';
  const link = d.open_url ?? '#';
  const thumb = href
    ? `<img loading="lazy" src="${esc(href)}" alt="">`
    : `<div class="ph">${esc(d.type)}</div>`;
  const opts = cols.filter((c, i, a) => a.indexOf(c) === i)
    .map(c => `<option value="${esc(c)}"${c === col ? ' selected' : ''}>${esc(c)}</option>`).join('');
  return `<div class="card" data-name="${esc((d.name + ' ' + d.type + ' ' + project).toLowerCase())}" data-type="${esc(d.type.toLowerCase())}" data-col="${esc(col)}" data-key="${esc(key)}">
    <a class="open" href="${esc(link)}" target="_blank" rel="noopener">
      <div class="thumb">${thumb}</div>
      <div class="meta"><span class="nm">${esc(d.name)}</span><span class="sub">${esc(d.type)} · ${dims}${pages}</span><span class="proj">${esc(project)}</span></div>
    </a>
    <div class="bar"><span class="mvlbl">in</span><select class="mv" aria-label="Move to collection">${opts}</select></div>
  </div>`;
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
.empty{display:none;padding:60px;text-align:center;color:#5C6678}
.open{text-decoration:none;color:inherit;display:block}
.cols{margin-top:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cols .lbl{color:#566076;font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-right:2px}
.col-chip{padding:5px 12px;border-radius:8px;border:1px solid #2A323F;background:#161B22;color:#C9D2E3;font-size:12px;font-weight:600;cursor:pointer;user-select:none}
.col-chip:hover{border-color:#3B82F6}.col-chip.on{background:#1D4ED8;border-color:#1D4ED8;color:#fff}
.col-chip .ct{font-weight:400;opacity:.6;margin-left:5px}
.bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid #232A35}
.mvlbl{color:#566076;font-size:11px}
.mv{flex:1;min-width:0;background:#0E1116;color:#9AA3B6;border:1px solid #2A323F;border-radius:7px;padding:5px 8px;font-size:12px;cursor:pointer}
.mv:hover{border-color:#3B82F6}.card.saving{opacity:.55}
@media(max-width:600px){header{padding:14px 16px}h1{font-size:18px}
.grid{padding:14px 16px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.cols,.chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.col-chip,.chip{white-space:nowrap}.mv{font-size:14px;padding:7px 8px}}`;

const SCRIPT = `const q=document.getElementById('q'),cards=[...document.querySelectorAll('.card')];
const chips=[...document.querySelectorAll('.chip')],colChips=[...document.querySelectorAll('.col-chip')];
let type='',col='';
function counts(){for(const ch of colChips){const v=ch.dataset.c||'';const n=v?cards.filter(c=>c.dataset.col===v).length:cards.length;const s=ch.querySelector('.ct');if(s)s.textContent=n;}}
function apply(){const t=q.value.toLowerCase().trim();let any=false;
for(const c of cards){const m=(!t||c.dataset.name.includes(t))&&(!type||c.dataset.type===type)&&(!col||c.dataset.col===col);c.style.display=m?'':'none';if(m)any=true;}
document.getElementById('empty').style.display=any?'none':'block';}
q.addEventListener('input',apply);
for(const ch of chips){ch.addEventListener('click',()=>{const v=ch.dataset.t||'';type=type===v?'':v;for(const x of chips)x.classList.toggle('on',x.dataset.t===type&&type!=='');apply();});}
for(const ch of colChips){ch.addEventListener('click',()=>{const v=ch.dataset.c||'';col=(v===''?'':(col===v?'':v));for(const x of colChips)x.classList.toggle('on',(x.dataset.c||'')===col);apply();});}
for(const c of cards){const sel=c.querySelector('.mv');if(!sel)continue;
sel.addEventListener('change',async()=>{const to=sel.value,prev=c.dataset.col;c.classList.add('saving');
try{const r=await fetch('/__library/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:c.dataset.key,collection:to})});
if(!r.ok)throw 0;const j=await r.json();c.dataset.col=j.collection;}
catch(e){sel.value=prev;alert('Could not save — make sure you are still signed in.');}
c.classList.remove('saving');counts();apply();});}
counts();apply();`;

export function exportLibraryGallery(args: { output_path?: string; max_thumbnails?: number; search?: string; type?: string }): ToolResult {
  const op = 'export_library_gallery';
  const root = process.env['FOLIO_PROJECTS_DIR'];
  if (!root || !fs.existsSync(root)) return errResult(op, 'No projects directory found', 'FOLIO_PROJECTS_DIR is not set, or the path does not exist.');

  const { projects, totalProjects, totalDesigns } = collectLibrary({ search: args.search, type: args.type, sort: 'modified', includeLinks: true });
  const collState = loadCollections(root);
  const cols = allCollections(collState);
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
  const cards = flat.map(({ d, project }) => {
    const key = relKey(root, d.design_path);
    return card(d, project, thumbFor(d, thumbsDir, relBase, budget), key, effectiveCollection(key, project, collState), cols);
  }).join('\n');
  const types = [...new Set(flat.map(x => x.d.type.toLowerCase()))].filter(Boolean).sort();
  const chips = types.map(t => `<span class="chip" data-t="${esc(t)}">${esc(t)}</span>`).join('');
  const colTabs = `<div class="cols"><span class="lbl">Collections</span><span class="col-chip on" data-c="">All <span class="ct"></span></span>`
    + cols.map(c => `<span class="col-chip" data-c="${esc(c)}">${esc(c)} <span class="ct"></span></span>`).join('') + `</div>`;

  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio — Design Library</title><style>${STYLE}</style></head>
<body><header><h1>Design Library</h1><div class="stat">${totalProjects} projects · ${totalDesigns} designs${(args.search || args.type) ? ` · filtered` : ''} · pick a collection per card to organise</div><input id="q" type="search" placeholder="Search designs, projects…" autocomplete="off">${colTabs}${chips ? `<div class="chips">${chips}</div>` : ''}</header>
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

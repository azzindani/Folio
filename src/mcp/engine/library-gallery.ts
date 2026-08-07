// Design Library gallery — a self-contained HTML "file manager" over the whole
// collection. One page: every project, every design, as a thumbnail card with its
// name/type/size and a click-through to open it in the editor, with live search,
// sort (newest / name / type / project), a grid⇄list view toggle, and — when
// served live — auto-refresh so a newly created design appears on its own.
//
// Two consumers share one HTML builder (buildLibraryPage):
//   • export_library_gallery → writes <projects>/library.html with thumbnails
//     pre-rendered + cached under .library/thumbs/ (a portable, offline snapshot).
//   • the static server's live /library route → renders the SAME page on every
//     request (always current) and points each card at the /__library/thumb
//     endpoint, which renders + caches a thumbnail on demand.
//
// Thumbnails reuse the same SVG→PNG path as render_preview (renderToSVGString +
// resvg), but skip component resolution (fine at thumbnail size) so this module
// never imports engine.ts — no import cycle. Thumbs are CACHED by mtime.

import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-js';
import { FAVICON_LINK } from '../../utils/favicon';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { okResult, errResult, buildContext, pOk, pInfo, readYAML } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { collectLibrary, readDesignHeader, type LibraryDesign, type LibraryProject } from './library';
import { loadCollections, allCollections, effectiveCollection, relKey, type CollectionsState } from './library-collections';
import { buildEditorLink } from './editor-link';
import { ASSET_STYLE, ASSET_SCRIPT, assetDrawerMarkup } from './library-assets';

const esc = (s: string): string => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const slug = (s: string): string => s.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 120);

/** Render a design's first page to a small PNG, or null if it can't render. */
export function renderThumb(designPath: string): Buffer | null {
  try {
    const spec = readYAML<DesignSpec>(designPath);
    const renderSpec = spec.pages?.length
      ? ({ ...spec, layers: spec.pages[0]?.layers ?? [], pages: undefined } as DesignSpec)
      : spec;
    const svg = renderToSVGString(renderSpec, undefined, undefined, undefined);
    return Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: 360 }, background: '#ffffff', font: resvgFontOption() }).render().asPng());
  } catch { return null; }
}

/** Stable cache filename for a design's thumbnail (project__file.png). */
export function thumbFileName(designPath: string): string {
  return `${slug(path.basename(path.dirname(path.dirname(designPath))))}__${slug(path.basename(designPath))}.png`;
}

/** Ensure a cached thumbnail file exists for a design; return its relative href or null. */
function thumbForFile(d: LibraryDesign, thumbsDir: string, relBase: string, budget: { left: number }): string | null {
  const file = thumbFileName(d.design_path);
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
  // Extreme aspect ratios (a healed scroll-poster, a wide banner) letterbox
  // into an unreadable sliver inside the square thumb — crop from the start
  // edge instead so the card shows real content.
  const ratio = d.width && d.height ? d.height / d.width : 1;
  const aspectCls = ratio > 1.65 ? ' tall' : ratio < 0.6 ? ' wide' : '';
  const thumb = href
    ? `<img loading="lazy" src="${esc(href)}" alt="" onerror="this.parentNode.classList.add('noimg')">`
    : `<div class="ph">${esc(d.type)}</div>`;
  const opts = cols.filter((c, i, a) => a.indexOf(c) === i)
    .map(c => `<option value="${esc(c)}"${c === col ? ' selected' : ''}>${esc(c)}</option>`).join('')
    + `<option value="__new__">+ New collection…</option>`;
  return `<div class="card${aspectCls}" data-name="${esc((d.name + ' ' + d.type + ' ' + project).toLowerCase())}" data-nm="${esc(d.name.toLowerCase())}" data-type="${esc(d.type.toLowerCase())}" data-proj="${esc(project.toLowerCase())}" data-mod="${esc(d.modified)}" data-col="${esc(col)}" data-key="${esc(key)}">
    <a class="open" href="${esc(link)}" target="_blank" rel="noopener">
      <div class="thumb">${thumb}</div>
      <div class="meta"><span class="nm">${esc(d.name)}</span><span class="sub">${esc(d.type)} · ${dims}${pages}</span><span class="proj">${esc(project)}</span><span class="when">${esc(d.modified.slice(0, 10))}</span></div>
    </a>
    <div class="bar"><span class="mvlbl">in</span><select class="mv" aria-label="Move to collection">${opts}</select><button class="ops-t" type="button" title="Rename / move / delete" aria-label="Manage">⋯</button></div>
    <div class="ops" hidden><button type="button" data-op="rename">Rename</button><button type="button" data-op="move">Move</button><button type="button" data-op="delete">Delete</button></div>
  </div>`;
}

/** Render ONE card for a design at `designPath` (cheap header read). Used by the
 *  live SSE hub to push a just-created design's card to open /library tabs. */
export function renderCardForDesign(opts: {
  root: string; designPath: string; collState: CollectionsState; cols: string[];
  thumbHref: (key: string) => string;
}): { key: string; html: string } | null {
  let mtime = 0;
  try { mtime = fs.statSync(opts.designPath).mtimeMs; } catch { return null; }
  const h = readDesignHeader(opts.designPath);
  const project = path.basename(path.dirname(path.dirname(opts.designPath)));
  const d: LibraryDesign = {
    name: h.name ?? path.basename(opts.designPath).replace(/\.design\.yaml$/, ''),
    type: h.type ?? 'poster', design_path: opts.designPath,
    width: h.width, height: h.height, pages: h.pages,
    modified: new Date(mtime).toISOString(),
    open_url: buildEditorLink(opts.designPath).open_url,
  };
  const key = relKey(opts.root, opts.designPath);
  return { key, html: card(d, project, opts.thumbHref(key), key, effectiveCollection(key, project, opts.collState), opts.cols) };
}

const STYLE = `:root{--bg:#0E1116;--fg:#E6EAF0;--panel:#161B22;--panel2:#0A0D12;--bd:#232A35;--bd2:#2A323F;--mut:#8A93A6;--mut2:#566076;--acc:#3B82F6;--acc2:#1D4ED8}
:root[data-theme=light]{--bg:#F4F6FA;--fg:#1B2433;--panel:#FFFFFF;--panel2:#EBEFF5;--bd:#E2E7EF;--bd2:#D2DAE5;--mut:#5E6A7E;--mut2:#8893A6;--acc:#2563EB;--acc2:#1D4ED8}
*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--fg)}
header{position:sticky;top:0;background:var(--bg);backdrop-filter:blur(8px);padding:20px 28px;border-bottom:1px solid var(--bd);z-index:5}
h1{margin:0 0 10px;font-size:20px;font-weight:700}.stat{color:var(--mut);font-size:13px}
.theme-btn{position:absolute;top:18px;right:24px;background:var(--panel);border:1px solid var(--bd2);color:var(--fg);border-radius:9px;padding:7px 11px;font-size:13px;cursor:pointer}
.theme-btn:hover{border-color:var(--acc)}
.live-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#9aa4b5;margin-left:6px;vertical-align:middle;transition:background .3s}
.live-dot.on{background:#22C55E}
.card.justadded{animation:addglow 1.5s ease-out}
@keyframes addglow{0%{border-color:var(--acc)}60%{border-color:var(--acc)}100%{border-color:var(--bd)}}
#q{margin-top:12px;width:100%;max-width:420px;padding:9px 14px;border-radius:10px;border:1px solid var(--bd2);background:var(--panel);color:var(--fg);font-size:14px}
.toolbar{margin-top:12px;display:flex;flex-wrap:wrap;gap:18px;align-items:center}
.sorts,.cols,.chips{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.lbl{color:var(--mut2);font-size:11px;text-transform:uppercase;letter-spacing:.08em;margin-right:2px}
.sortb{padding:5px 11px;border-radius:8px;border:1px solid var(--bd2);background:var(--panel);color:var(--mut);font-size:12px;cursor:pointer}
.sortb:hover{border-color:var(--acc)}.sortb.on{background:var(--acc);border-color:var(--acc);color:#fff}
.viewt{display:inline-flex;border:1px solid var(--bd2);border-radius:8px;overflow:hidden}
.viewb{background:var(--panel);border:0;color:var(--mut);padding:5px 10px;font-size:13px;cursor:pointer}
.viewb.on{background:var(--acc);color:#fff}
.folders{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.folderf{background:var(--panel);color:var(--fg);border:1px solid var(--bd2);border-radius:8px;padding:5px 8px;font-size:12px;max-width:220px;cursor:pointer}
.folderf:hover{border-color:var(--acc)}
.fbtn{background:var(--panel);color:var(--mut);border:1px solid var(--bd2);border-radius:8px;padding:5px 10px;font-size:12px;cursor:pointer}
.fbtn:hover{border-color:var(--acc);color:var(--fg)}.fbtn[hidden]{display:none}
.fbtn-danger:hover{border-color:#EF4444;color:#EF4444}
.chip{padding:5px 12px;border-radius:999px;border:1px solid var(--bd2);background:var(--panel);color:var(--mut);font-size:12px;cursor:pointer;user-select:none}
.chip:hover{border-color:var(--acc)}.chip.on{background:var(--acc);border-color:var(--acc);color:#fff}
.grid{padding:22px 28px;display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:16px}
.card{background:var(--panel);border:1px solid var(--bd);border-radius:12px;overflow:hidden;transition:.15s}
.card:hover{border-color:var(--acc);transform:translateY(-2px)}
.thumb{aspect-ratio:1;background:var(--panel2);display:flex;align-items:center;justify-content:center;overflow:hidden}
.thumb img{width:100%;height:100%;object-fit:contain}.ph,.noimg .thumb::after{color:var(--mut2);font-size:13px;text-transform:uppercase;letter-spacing:.08em}
.card.tall .thumb img{object-fit:cover;object-position:top}
.card.wide .thumb img{object-fit:cover;object-position:left}
.noimg .thumb::after{content:"no preview"}.noimg .thumb img{display:none}
.meta{padding:10px 12px}.nm{display:block;font-weight:600;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{color:var(--mut);font-size:11px}.proj{display:block;color:var(--mut2);font-size:11px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.when{display:none;color:var(--mut2);font-size:11px}
.empty{display:none;padding:60px;text-align:center;color:var(--mut2)}
.open{text-decoration:none;color:inherit;display:block}
.col-chip{padding:5px 12px;border-radius:8px;border:1px solid var(--bd2);background:var(--panel);color:var(--fg);font-size:12px;font-weight:600;cursor:pointer;user-select:none}
.col-chip:hover{border-color:var(--acc)}.col-chip.on{background:var(--acc2);border-color:var(--acc2);color:#fff}
.col-chip .ct{font-weight:400;opacity:.6;margin-left:5px}
.bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-top:1px solid var(--bd)}
.mvlbl{color:var(--mut2);font-size:11px}
.mv{flex:1;min-width:0;background:var(--bg);color:var(--fg);border:1px solid var(--bd2);border-radius:7px;padding:5px 8px;font-size:12px;cursor:pointer}
.mv:hover{border-color:var(--acc)}.card.saving{opacity:.55}
.ops-t{background:transparent;border:1px solid var(--bd2);color:var(--mut);border-radius:7px;padding:4px 8px;cursor:pointer;font-size:13px;line-height:1}
.ops-t:hover{border-color:var(--acc);color:var(--fg)}
.ops{display:flex;gap:6px;padding:0 10px 10px}.ops[hidden]{display:none}
.ops button{flex:1;background:var(--panel2);border:1px solid var(--bd2);color:var(--mut);border-radius:7px;padding:6px 4px;font-size:11px;cursor:pointer}
.ops button:hover{border-color:var(--acc);color:var(--fg)}.ops button[data-op=delete]:hover{border-color:#EF4444;color:#EF4444}
body[data-view=list] .grid{grid-template-columns:1fr;gap:6px;padding:16px 28px}
body[data-view=list] .card{display:flex;align-items:center;flex-wrap:wrap}
body[data-view=list] .card .open{display:flex;align-items:center;gap:14px;flex:1;min-width:240px}
body[data-view=list] .card .thumb{width:80px;height:56px;aspect-ratio:auto;flex:none;border-radius:6px}
body[data-view=list] .card .meta{padding:0;display:flex;gap:16px;align-items:baseline;flex:1}
body[data-view=list] .card .nm{font-size:14px}body[data-view=list] .card .proj{margin-top:0}
body[data-view=list] .card .when{display:inline}
body[data-view=list] .card .bar{border-top:0;margin-left:auto}
@media(max-width:600px){header{padding:14px 16px}h1{font-size:18px}.theme-btn{top:12px;right:14px}
.grid{padding:14px 16px;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.toolbar,.cols,.chips,.sorts{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;padding-bottom:4px}
.col-chip,.chip,.sortb{white-space:nowrap}.mv{font-size:14px;padding:7px 8px}
/* visible scroll affordance — without it a clipped pill row reads as broken */
.toolbar::-webkit-scrollbar,.cols::-webkit-scrollbar,.chips::-webkit-scrollbar,.sorts::-webkit-scrollbar{height:4px}
.toolbar::-webkit-scrollbar-thumb,.cols::-webkit-scrollbar-thumb,.chips::-webkit-scrollbar-thumb,.sorts::-webkit-scrollbar-thumb{background:var(--bd2);border-radius:2px}
.toolbar,.cols,.chips,.sorts{scrollbar-width:thin;scrollbar-color:var(--bd2) transparent}}`;

const SCRIPT = `const q=document.getElementById('q'),cards=[...document.querySelectorAll('.card')],grid=document.querySelector('.grid');
const chips=[...document.querySelectorAll('.chip')],colsEl=document.querySelector('.cols');
let type='',col='',fdir='';
const colChipEls=()=>colsEl?[...colsEl.querySelectorAll('.col-chip')]:[];
function counts(){for(const ch of colChipEls()){const v=ch.dataset.c||'';const n=v?cards.filter(c=>c.dataset.col===v).length:cards.length;const s=ch.querySelector('.ct');if(s)s.textContent=n;}}
function apply(){const t=q.value.toLowerCase().trim();const fl=fdir.toLowerCase();let any=false;
for(const c of cards){const m=(!t||c.dataset.name.includes(t))&&(!type||c.dataset.type===type)&&(!col||c.dataset.col===col)&&(!fl||c.dataset.proj===fl);c.style.display=m?'':'none';if(m)any=true;}
const e=document.getElementById('empty');if(e)e.style.display=any?'none':'block';}
q.addEventListener('input',apply);
for(const ch of chips){ch.addEventListener('click',()=>{const v=ch.dataset.t||'';type=type===v?'':v;for(const x of chips)x.classList.toggle('on',x.dataset.t===type&&type!=='');apply();});}
if(colsEl)colsEl.addEventListener('click',e=>{const ch=e.target.closest('.col-chip');if(!ch)return;const v=ch.dataset.c||'';col=(v===''?'':(col===v?'':v));for(const x of colChipEls())x.classList.toggle('on',(x.dataset.c||'')===col);apply();});
let sortKey='newest';try{sortKey=localStorage.getItem('folio-lib-sort')||'newest';}catch(e){}
const sortbs=[...document.querySelectorAll('.sortb')];
function cmp(a,b){if(sortKey==='name')return a.dataset.nm.localeCompare(b.dataset.nm);
if(sortKey==='type')return a.dataset.type.localeCompare(b.dataset.type)||a.dataset.nm.localeCompare(b.dataset.nm);
if(sortKey==='project')return a.dataset.proj.localeCompare(b.dataset.proj)||a.dataset.nm.localeCompare(b.dataset.nm);
return (b.dataset.mod||'').localeCompare(a.dataset.mod||'');}
function sortNow(){const arr=cards.slice().sort(cmp);for(const el of arr)grid.appendChild(el);}
function setSort(k){sortKey=k;try{localStorage.setItem('folio-lib-sort',k);}catch(e){}for(const b of sortbs)b.classList.toggle('on',b.dataset.s===k);sortNow();apply();}
for(const b of sortbs)b.addEventListener('click',function(){setSort(this.dataset.s);});
let view='grid';try{view=localStorage.getItem('folio-lib-view')||'grid';}catch(e){}
const viewbs=[...document.querySelectorAll('.viewb')];
function setView(v){view=v;try{localStorage.setItem('folio-lib-view',v);}catch(e){}document.body.dataset.view=v;for(const b of viewbs)b.classList.toggle('on',b.dataset.v===v);}
for(const b of viewbs)b.addEventListener('click',function(){setView(this.dataset.v);});
var T=document.getElementById('theme');
function setT(m){document.documentElement.dataset.theme=m;if(T)T.textContent=(m==='light'?'☾ Dark':'☀ Light');try{localStorage.setItem('folio-lib-theme',m);}catch(e){}}
setT(document.documentElement.dataset.theme||'dark');
if(T)T.addEventListener('click',function(){setT(document.documentElement.dataset.theme==='light'?'dark':'light');});
async function save(c,sel,to){const prev=c.dataset.col;c.classList.add('saving');
try{const r=await fetch('/__library/assign',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({design:c.dataset.key,collection:to})});
if(!r.ok)throw 0;const j=await r.json();c.dataset.col=j.collection;sel.value=j.collection;}
catch(e){sel.value=prev;alert('Could not save — make sure you are still signed in.');}
c.classList.remove('saving');counts();apply();}
function ensureTab(name){if(colChipEls().some(ch=>ch.dataset.c===name))return;const sp=document.createElement('span');sp.className='col-chip';sp.dataset.c=name;sp.innerHTML=name+' <span class="ct"></span>';const uns=colChipEls().find(ch=>(ch.dataset.c||'')==='Unsorted');if(colsEl)colsEl.insertBefore(sp,uns||null);}
function addOptionEverywhere(name){for(const c of cards){const s=c.querySelector('.mv');if(!s||[...s.options].some(o=>o.value===name))continue;const o=document.createElement('option');o.value=name;o.textContent=name;s.insertBefore(o,s.querySelector('option[value="__new__"]'));}}
async function manage(c,payload){c.classList.add('saving');
try{const r=await fetch('/__library/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const j=await r.json().catch(()=>({}));if(!r.ok||!j.ok)throw new Error(j.error||'failed');c.classList.remove('saving');return j;}
catch(e){c.classList.remove('saving');alert('Could not '+payload.action+': '+(e.message||'error'));return null;}}
function bindCard(c){const sel=c.querySelector('.mv');
if(sel)sel.addEventListener('change',()=>{let to=sel.value;
if(to==='__new__'){const name=(prompt('New collection name:')||'').trim();if(!name){sel.value=c.dataset.col;return;}ensureTab(name);addOptionEverywhere(name);sel.value=name;to=name;}
save(c,sel,to);});
const tg=c.querySelector('.ops-t'),ops=c.querySelector('.ops');if(!tg||!ops)return;
tg.addEventListener('click',function(){ops.hidden=!ops.hidden;});
ops.addEventListener('click',async function(e){const btn=e.target.closest('button[data-op]');if(!btn)return;const op=btn.dataset.op,nm=c.querySelector('.nm'),cur=nm?nm.textContent:'';
if(op==='rename'){const name=(prompt('Rename design:',cur)||'').trim();if(name&&name!==cur){const j=await manage(c,{action:'rename',design:c.dataset.key,name:name});if(j){if(nm)nm.textContent=name;const pj=c.querySelector('.proj');c.dataset.name=(name+' '+c.dataset.type+' '+(pj?pj.textContent:'')).toLowerCase();c.dataset.nm=name.toLowerCase();}}}
else if(op==='move'){const project=(prompt('Move to which existing project? (project name)')||'').trim();if(project){const j=await manage(c,{action:'move',design:c.dataset.key,project:project});if(j&&j.design_path){c.dataset.key=String(j.design_path).split('/').slice(-3).join('/');const pj=c.querySelector('.proj');if(pj)pj.textContent=project;}}}
else if(op==='delete'){if(confirm('Delete "'+cur+'"? It moves to .trash (recoverable).')){const j=await manage(c,{action:'delete',design:c.dataset.key});if(j){c.remove();const i=cards.indexOf(c);if(i>=0)cards.splice(i,1);counts();}}}
ops.hidden=true;apply();});}
for(const c of cards)bindCard(c);
// ── Folders (real project directories): filter + create / rename / delete ──
var folderf=document.getElementById('folderf'),newf=document.getElementById('newfolder'),renf=document.getElementById('renfolder'),delf=document.getElementById('delfolder');
function syncFolderBtns(){if(renf)renf.hidden=!fdir;if(delf)delf.hidden=!fdir;}
if(folderf)folderf.addEventListener('change',function(){fdir=folderf.value;syncFolderBtns();apply();});
async function folderOp(payload){try{var r=await fetch('/__library/folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});var j=await r.json().catch(function(){return{};});if(!r.ok||!j.ok)throw new Error(j.error||'failed');return j;}catch(e){alert('Could not '+payload.action+' folder: '+(e.message||'error'));return null;}}
function addFolderOption(name){if(!folderf)return;for(var i=0;i<folderf.options.length;i++)if(folderf.options[i].value===name)return;var o=document.createElement('option');o.value=name;o.textContent=name+' (0)';folderf.appendChild(o);}
if(newf)newf.addEventListener('click',async function(){var name=(prompt('New folder name:')||'').trim();if(!name)return;var j=await folderOp({action:'create',name:name});if(j&&j.project){addFolderOption(j.project);folderf.value=j.project;fdir=j.project;syncFolderBtns();apply();}});
if(renf)renf.addEventListener('click',async function(){if(!fdir)return;var name=(prompt('Rename folder "'+fdir+'" to:',fdir)||'').trim();if(!name||name===fdir)return;var old=fdir;var j=await folderOp({action:'rename',name:old,new_name:name});if(j&&j.project){for(var i=0;i<folderf.options.length;i++)if(folderf.options[i].value===old){var cm=(folderf.options[i].textContent.match(/\\(\\d+\\)\\s*$/)||[''])[0];folderf.options[i].value=j.project;folderf.options[i].textContent=j.project+(cm?' '+cm:'');}fdir=j.project;folderf.value=j.project;syncFolderBtns();apply();}});
if(delf)delf.addEventListener('click',async function(){if(!fdir)return;if(!confirm('Delete folder "'+fdir+'"? It moves to .trash (recoverable).'))return;var old=fdir;var j=await folderOp({action:'delete',name:old});if(j){for(var i=0;i<folderf.options.length;i++)if(folderf.options[i].value===old){folderf.remove(i);break;}fdir='';if(folderf)folderf.value='';syncFolderBtns();apply();}});
syncFolderBtns();
// ── Live updates over SSE (no page reload → no blink) ──
// The server pushes add / update / remove events as designs change on disk;
// we splice cards into the grid in place, respecting the current sort+filter.
function cardByKey(k){for(const c of cards)if(c.dataset.key===k)return c;return null;}
function onAdd(m){if(!m||!m.key||cardByKey(m.key))return;grid.insertAdjacentHTML('afterbegin',m.html);const el=grid.firstElementChild;if(!el)return;el.classList.add('justadded');cards.push(el);bindCard(el);counts();sortNow();apply();}
function onUpdate(m){if(!m||!m.key)return;const el=cardByKey(m.key);if(!el)return;const img=el.querySelector('.thumb img');if(img){const base=img.getAttribute('src').split('&t=')[0];img.setAttribute('src',base+'&t='+(m.t||''));el.classList.remove('noimg');}}
function onRemove(m){if(!m||!m.key)return;const el=cardByKey(m.key);if(!el)return;el.remove();const i=cards.indexOf(el);if(i>=0)cards.splice(i,1);counts();apply();}
// On (re)connect, if our card count drifted from the server's, swap just the
// grid body (one fetch, header/scroll preserved) — covers any missed event.
async function reconcile(){try{const r=await fetch('/__library/stat',{headers:{Accept:'application/json'}});if(!r.ok)return;const s=await r.json();if(s.count===cards.length)return;
const g=await fetch(location.pathname+'?partial=grid',{headers:{Accept:'text/html'}});if(!g.ok)return;grid.innerHTML=await g.text();cards.length=0;for(const el of grid.querySelectorAll('.card')){cards.push(el);bindCard(el);}counts();setSort(sortKey);}catch(e){}}
var dot=document.getElementById('livedot');
if(window.__libLive&&window.EventSource){var opened=false;var es=new EventSource('/__library/events');
es.onopen=function(){if(dot)dot.classList.add('on');if(opened)reconcile();else{opened=true;setTimeout(reconcile,800);}};
es.onerror=function(){if(dot)dot.classList.remove('on');};
es.addEventListener('add',function(e){try{onAdd(JSON.parse(e.data));}catch(x){}});
es.addEventListener('update',function(e){try{onUpdate(JSON.parse(e.data));}catch(x){}});
es.addEventListener('remove',function(e){try{onRemove(JSON.parse(e.data));}catch(x){}});}
setSort(sortKey);setView(view);counts();apply();`;

/** Build the full Library page HTML. `thumbHref` resolves each card's preview src
 *  (a cached-file path for the export, or the live /__library/thumb endpoint). */
export function buildLibraryPage(opts: {
  projects: LibraryProject[];
  totalProjects: number;
  totalDesigns: number;
  root: string;
  cols: string[];
  collState: CollectionsState;
  thumbHref: (d: LibraryDesign, key: string, project: string) => string | null;
  filtered?: boolean;
  live?: boolean;
  gridOnly?: boolean;
}): string {
  // One flat, dense grid of every design — newest first, project shown per card.
  const flat: { d: LibraryDesign; project: string }[] = [];
  for (const p of opts.projects) for (const d of p.designs) flat.push({ d, project: p.name });
  flat.sort((a, b) => b.d.modified.localeCompare(a.d.modified));
  const cards = flat.map(({ d, project }) => {
    const key = relKey(opts.root, d.design_path);
    return card(d, project, opts.thumbHref(d, key, project), key, effectiveCollection(key, project, opts.collState), opts.cols);
  }).join('\n');
  // Partial: just the card markup, for the SSE client's on-reconnect grid swap.
  if (opts.gridOnly) return cards;
  const types = [...new Set(flat.map(x => x.d.type.toLowerCase()))].filter(Boolean).sort();
  const chips = types.map(t => `<span class="chip" data-t="${esc(t)}">${esc(t)}</span>`).join('');
  const colTabs = `<div class="cols"><span class="lbl">Collections</span><span class="col-chip on" data-c="">All <span class="ct"></span></span>`
    + opts.cols.map(c => `<span class="col-chip" data-c="${esc(c)}">${esc(c)} <span class="ct"></span></span>`).join('') + `</div>`;
  const sorts = `<div class="sorts"><span class="lbl">Sort</span>`
    + `<button class="sortb" data-s="newest" type="button">Newest</button>`
    + `<button class="sortb" data-s="name" type="button">Name</button>`
    + `<button class="sortb" data-s="type" type="button">Type</button>`
    + `<button class="sortb" data-s="project" type="button">Project</button>`
    + `<span class="viewt"><button class="viewb" data-v="grid" type="button" title="Grid view">▦</button><button class="viewb" data-v="list" type="button" title="List view">☰</button></span></div>`;
  const folderList = opts.projects.map(p => ({ name: p.name, n: p.design_count })).sort((a, b) => a.name.localeCompare(b.name));
  const folderOpts = `<option value="">All folders (${opts.totalProjects})</option>`
    + folderList.map(f => `<option value="${esc(f.name)}">${esc(f.name)} (${f.n})</option>`).join('');
  const folders = `<div class="folders"><span class="lbl">Folder</span>`
    + `<select id="folderf" class="folderf" aria-label="Filter by folder">${folderOpts}</select>`
    + `<button id="newfolder" class="fbtn" type="button" title="Create a new folder">+ New</button>`
    + `<button id="renfolder" class="fbtn" type="button" title="Rename the selected folder" hidden>Rename</button>`
    + `<button id="delfolder" class="fbtn fbtn-danger" type="button" title="Delete the selected folder" hidden>Delete</button>`
    + `<button id="assetsbtn" class="fbtn" type="button" title="Upload and manage this project's images and fonts">▤ Assets</button></div>`;
  const live = opts.live ? `<script>window.__libLive=true;</script>` : '';
  const liveBadge = opts.live ? ` · live<span class="live-dot" id="livedot"></span>` : '';
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Folio — Design Library</title>${FAVICON_LINK}<script>try{var m=localStorage.getItem('folio-lib-theme');if(m)document.documentElement.dataset.theme=m;var v=localStorage.getItem('folio-lib-view');if(v)document.body&&(document.body.dataset.view=v);}catch(e){}</script><style>${STYLE}${ASSET_STYLE}</style></head>
<body><header><button id="theme" class="theme-btn" type="button" title="Toggle light / dark theme">☀ Light</button><h1>Design Library</h1><div class="stat">${opts.totalProjects} projects · ${opts.totalDesigns} designs${opts.filtered ? ` · filtered` : ''}${liveBadge}</div><input id="q" type="search" placeholder="Search designs, projects…" autocomplete="off"><div class="toolbar">${sorts}${folders}</div>${colTabs}${chips ? `<div class="chips">${chips}</div>` : ''}</header>
<div class="grid">${cards}</div>
<div id="empty" class="empty">No designs match your search.</div>
${assetDrawerMarkup(opts.projects)}
${live}<script>${SCRIPT}</script><script>${ASSET_SCRIPT}</script></body></html>`;
}

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

  const html = buildLibraryPage({
    projects, totalProjects, totalDesigns, root, cols, collState,
    thumbHref: d => thumbForFile(d, thumbsDir, relBase, budget),
    filtered: !!(args.search || args.type), live: false,
  });

  try { fs.writeFileSync(outPath, html); } catch (err) { return errResult(op, `Could not write gallery: ${(err as Error).message}`, 'Check output_path is writable.'); }
  const rendered = (args.max_thumbnails ?? 120) - budget.left;
  const progress = [
    pOk(`Wrote gallery for ${totalProjects} project(s) · ${totalDesigns} design(s)`, outPath),
    pInfo(`Rendered ${rendered} new thumbnail(s)`, budget.left <= 0 ? 'thumbnail cap reached — re-run to fill the rest (cached)' : 'cached by mtime'),
  ];
  const context = buildContext(op, `Design Library gallery → ${outPath}`, [{ type: 'gallery', path: outPath, role: 'created' }]);
  return okResult(op, { gallery_path: outPath, total_projects: totalProjects, total_designs: totalDesigns, thumbnails_rendered: rendered, progress, context });
}

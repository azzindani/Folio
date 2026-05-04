import type { DesignSpec, Page, Layer } from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';
import { bindLayers } from '../report/binder';
import { renderNavigation } from '../report/navigation';
import { renderToSVGStringUniversal as renderToSVGString } from './svg-string';
import {
  collectInteractiveLayers,
  isInteractiveLayer,
  pageHasInteractiveLayers,
  renderInteractiveLayer,
  type InteractiveRenderContext,
} from './interactive-renderers';

export interface AssembleOptions {
  title?: string;
  theme?: 'light' | 'dark';
  /** Force inclusion of Chart.js even when no chart layers detected (useful when bind-injected). */
  forceChartJs?: boolean;
}

export function assembleReportHTML(
  spec: DesignSpec,
  datasets: Map<string, LoadedDataset>,
  opts: AssembleOptions = {},
): string {
  const pages = spec.pages ?? [];
  const report = spec.report;
  const title = opts.title ?? spec.meta.name;
  const isDark = opts.theme !== 'light';

  const ctx: InteractiveRenderContext = {
    datasets,
    pageId: '',
    pageWidth: spec.document?.width ?? 1080,
    pageHeight: spec.document?.height ?? 1080,
    isDark,
    chartInits: [],
    tableInits: [],
    fontFamilies: new Set(),
    needsChartJs: !!opts.forceChartJs,
  };

  const nav = report?.navigation
    ? renderNavigation(report.navigation, pages)
    : '';

  const sections = pages.map((page, i) =>
    renderPageSection(spec, page, i, datasets, ctx),
  ).join('\n');

  const layoutClass = report?.layout === 'scroll'
    ? 'layout-scroll'
    : report?.layout === 'tabs'
    ? 'layout-tabs'
    : 'layout-paged';

  const fontLink = ctx.fontFamilies.size > 0
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?${[...ctx.fontFamilies]
  .map(f => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@300;400;500;600;700;900`)
  .join('&')}&display=swap" rel="stylesheet">`
    : '';

  const chartJsTag = ctx.needsChartJs
    ? '<script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>'
    : '';

  const initScripts = [
    ...ctx.tableInits,
    ...(ctx.chartInits.length > 0
      ? [`function __initCharts(){${ctx.chartInits.join('\n')}}
if(window.Chart){__initCharts();}else{document.addEventListener('DOMContentLoaded',function(){var t=setInterval(function(){if(window.Chart){clearInterval(t);__initCharts();}},50);});}`]
      : []),
  ].join('\n');

  return `<!DOCTYPE html>
<html lang="en" data-theme="${isDark ? 'dark' : 'light'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(title)}</title>
  ${fontLink}
  ${chartJsTag}
  <style>${REPORT_CSS}</style>
</head>
<body class="${layoutClass}">
${nav}
<main class="folio-report" id="folio-report">${sections}</main>
<script type="application/json" id="folio-design">${JSON.stringify({ meta: spec.meta, pageCount: pages.length, pageIds: pages.map(p => p.id) })}</script>
${initScripts ? `<script>${initScripts}</script>` : ''}
<script>${RUNTIME_JS}</script>
</body>
</html>`;
}

function renderPageSection(
  spec: DesignSpec,
  page: Page,
  index: number,
  datasets: Map<string, LoadedDataset>,
  ctx: InteractiveRenderContext,
): string {
  ctx.pageId = page.id;
  const boundLayers = bindLayers(page.layers ?? [], datasets);
  const active = index === 0 ? ' active' : '';

  const pageW = spec.document?.width ?? 1080;
  const pageH = spec.document?.height ?? 1080;
  ctx.pageWidth = pageW;
  ctx.pageHeight = pageH;

  // Render interactive layers as positioned HTML; non-interactive layers go to SVG.
  const hasInteractive = pageHasInteractiveLayers(boundLayers);
  if (!hasInteractive) {
    const svg = safeRenderSvg(spec, boundLayers, page.id);
    return `<section class="folio-page${active}" data-page-id="${escHtml(page.id)}" data-page-index="${index}">${svg}</section>`;
  }

  const interactiveLayers = collectInteractiveLayers(boundLayers);
  const staticLayers = stripInteractiveLayers(boundLayers);
  const svg = safeRenderSvg(spec, staticLayers, page.id);

  const interactiveHtml = interactiveLayers
    .map(l => renderInteractiveLayer(l, ctx))
    .join('\n');

  return `<section class="folio-page${active}" data-page-id="${escHtml(page.id)}" data-page-index="${index}">
    <div class="folio-page-stage" style="position:relative;width:${pageW}px;height:${pageH}px;margin:0 auto;">
      ${svg}
      ${interactiveHtml}
    </div>
  </section>`;
}

function stripInteractiveLayers(layers: Layer[]): Layer[] {
  return layers
    .filter(l => !isInteractiveLayer(l))
    .map(l => {
      const sub = (l as { layers?: Layer[] }).layers;
      if (!sub) return l;
      return { ...l, layers: stripInteractiveLayers(sub) } as Layer;
    });
}

function safeRenderSvg(spec: DesignSpec, layers: Layer[], pageId: string): string {
  if (layers.length === 0) return '';
  const boundSpec: DesignSpec = { ...spec, pages: undefined, layers };
  try {
    return renderToSVGString(boundSpec);
  } catch {
    return `<p style="color:red">Page render error: ${escHtml(pageId)}</p>`;
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Inline CSS ─────────────────────────────────────────────
const REPORT_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:system-ui,-apple-system,sans-serif}
body{display:flex;flex-direction:column;background:#0b0d12;color:#e8e8ec;
  --ic-pos:#22c55e;--ic-neg:#ef4444;--ic-muted:#94a3b8;
  --ic-surface:#161821;--ic-border:rgba(255,255,255,.08);--ic-accent:#60a5fa}
body[data-theme=light]{background:#f7f7fa;color:#1a1a1a;
  --ic-surface:#ffffff;--ic-border:rgba(0,0,0,.08);--ic-accent:#2563eb}
.folio-sidebar{position:fixed;left:0;top:0;bottom:0;overflow-y:auto;padding:1rem 0;z-index:10;background:var(--ic-surface);border-right:1px solid var(--ic-border);min-width:200px}
.folio-sidebar .nav-list{list-style:none}
.folio-sidebar .nav-item{padding:.6rem 1.2rem;cursor:pointer;white-space:nowrap}
.folio-sidebar .nav-item:hover{background:rgba(255,255,255,.04)}
.folio-sidebar .nav-item.active{font-weight:700;border-left:3px solid var(--ic-accent);background:rgba(96,165,250,.08)}
.folio-topbar{width:100%;padding:.5rem 1rem;background:var(--ic-surface);border-bottom:1px solid var(--ic-border)}
.folio-topbar .nav-list{list-style:none;display:flex;gap:1rem}
.folio-topbar .nav-item{cursor:pointer;padding:.4rem .8rem;border-radius:4px}
.folio-topbar .nav-item.active{background:rgba(96,165,250,.12);color:var(--ic-accent)}
.folio-tabs{display:flex;gap:2px;border-bottom:1px solid var(--ic-border);padding:0 1rem}
.folio-tabs .nav-tab{cursor:pointer;padding:.6rem 1.2rem;border:none;background:none;color:inherit;border-bottom:2px solid transparent}
.folio-tabs .nav-tab.active{border-bottom-color:var(--ic-accent);color:var(--ic-accent)}
.folio-dots{display:flex;gap:.5rem;justify-content:center;padding:.5rem}
.nav-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer;border:none}
.nav-dot.active{background:var(--ic-accent)}
#folio-report{flex:1;overflow:auto;padding:1rem}
.layout-paged .folio-page{display:none}
.layout-paged .folio-page.active{display:block}
.layout-scroll .folio-page{display:block;margin-bottom:2rem}
.layout-tabs .folio-page{display:none}
.layout-tabs .folio-page.active{display:block}
.folio-page-stage svg{position:absolute;top:0;left:0;max-width:100%;height:auto}
.folio-page svg:not([class]){max-width:100%;height:auto}

/* Interactive widgets */
.ic-chart{background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:6px;padding:14px;display:flex;flex-direction:column}
.ic-title{font-size:13px;font-weight:600;margin-bottom:8px;color:inherit}
.ic-chart-canvas-wrap{flex:1;position:relative;min-height:0}
.ic-chart canvas{max-width:100%;max-height:100%}

.ic-table{background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:6px;display:flex;flex-direction:column;overflow:hidden}
.ic-table-toolbar{display:flex;gap:8px;padding:8px;border-bottom:1px solid var(--ic-border)}
.ic-table-filter{flex:1;padding:6px 10px;border:1px solid var(--ic-border);border-radius:4px;background:transparent;color:inherit;font:inherit}
.ic-table-filter:focus{outline:none;border-color:var(--ic-accent)}
.ic-table-export{padding:6px 12px;border:1px solid var(--ic-border);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.ic-table-export:hover{border-color:var(--ic-accent);color:var(--ic-accent)}
.ic-table-scroll{flex:1;overflow:auto}
.ic-table table{width:100%;border-collapse:collapse;font-size:13px}
.ic-table thead th{text-align:left;padding:10px 14px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--ic-muted);border-bottom:1px solid var(--ic-border);cursor:pointer;user-select:none;white-space:nowrap;background:rgba(0,0,0,.15);position:sticky;top:0}
.ic-table thead th[data-sort='asc']::after{content:' ▲';color:var(--ic-accent);font-size:10px}
.ic-table thead th[data-sort='desc']::after{content:' ▼';color:var(--ic-accent);font-size:10px}
.ic-table tbody td{padding:10px 14px;border-bottom:1px solid var(--ic-border)}
.ic-table tbody tr:hover{background:rgba(96,165,250,.06)}
.ic-table .badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;background:rgba(96,165,250,.15);color:var(--ic-accent)}
.ic-table-pager{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-top:1px solid var(--ic-border);font-size:12px;color:var(--ic-muted)}
.ic-table-pager button{padding:4px 12px;border:1px solid var(--ic-border);border-radius:4px;background:transparent;color:inherit;cursor:pointer;font:inherit}
.ic-table-pager button:disabled{opacity:.4;cursor:not-allowed}

.ic-kpi{background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:6px;padding:14px 18px 12px;display:flex;flex-direction:column;gap:3px;overflow:hidden;position:relative}
.ic-kpi-icon{font-size:18px;margin-bottom:4px}
.ic-kpi-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ic-muted);font-weight:600}
.ic-kpi-value{font-size:26px;font-weight:700;line-height:1.1}
.ic-kpi-delta{font-size:12px;font-weight:500;position:relative;z-index:1}
.ic-kpi-spark{position:absolute;left:0;right:0;bottom:0;height:34px;color:var(--ic-accent);opacity:.35;pointer-events:none}
.ic-kpi-spark svg{width:100%;height:100%;display:block}

.ic-richtext{font-size:14px;line-height:1.55}
.ic-richtext h1{font-size:24px;margin:.4em 0}
.ic-richtext h2{font-size:18px;margin:.4em 0}
.ic-richtext h3{font-size:15px;margin:.4em 0}
.ic-richtext a{color:var(--ic-accent);text-decoration:none}
.ic-richtext a:hover{text-decoration:underline}
.ic-richtext code{font-family:ui-monospace,monospace;background:rgba(0,0,0,.2);padding:1px 6px;border-radius:3px;font-size:.92em}

.ic-embed{overflow:hidden}
`;

// ── Runtime JS (Mode A nav + table sort/filter/export + page nav) ────
const RUNTIME_JS = `(function(){
  var pages=Array.from(document.querySelectorAll('.folio-page'));
  var navItems=Array.from(document.querySelectorAll('.nav-item,.nav-dot,.nav-tab'));
  function setActive(id){
    pages.forEach(function(p){p.classList.toggle('active',p.dataset.pageId===id)});
    navItems.forEach(function(n){n.classList.toggle('active',n.dataset.page===id)});
  }
  function goto(id){setActive(id)}
  function next(){
    var cur=pages.findIndex(function(p){return p.classList.contains('active')});
    var nxt=pages[(cur+1)%pages.length];
    if(nxt)goto(nxt.dataset.pageId||'');
  }
  function prev(){
    var cur=pages.findIndex(function(p){return p.classList.contains('active')});
    var prv=pages[(cur-1+pages.length)%pages.length];
    if(prv)goto(prv.dataset.pageId||'');
  }
  document.querySelectorAll('[data-on-click]').forEach(function(el){
    el.addEventListener('click',function(){
      var action=el.dataset.onClick||'';
      if(action==='next_page')next();
      else if(action==='prev_page')prev();
      else if(action.startsWith('goto_page:')){goto(action.split(':')[1]||'');}
      else if(action.startsWith('open_url:')){window.open(action.split(':').slice(1).join(':'),'_blank');}
    });
  });

  // ── Table runtime ──
  function fmtCell(v, formatter){
    if(v==null)return '';
    if(formatter==='currency'){var n=Number(v);return isFinite(n)?n.toLocaleString(undefined,{style:'currency',currency:'USD'}):String(v);}
    if(formatter==='number'){var n2=Number(v);return isFinite(n2)?n2.toLocaleString():String(v);}
    if(formatter==='percent'){var n3=Number(v);return isFinite(n3)?n3.toFixed(1)+'%':String(v);}
    if(formatter==='badge'){return '<span class="badge">'+escHtmlJs(String(v))+'</span>';}
    if(formatter==='delta'){var n4=Number(v);if(!isFinite(n4))return String(v);var sign=n4>0?'▲':n4<0?'▼':'';var col=n4>0?'var(--ic-pos)':n4<0?'var(--ic-neg)':'var(--ic-muted)';return '<span style="color:'+col+'">'+sign+' '+Math.abs(n4).toFixed(1)+'%</span>';}
    return escHtmlJs(String(v));
  }
  function escHtmlJs(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function renderTable(id){
    var t=window.__folioTables&&window.__folioTables[id];if(!t)return;
    var root=document.getElementById(id);if(!root)return;
    var thead=root.querySelector('thead'),tbody=root.querySelector('tbody');
    var rows=t.rows.slice();
    if(t.filter){var ql=t.filter.toLowerCase();rows=rows.filter(function(r){return Object.values(r).some(function(v){return String(v==null?'':v).toLowerCase().indexOf(ql)>=0;});});}
    if(t.sort){var k=t.sort.field,dir=t.sort.dir;rows.sort(function(a,b){var av=a[k],bv=b[k];if(av==bv)return 0;if(av==null)return 1;if(bv==null)return -1;var na=Number(av),nb=Number(bv);if(!isNaN(na)&&!isNaN(nb)){return dir==='asc'?na-nb:nb-na;}return dir==='asc'?String(av).localeCompare(String(bv)):String(bv).localeCompare(String(av));});}
    var totalPages=Math.max(1,Math.ceil(rows.length/t.pageSize));
    if(t.page>=totalPages)t.page=totalPages-1;
    var start=t.page*t.pageSize,pageRows=rows.slice(start,start+t.pageSize);
    thead.innerHTML='<tr>'+t.columns.map(function(c){var s=t.sort&&t.sort.field===c.field?t.sort.dir:'';return '<th data-field="'+c.field+'"'+(s?' data-sort="'+s+'"':'')+(c.align?' style="text-align:'+c.align+'"':'')+'>'+escHtmlJs(c.title)+'</th>';}).join('')+'</tr>';
    tbody.innerHTML=pageRows.map(function(r){return '<tr>'+t.columns.map(function(c){return '<td'+(c.align?' style="text-align:'+c.align+'"':'')+'>'+fmtCell(r[c.field],c.formatter)+'</td>';}).join('')+'</tr>';}).join('');
    Array.from(thead.querySelectorAll('th')).forEach(function(th){
      var col=t.columns.find(function(c){return c.field===th.dataset.field;});
      if(!col||col.sortable===false)return;
      th.addEventListener('click',function(){var dir=t.sort&&t.sort.field===col.field&&t.sort.dir==='asc'?'desc':'asc';t.sort={field:col.field,dir:dir};renderTable(id);});
    });
    var pager=root.querySelector('.ic-table-pager');
    if(pager){pager.innerHTML='<button '+(t.page===0?'disabled':'')+' data-act="prev">‹ Prev</button><span>Page '+(t.page+1)+' of '+totalPages+' · '+rows.length+' rows</span><button '+(t.page>=totalPages-1?'disabled':'')+' data-act="next">Next ›</button>';
      pager.querySelectorAll('button').forEach(function(b){b.addEventListener('click',function(){if(b.dataset.act==='prev'&&t.page>0)t.page--;else if(b.dataset.act==='next'&&t.page<totalPages-1)t.page++;renderTable(id);});});
    }
  }
  if(window.__folioTables){
    Object.keys(window.__folioTables).forEach(function(id){renderTable(id);});
    document.querySelectorAll('.ic-table-filter').forEach(function(input){
      var id=input.dataset.target;input.addEventListener('input',function(){var t=window.__folioTables[id];if(!t)return;t.filter=input.value;t.page=0;renderTable(id);});
    });
    document.querySelectorAll('.ic-table-export').forEach(function(btn){
      btn.addEventListener('click',function(){
        var id=btn.dataset.target;var t=window.__folioTables[id];if(!t)return;
        var headers=t.columns.map(function(c){return JSON.stringify(c.title||c.field);}).join(',');
        var rows=t.rows.map(function(r){return t.columns.map(function(c){var v=r[c.field];return JSON.stringify(v==null?'':String(v));}).join(',');}).join('\\n');
        var csv=headers+'\\n'+rows;
        var blob=new Blob([csv],{type:'text/csv;charset=utf-8;'});
        var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=id+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
      });
    });
  }

  window.Folio={nav:{goto:goto,next:next,prev:prev}};
  if(pages.length>0&&!pages.some(function(p){return p.classList.contains('active');})){
    goto(pages[0].dataset.pageId||'');
  }
})();`;

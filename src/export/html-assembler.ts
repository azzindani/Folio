import type { DesignSpec, Page } from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';
import { bindLayers } from '../report/binder';
import { renderNavigation } from '../report/navigation';
import { renderToSVGString } from '../mcp/engine/svg-export';

export interface AssembleOptions {
  title?: string;
  theme?: 'light' | 'dark';
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

  const nav = report?.navigation
    ? renderNavigation(report.navigation, pages)
    : '';

  const sections = pages.map((page, i) =>
    renderPageSection(spec, page, i, datasets),
  ).join('\n');

  const layoutClass = report?.layout === 'scroll'
    ? 'layout-scroll'
    : report?.layout === 'tabs'
    ? 'layout-tabs'
    : 'layout-paged';

  return `<!DOCTYPE html>
<html lang="en" data-theme="${isDark ? 'dark' : 'light'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${escHtml(title)}</title>
  <style>${REPORT_CSS}</style>
</head>
<body class="${layoutClass}">
${nav}
<main class="folio-report" id="folio-report">${sections}</main>
<script type="application/json" id="folio-design">${JSON.stringify({ meta: spec.meta, pageCount: pages.length, pageIds: pages.map(p => p.id) })}</script>
<script>${RUNTIME_JS}</script>
</body>
</html>`;
}

function renderPageSection(
  spec: DesignSpec,
  page: Page,
  index: number,
  datasets: Map<string, LoadedDataset>,
): string {
  const boundLayers = bindLayers(page.layers ?? [], datasets);
  const boundPage: Page = { ...page, layers: boundLayers };
  const boundSpec: DesignSpec = {
    ...spec,
    pages: undefined,
    layers: boundPage.layers,
  };
  let svg = '';
  try {
    svg = renderToSVGString(boundSpec);
  } catch {
    svg = `<p style="color:red">Page render error: ${escHtml(page.id)}</p>`;
  }
  const active = index === 0 ? ' active' : '';
  return `<section class="folio-page${active}" data-page-id="${escHtml(page.id)}" data-page-index="${index}">${svg}</section>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Inline CSS (minified for bundle size) ──────────────────
const REPORT_CSS = `
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;font-family:system-ui,sans-serif}
body{display:flex;flex-direction:column;background:#111;color:#eee}
body[data-theme=light]{background:#f5f5f5;color:#111}
.folio-sidebar{position:fixed;left:0;top:0;bottom:0;overflow-y:auto;padding:1rem 0;z-index:10}
.folio-sidebar .nav-list{list-style:none}
.folio-sidebar .nav-item{padding:.6rem 1.2rem;cursor:pointer;white-space:nowrap}
.folio-sidebar .nav-item:hover{opacity:.8}
.folio-sidebar .nav-item.active{font-weight:700;border-left:3px solid currentColor}
.folio-topbar{width:100%;padding:.5rem 1rem}
.folio-topbar .nav-list{list-style:none;display:flex;gap:1rem}
.folio-topbar .nav-item{cursor:pointer;padding:.4rem .8rem}
.folio-tabs .nav-tab{cursor:pointer;padding:.5rem 1rem;border:none;background:none;color:inherit}
.folio-dots{display:flex;gap:.5rem;justify-content:center;padding:.5rem}
.nav-dot{width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.3);cursor:pointer}
.nav-dot.active{background:#fff}
#folio-report{flex:1;overflow:auto}
.layout-paged .folio-page{display:none}
.layout-paged .folio-page.active{display:block}
.layout-scroll .folio-page{display:block;margin-bottom:2rem}
.layout-tabs .folio-page{display:none}
.layout-tabs .folio-page.active{display:block}
.folio-page svg{max-width:100%;height:auto}
`;

// ── Inline Runtime JS (Mode A navigation + interaction) ────
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
  // Mode A: wire interaction elements
  document.querySelectorAll('[data-on-click]').forEach(function(el){
    el.addEventListener('click',function(){
      var action=el.dataset.onClick||'';
      if(action==='next_page')next();
      else if(action==='prev_page')prev();
      else if(action.startsWith('goto_page:')){goto(action.split(':')[1]||'');}
      else if(action.startsWith('open_url:')){window.open(action.split(':').slice(1).join(':'),'_blank');}
    });
  });
  window.Folio={nav:{goto:goto,next:next,prev:prev}};
  if(pages.length>0&&!pages.some(function(p){return p.classList.contains('active');})){
    goto(pages[0].dataset.pageId||'');
  }
})();`;

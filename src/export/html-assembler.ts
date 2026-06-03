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
  const isFlow = report?.layout === 'flow' || report?.flow === true;

  const ctx: InteractiveRenderContext = {
    datasets,
    pageId: '',
    pageWidth: spec.document?.width ?? 1080,
    pageHeight: spec.document?.height ?? 1080,
    isDark,
    flow: isFlow,
    accent: report?.accent,
    chartInits: [],
    tableInits: [],
    fontFamilies: new Set(),
    needsChartJs: !!opts.forceChartJs,
  };

  // Seed editorial fonts so they reach the Google Fonts <link>.
  if (report?.font_heading) ctx.fontFamilies.add(report.font_heading);
  if (report?.font_body) ctx.fontFamilies.add(report.font_body);

  const nav = report?.navigation
    ? renderNavigation(report.navigation, pages)
    : '';

  const sections = pages.map((page, i) =>
    renderPageSection(spec, page, i, datasets, ctx),
  ).join('\n');

  const layoutClass = isFlow
    ? 'layout-flow'
    : report?.layout === 'scroll'
    ? 'layout-scroll'
    : report?.layout === 'tabs'
    ? 'layout-tabs'
    : 'layout-paged';

  const rootVars = [
    `--folio-maxw:${report?.max_width ?? 1200}px`,
    report?.accent ? `--ic-accent:${report.accent}` : '',
    report?.font_heading ? `--folio-font-head:'${report.font_heading}',Georgia,serif` : '',
    report?.font_body ? `--folio-font-body:'${report.font_body}',system-ui,sans-serif` : '',
  ].filter(Boolean).join(';');

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

  // tableInits + chartInits just POPULATE the registries (window.__folioTables /
  // window.__folioCharts). RUNTIME_JS builds + wires them (charts gated on Chart.js).
  const initScripts = [...ctx.tableInits, ...ctx.chartInits].join('\n');

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
<body class="${layoutClass}" data-theme="${isDark ? 'dark' : 'light'}"${rootVars ? ` style="${rootVars}"` : ''}>
${nav}
<main class="folio-report" id="folio-report">${isFlow ? `<div class="folio-flow">${sections}</div>` : sections}</main>
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

  // Flow mode: responsive 12-col grid, layers in document order, no fixed canvas.
  if (ctx.flow) {
    const cells = boundLayers.map(l =>
      isInteractiveLayer(l)
        ? renderInteractiveLayer(l, ctx)
        : `<div class="folio-flow-svg" style="grid-column:span 12">${safeRenderSvg(spec, [l], page.id)}</div>`,
    ).join('\n');
    return `<section class="folio-page${active}" data-page-id="${escHtml(page.id)}" data-page-index="${index}">
      <div class="folio-flow-grid">${cells}</div>
    </section>`;
  }

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
html,body{min-height:100%;font-family:var(--folio-font-body,system-ui,-apple-system,sans-serif)}
body{background:#0b0d12;color:#e8e8ec;
  --folio-maxw:1200px;
  --ic-pos:#22c55e;--ic-neg:#ef4444;--ic-muted:#94a3b8;
  --ic-surface:#161821;--ic-surface2:#1c1f2b;--ic-border:rgba(255,255,255,.08);--ic-accent:#60a5fa}
body[data-theme=light]{background:#f7f7fa;color:#1a1a1a;
  --ic-surface:#ffffff;--ic-surface2:#f0f1f5;--ic-border:rgba(0,0,0,.10);--ic-accent:#2563eb}
/* Paged & tabs lock to the viewport (one screen at a time); scroll & flow grow the document. */
body.layout-paged,body.layout-tabs{height:100%;display:flex;flex-direction:column}
body.layout-paged #folio-report,body.layout-tabs #folio-report{flex:1;overflow:auto}
body.layout-scroll,body.layout-flow{height:auto;display:block}
body.layout-scroll #folio-report,body.layout-flow #folio-report{overflow:visible}
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
#folio-report{padding:1rem}
.layout-flow #folio-report{padding:0}
.layout-paged .folio-page{display:none}
.layout-paged .folio-page.active{display:block}
.layout-scroll .folio-page{display:block;margin-bottom:2rem}
.layout-tabs .folio-page{display:none}
.layout-tabs .folio-page.active{display:block}
.folio-page-stage svg{position:absolute;top:0;left:0;max-width:100%;height:auto}
.folio-page svg:not([class]){max-width:100%;height:auto}

/* ── Flow layout: responsive editorial document ── */
.folio-flow{max-width:var(--folio-maxw,1200px);margin:0 auto;padding:56px 28px 80px}
.layout-flow .folio-page{display:block}
.layout-flow .folio-page+.folio-page{margin-top:8px}
.folio-flow-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:22px;align-items:stretch}
.folio-flow-grid>*{min-width:0}
.folio-flow-svg svg{max-width:100%;height:auto;display:block}
/* Flow headings (rich_text spanning full width) read as section rhythm. */
.layout-flow .ic-richtext{align-self:center}
.layout-flow .ic-richtext h1,.layout-flow .ic-richtext h2{font-family:var(--folio-font-head,inherit)}
@media (max-width:900px){
  .folio-flow{padding:36px 18px 60px}
  .folio-flow-grid>*{grid-column:1/-1 !important}
}
@media (min-width:901px) and (max-width:1180px){
  /* tighten to a coarse grid so 3-col KPI rows wrap cleanly on mid widths */
  .folio-flow-grid{grid-template-columns:repeat(6,1fr)}
  .folio-flow-grid>.ic-kpi{grid-column:span 2 !important}
}
/* Editorial polish (flat, no glow): larger tabular numerals, quiet hover-accent. */
.layout-flow .ic-kpi-value{font-size:30px;font-variant-numeric:tabular-nums}
.layout-flow .ic-kpi,.layout-flow .ic-chart,.layout-flow .ic-table{transition:border-color .15s ease}
.layout-flow .ic-kpi:hover,.layout-flow .ic-chart:hover,.layout-flow .ic-table:hover{border-color:var(--ic-accent)}
.layout-flow .ic-table thead th{background:var(--ic-surface2)}

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

/* ── Controls: button / segmented / chips ── */
.ic-ctl{display:flex;align-items:center;gap:10px}
.ic-ctl-label{font-size:12px;color:var(--ic-muted);font-weight:600}
.ic-btn{display:inline-flex;align-items:center;gap:7px;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--ic-accent);border-radius:8px;padding:9px 16px;background:var(--ic-accent);color:#0b0d12;transition:filter .15s,background .15s,color .15s;line-height:1}
.ic-btn:hover{filter:brightness(1.08)}
.ic-btn-outline{background:transparent;color:var(--ic-accent)}
.ic-btn-ghost{background:transparent;border-color:transparent;color:inherit}
.ic-btn-ghost:hover{background:var(--ic-surface2)}
.ic-btn-link{background:transparent;border-color:transparent;color:var(--ic-accent);padding:6px 4px;text-decoration:underline}
.ic-btn-sm{padding:6px 12px;font-size:12px}
.ic-btn-lg{padding:12px 22px;font-size:15px}
.ic-btn-ic{font-size:1.05em}
.ic-seg{display:inline-flex;background:var(--ic-surface2);border:1px solid var(--ic-border);border-radius:9px;padding:3px;gap:2px}
.ic-seg-opt{font:inherit;cursor:pointer;border:none;background:transparent;color:var(--ic-muted);padding:6px 14px;border-radius:6px;font-weight:600;transition:background .15s,color .15s}
.ic-seg-opt.active{background:var(--ic-accent);color:#0b0d12}
.ic-chips{display:flex;flex-wrap:wrap;gap:8px}
.ic-filter{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.ic-filter-label{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--ic-muted);font-weight:700}
.ic-chip{font:inherit;font-size:13px;cursor:pointer;border:1px solid var(--ic-border);border-radius:999px;padding:6px 14px;background:var(--ic-surface);color:inherit;transition:all .15s}
.ic-chip:hover{border-color:var(--ic-accent)}
.ic-chip.active{background:var(--ic-accent);border-color:var(--ic-accent);color:#0b0d12;font-weight:600}
.ic-filter-select{font:inherit;padding:8px 12px;border:1px solid var(--ic-border);border-radius:8px;background:var(--ic-surface);color:inherit;min-width:160px}

/* ── Callout ── */
.ic-callout{display:flex;gap:12px;padding:14px 16px;border-radius:10px;border:1px solid var(--ic-border);border-left-width:4px;background:var(--ic-surface)}
.ic-callout-ic{font-size:18px;line-height:1.4;flex:none}
.ic-callout-title{font-weight:700;margin-bottom:3px}
.ic-callout-body{min-width:0}
.ic-callout-info{border-left-color:var(--ic-accent)}.ic-callout-info .ic-callout-ic{color:var(--ic-accent)}
.ic-callout-success{border-left-color:var(--ic-pos)}.ic-callout-success .ic-callout-ic{color:var(--ic-pos)}
.ic-callout-warning{border-left-color:#f5a623}.ic-callout-warning .ic-callout-ic{color:#f5a623}
.ic-callout-danger{border-left-color:var(--ic-neg)}.ic-callout-danger .ic-callout-ic{color:var(--ic-neg)}
.ic-callout-neutral{border-left-color:var(--ic-muted)}.ic-callout-neutral .ic-callout-ic{color:var(--ic-muted)}

/* ── Progress / gauge ── */
.ic-prog{display:flex;flex-direction:column;gap:7px;justify-content:center}
.ic-prog-label{display:flex;justify-content:space-between;font-size:12px;color:var(--ic-muted);font-weight:600}
.ic-prog-val{color:inherit}
.ic-prog-track-bar{height:9px;border-radius:999px;background:var(--ic-surface2);overflow:hidden}
.ic-prog-fill{height:100%;border-radius:999px;transition:width .5s ease}
.ic-prog-radial{align-items:center;text-align:center;position:relative}
.ic-prog-radial svg{width:96px;height:96px;transform:rotate(-90deg)}
.ic-prog-track{fill:none;stroke:var(--ic-surface2);stroke-width:8}
.ic-prog-arc{fill:none;stroke-width:8;stroke-linecap:round;transition:stroke-dashoffset .6s ease}
.ic-prog-center{position:absolute;top:50%;left:50%;transform:translate(-50%,-60%);font-weight:700;font-size:18px}
.ic-prog-rlabel{font-size:12px;color:var(--ic-muted);margin-top:2px}

/* ── Tooltip / popover ── */
.ic-tip{position:relative;display:inline-flex;align-items:center;cursor:help}
.ic-tip-trigger{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;border-radius:999px;background:var(--ic-surface2);color:var(--ic-muted);font-size:12px;font-weight:700;padding:0 6px}
.ic-tip-pop{position:absolute;z-index:50;bottom:130%;left:50%;transform:translateX(-50%) translateY(4px);background:#0b0d12;color:#e8e8ec;border:1px solid var(--ic-border);border-radius:8px;padding:10px 12px;width:240px;font-size:12.5px;line-height:1.5;opacity:0;visibility:hidden;transition:opacity .15s,transform .15s;box-shadow:0 8px 24px rgba(0,0,0,.4)}
.ic-tip:hover .ic-tip-pop,.ic-tip:focus .ic-tip-pop{opacity:1;visibility:visible;transform:translateX(-50%) translateY(0)}
.ic-tip[data-placement=bottom] .ic-tip-pop{bottom:auto;top:130%}

/* ── Tabs ── */
.ic-tabs{display:flex;flex-direction:column;gap:16px}
.ic-tab-bar{display:flex;gap:4px;border-bottom:1px solid var(--ic-border)}
.ic-tab-align-center{justify-content:center}.ic-tab-align-right{justify-content:flex-end}
.ic-tab-align-stretch .ic-tab{flex:1}
.ic-tab{font:inherit;font-weight:600;cursor:pointer;border:none;background:none;color:var(--ic-muted);padding:10px 16px;border-bottom:2px solid transparent;margin-bottom:-1px;transition:color .15s,border-color .15s;display:inline-flex;align-items:center;gap:7px}
.ic-tab:hover{color:inherit}
.ic-tab.active{color:var(--ic-accent);border-bottom-color:var(--ic-accent)}
.ic-tabs-pills .ic-tab-bar{border-bottom:none;gap:8px}
.ic-tabs-pills .ic-tab{border-radius:999px;border:1px solid var(--ic-border);margin-bottom:0}
.ic-tabs-pills .ic-tab.active{background:var(--ic-accent);color:#0b0d12;border-color:var(--ic-accent)}
.ic-tab-panel{display:none}.ic-tab-panel.active{display:block}

/* ── Accordion ── */
.ic-accordion{display:flex;flex-direction:column;gap:10px}
.ic-acc-item{border:1px solid var(--ic-border);border-radius:10px;overflow:hidden;background:var(--ic-surface)}
.ic-acc-head{width:100%;text-align:left;font:inherit;font-weight:600;font-size:15px;cursor:pointer;background:none;border:none;color:inherit;padding:14px 18px;display:flex;justify-content:space-between;align-items:center;gap:12px}
.ic-acc-chev{transition:transform .2s;color:var(--ic-muted)}
.ic-acc-item.open .ic-acc-chev{transform:rotate(180deg)}
.ic-acc-panel{display:grid;grid-template-rows:0fr;transition:grid-template-rows .25s ease}
.ic-acc-item.open .ic-acc-panel{grid-template-rows:1fr}
.ic-acc-inner{overflow:hidden}
.ic-acc-item.open .ic-acc-inner{padding:0 18px 16px}

/* ── Modal / popup ── */
body.ic-modal-lock{overflow:hidden}
.ic-modal{display:none;position:fixed;inset:0;z-index:1000;align-items:center;justify-content:center;padding:24px}
.ic-modal.open{display:flex}
.ic-modal-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(2px)}
.ic-modal-dialog{position:relative;z-index:1;background:var(--ic-surface);border:1px solid var(--ic-border);border-radius:14px;max-width:720px;width:100%;max-height:85vh;overflow:auto;box-shadow:0 24px 64px rgba(0,0,0,.5);animation:icModalIn .2s ease}
@keyframes icModalIn{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
.ic-modal-head{display:flex;justify-content:space-between;align-items:center;padding:18px 22px;border-bottom:1px solid var(--ic-border)}
.ic-modal-title{font-size:18px;font-weight:700;font-family:var(--folio-font-head,inherit)}
.ic-modal-close{font:inherit;font-size:22px;line-height:1;cursor:pointer;background:none;border:none;color:var(--ic-muted);padding:0 4px}
.ic-modal-close:hover{color:inherit}
.ic-modal-close-float{position:absolute;top:12px;right:14px;z-index:2}
.ic-modal-body{padding:22px}
`;

// ── Runtime JS (Mode A nav + table sort/filter/export + page nav) ────
const RUNTIME_JS = `(function(){
  var pages=Array.from(document.querySelectorAll('.folio-page'));
  var navItems=Array.from(document.querySelectorAll('.nav-item,.nav-dot,.nav-tab'));

  // ── Shared interactivity: state store + event bus + cross-component filters ──
  var Folio={nav:{},state:{},events:{},filters:{}};
  var _state={},_subs=[],_ev={};
  Folio.state.get=function(k){return _state[k];};
  Folio.state.set=function(k,v){_state[k]=v;_subs.forEach(function(f){f(k,v);});reactState();Folio.events.emit('state:change',{key:k,value:v});};
  Folio.state.subscribe=function(f){_subs.push(f);};
  Folio.state.all=function(){return _state;};
  Folio.events.on=function(n,f){(_ev[n]=_ev[n]||[]).push(f);};
  Folio.events.emit=function(n,p){(_ev[n]||[]).forEach(function(f){try{f(p);}catch(e){}});};
  // A row passes when, for every filtered field, its value is in the selected set.
  Folio.applyFilters=function(rows){
    var f=Folio.filters,keys=Object.keys(f).filter(function(k){return f[k]&&f[k].length;});
    if(!keys.length)return rows;
    return rows.filter(function(r){return keys.every(function(k){return f[k].indexOf(String(r[k]))>=0;});});
  };
  function reactState(){
    document.querySelectorAll('[data-show-if]').forEach(function(el){
      try{var fn=new Function('state','return ('+el.getAttribute('data-show-if')+')');el.style.display=fn(_state)?'':'none';}catch(e){}
    });
    document.querySelectorAll('[data-seg-group]').forEach(function(el){
      var g=el.getAttribute('data-seg-group');el.classList.toggle('active',String(_state[g])===el.getAttribute('data-seg-value'));
    });
  }
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
    var rows=Folio.applyFilters(t.rows).slice();
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
  Folio.renderTables=function(){if(window.__folioTables)Object.keys(window.__folioTables).forEach(function(id){renderTable(id);});};
  function exportCsv(id){var t=window.__folioTables&&window.__folioTables[id];if(!t)return;
    var headers=t.columns.map(function(c){return JSON.stringify(c.title||c.field);}).join(',');
    var rows=t.rows.map(function(r){return t.columns.map(function(c){var v=r[c.field];return JSON.stringify(v==null?'':String(v));}).join(',');}).join('\\n');
    var blob=new Blob([headers+'\\n'+rows],{type:'text/csv;charset=utf-8;'});
    var url=URL.createObjectURL(blob);var a=document.createElement('a');a.href=url;a.download=id+'.csv';document.body.appendChild(a);a.click();document.body.removeChild(a);URL.revokeObjectURL(url);
  }
  if(window.__folioTables){
    Folio.renderTables();
    document.querySelectorAll('.ic-table-filter').forEach(function(input){
      var id=input.dataset.target;input.addEventListener('input',function(){var t=window.__folioTables[id];if(!t)return;t.filter=input.value;t.page=0;renderTable(id);});
    });
    document.querySelectorAll('.ic-table-export').forEach(function(btn){
      btn.addEventListener('click',function(){exportCsv(btn.dataset.target);});
    });
  }

  // ── Charts: build from registry (applying active filters), update on filter change ──
  function chartData(c){var rows=Folio.applyFilters(c.rows);return {labels:rows.map(function(r){return r[c.x];}),data:rows.map(function(r){return Number(r[c.y]||0);})};}
  function buildCharts(){
    if(!window.Chart||!window.__folioCharts)return;
    Object.keys(window.__folioCharts).forEach(function(id){
      var c=window.__folioCharts[id];var el=document.getElementById(id);if(!el||c.inst)return;
      var d=chartData(c);c.cfg.data.labels=d.labels;c.cfg.data.datasets[0].data=d.data;
      try{c.inst=new window.Chart(el.getContext('2d'),c.cfg);}catch(e){}
    });
  }
  Folio.updateCharts=function(){if(!window.__folioCharts)return;Object.keys(window.__folioCharts).forEach(function(id){var c=window.__folioCharts[id];if(!c.inst)return;var d=chartData(c);c.inst.data.labels=d.labels;c.inst.data.datasets[0].data=d.data;c.inst.update();});};
  if(window.Chart){buildCharts();}else{var _ct=setInterval(function(){if(window.Chart){clearInterval(_ct);buildCharts();}},50);setTimeout(function(){clearInterval(_ct);},8000);}

  // ── Generic action dispatcher (buttons, chips, tabs, accordions, modals) ──
  function openModal(id){var m=document.getElementById(id);if(!m)return;m.classList.add('open');m.setAttribute('aria-hidden','false');document.body.classList.add('ic-modal-lock');if(window.__folioCharts){setTimeout(function(){Object.keys(window.__folioCharts).forEach(function(k){var c=window.__folioCharts[k];if(c.inst&&c.inst.resize)c.inst.resize();});},20);}}
  function closeModal(id){var m=id?document.getElementById(id):document.querySelector('.ic-modal.open');if(!m)return;m.classList.remove('open');m.setAttribute('aria-hidden','true');if(!document.querySelector('.ic-modal.open'))document.body.classList.remove('ic-modal-lock');}
  function switchTab(group,tid){
    document.querySelectorAll('[data-tab-group="'+group+'"]').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab-id')===tid);});
    document.querySelectorAll('[data-tab-panel="'+group+'"]').forEach(function(p){p.classList.toggle('active',p.getAttribute('data-tab-id')===tid);});
    // Charts inside a previously-hidden panel render at 0×0; nudge Chart.js to resize.
    if(window.__folioCharts){setTimeout(function(){Object.keys(window.__folioCharts).forEach(function(id){var c=window.__folioCharts[id];if(c.inst&&c.inst.resize)c.inst.resize();});},20);}
  }
  function toggleAccordion(id){var it=document.getElementById(id);if(!it)return;var willOpen=!it.classList.contains('open');var g=it.getAttribute('data-acc-group');
    if(g&&willOpen){document.querySelectorAll('[data-acc-group="'+g+'"]').forEach(function(o){if(o!==it)o.classList.remove('open');});}
    it.classList.toggle('open',willOpen);}
  function setFilter(field,value,multi){
    if(value==='__all__'){Folio.filters[field]=[];}
    else if(multi){var cur=Folio.filters[field]||[];var i=cur.indexOf(value);if(i>=0)cur.splice(i,1);else cur.push(value);Folio.filters[field]=cur;}
    else{Folio.filters[field]=(Folio.filters[field]&&Folio.filters[field][0]===value)?[]:[value];}
    // reflect chip active states
    document.querySelectorAll('[data-filter-field="'+field+'"]').forEach(function(ch){var v=ch.getAttribute('data-filter-value');if(v==null)return;
      if(v==='__all__')ch.classList.toggle('active',!(Folio.filters[field]&&Folio.filters[field].length));
      else ch.classList.toggle('active',(Folio.filters[field]||[]).indexOf(v)>=0);});
    if(window.__folioTables)Object.keys(window.__folioTables).forEach(function(id){window.__folioTables[id].page=0;});
    Folio.renderTables();Folio.updateCharts();Folio.events.emit('filter:change',{field:field});
  }
  function dispatch(action){
    if(!action)return;var c=action.indexOf(':');var verb=c<0?action:action.slice(0,c);var rest=c<0?'':action.slice(c+1);
    if(verb==='open_modal')openModal(rest);
    else if(verb==='close_modal')closeModal(rest);
    else if(verb==='toggle')Folio.state.set(rest,!Folio.state.get(rest));
    else if(verb==='set'){var eq=rest.indexOf('=');var k=eq<0?rest:rest.slice(0,eq);var v=eq<0?true:rest.slice(eq+1);Folio.state.set(k,v);}
    else if(verb==='filter'){var p=rest.split(':');var ch=document.querySelector('[data-filter-field="'+p[0]+'"][data-filter-value="'+p.slice(1).join(':')+'"]');setFilter(p[0],p.slice(1).join(':'),ch&&ch.hasAttribute('data-multi'));}
    else if(verb==='tab'){var t=rest.split(':');switchTab(t[0],t.slice(1).join(':'));}
    else if(verb==='accordion')toggleAccordion(rest);
    else if(verb==='scroll_to'){var el=document.getElementById(rest);if(el)el.scrollIntoView({behavior:'smooth',block:'start'});}
    else if(verb==='download_csv')exportCsv(rest);
    else if(verb==='next_page')next();
    else if(verb==='prev_page')prev();
    else if(verb==='goto_page')goto(rest);
    else if(verb==='open_url')window.open(rest,'_blank');
  }
  document.addEventListener('click',function(e){
    var el=e.target.closest&&e.target.closest('[data-folio-action]');
    if(el){e.preventDefault();dispatch(el.getAttribute('data-folio-action'));}
  });
  document.querySelectorAll('.ic-filter-select').forEach(function(sel){
    sel.addEventListener('change',function(){var field=sel.getAttribute('data-filter-field');
      if(sel.multiple){Folio.filters[field]=Array.from(sel.selectedOptions).map(function(o){return o.value;}).filter(function(v){return v!=='__all__';});}
      else{Folio.filters[field]=sel.value==='__all__'?[]:[sel.value];}
      if(window.__folioTables)Object.keys(window.__folioTables).forEach(function(id){window.__folioTables[id].page=0;});
      Folio.renderTables();Folio.updateCharts();});
  });
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeModal();});

  Folio.nav={goto:goto,next:next,prev:prev};Folio.openModal=openModal;Folio.closeModal=closeModal;window.Folio=Folio;
  reactState();
  if(pages.length>0&&!pages.some(function(p){return p.classList.contains('active');})){
    goto(pages[0].dataset.pageId||'');
  }
})();`;

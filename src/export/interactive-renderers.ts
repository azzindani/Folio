import type {
  Layer,
  InteractiveChartLayer,
  InteractiveTableLayer,
  KpiCardLayer,
  RichTextLayer,
  ButtonLayer,
  TabsLayer,
  AccordionLayer,
  FilterBarLayer,
  ToggleLayer,
  TooltipLayer,
  CalloutLayer,
  ProgressLayer,
  PopupLayer,
  ControlAction,
  FilterOption,
} from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';

export interface InteractiveRenderContext {
  datasets: Map<string, LoadedDataset>;
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  isDark: boolean;
  /** Flow mode: layers placed in a responsive 12-col grid (no absolute coords). */
  flow: boolean;
  /** Report accent color — seeds chart/sparkline defaults so visuals are coordinated. */
  accent?: string;
  // Output channels populated as a side-effect:
  chartInits: string[];      // Chart.js init scripts
  tableInits: string[];      // Table init scripts
  fontFamilies: Set<string>; // Google Fonts to inject
  needsChartJs: boolean;
}

/** Default 12-col grid span per layer type in flow reports. */
function defaultSpan(type: Layer['type']): number {
  switch (type) {
    case 'kpi_card': return 3;
    case 'interactive_chart': return 6;
    case 'button': return 3;
    case 'toggle': return 4;
    case 'tooltip': return 2;
    case 'progress': return 4;
    default: return 12; // tables, rich_text, embed_code, tabs, accordion, filter_bar, callout, popup
  }
}

const INTERACTIVE_LAYER_TYPES = new Set<Layer['type']>([
  'interactive_chart',
  'interactive_table',
  'kpi_card',
  'rich_text',
  'embed_code',
  'popup',
  'button',
  'tabs',
  'accordion',
  'filter_bar',
  'toggle',
  'tooltip',
  'callout',
  'progress',
]);

export function isInteractiveLayer(layer: Layer): boolean {
  return INTERACTIVE_LAYER_TYPES.has(layer.type);
}

export function pageHasInteractiveLayers(layers: Layer[] | undefined): boolean {
  if (!layers) return false;
  return layers.some(l => isInteractiveLayer(l) || pageHasInteractiveLayers((l as { layers?: Layer[] }).layers));
}

export function collectInteractiveLayers(layers: Layer[] | undefined): Layer[] {
  if (!layers) return [];
  const out: Layer[] = [];
  for (const l of layers) {
    if (isInteractiveLayer(l)) out.push(l);
    const sub = (l as { layers?: Layer[] }).layers;
    if (sub) out.push(...collectInteractiveLayers(sub));
  }
  return out;
}

export function renderInteractiveLayer(layer: Layer, ctx: InteractiveRenderContext): string {
  switch (layer.type) {
    case 'interactive_chart': return renderChart(layer as InteractiveChartLayer, ctx);
    case 'interactive_table': return renderTable(layer as InteractiveTableLayer, ctx);
    case 'kpi_card':          return renderKpi(layer as KpiCardLayer, ctx);
    case 'rich_text':         return renderRichText(layer as RichTextLayer, ctx);
    case 'embed_code':        return renderEmbed(layer as Layer & { html: string }, ctx);
    case 'button':            return renderButton(layer as ButtonLayer, ctx);
    case 'tabs':              return renderTabs(layer as TabsLayer, ctx);
    case 'accordion':         return renderAccordion(layer as AccordionLayer, ctx);
    case 'popup':             return renderModal(layer as PopupLayer, ctx);
    case 'filter_bar':        return renderFilterBar(layer as FilterBarLayer, ctx);
    case 'toggle':            return renderToggle(layer as ToggleLayer, ctx);
    case 'tooltip':           return renderTooltip(layer as TooltipLayer, ctx);
    case 'callout':           return renderCallout(layer as CalloutLayer, ctx);
    case 'progress':          return renderProgress(layer as ProgressLayer, ctx);
    default:                  return '';
  }
}

// ── Helpers ──────────────────────────────────────────────────

function escAttr(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function escHtml(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function layerStyle(layer: Layer, ctx: InteractiveRenderContext): string {
  // Flow mode: place by responsive grid span, let the document grow naturally.
  if (ctx.flow) {
    const span = clampSpan((layer as { span?: number }).span ?? defaultSpan(layer.type));
    return `grid-column:span ${span}`;
  }
  // Fixed-canvas mode: absolute positioning from x/y/width/height.
  const x = (layer as { x?: number }).x ?? 0;
  const y = (layer as { y?: number }).y ?? 0;
  const w = (layer as { width?: number | 'auto' }).width;
  const h = (layer as { height?: number | 'auto' }).height;
  const parts = [
    `position:absolute`,
    `left:${x}px`,
    `top:${y}px`,
  ];
  if (typeof w === 'number') parts.push(`width:${w}px`);
  if (typeof h === 'number') parts.push(`height:${h}px`);
  return parts.join(';');
}

function clampSpan(n: number): number {
  if (!isFinite(n)) return 12;
  return Math.max(1, Math.min(12, Math.round(n)));
}

function dataRows(dataRef: string, ctx: InteractiveRenderContext): Record<string, unknown>[] {
  // Accept "ds_id" or "$data.ds_id" forms
  const id = dataRef.startsWith('$data.') ? dataRef.slice(6) : dataRef;
  const ds = ctx.datasets.get(id);
  return ds?.rows ?? [];
}

function fmt(value: unknown, formatter?: string, opts?: { currency?: string; decimals?: number }): string {
  if (value == null) return '';
  switch (formatter) {
    case 'currency': {
      const cur = opts?.currency ?? 'USD';
      const dec = opts?.decimals ?? 0;
      const n = typeof value === 'number' ? value : Number(value);
      if (!isFinite(n)) return String(value);
      return n.toLocaleString(undefined, { style: 'currency', currency: cur, minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    case 'number': {
      const dec = opts?.decimals ?? 0;
      const n = typeof value === 'number' ? value : Number(value);
      if (!isFinite(n)) return String(value);
      return n.toLocaleString(undefined, { minimumFractionDigits: dec, maximumFractionDigits: dec });
    }
    case 'percent': {
      const n = typeof value === 'number' ? value : Number(value);
      if (!isFinite(n)) return String(value);
      const dec = opts?.decimals ?? 1;
      return `${n.toFixed(dec)}%`;
    }
    case 'date': {
      const d = value instanceof Date ? value : new Date(String(value));
      if (isNaN(d.getTime())) return String(value);
      return d.toLocaleDateString();
    }
    default:
      return String(value);
  }
}

// ── Chart renderer ───────────────────────────────────────────

function renderChart(layer: InteractiveChartLayer, ctx: InteractiveRenderContext): string {
  ctx.needsChartJs = true;
  const id = `chart-${layer.id}`;
  const rows = dataRows(layer.data_ref, ctx);
  const chartConfig = buildChartConfig(layer, rows, ctx.isDark, ctx.accent);
  // Register chart metadata so the runtime builds it AND re-filters it live when
  // a linked filter_bar changes Folio.filters. Storing rows + x/y lets us
  // recompute labels/data on every filter change and call chart.update().
  ctx.chartInits.push(`(window.__folioCharts=window.__folioCharts||{})[${JSON.stringify(id)}]={cfg:${JSON.stringify(chartConfig)},rows:${JSON.stringify(rows)},x:${JSON.stringify(layer.x_field ?? 'x')},y:${JSON.stringify(layer.y_field ?? 'y')}};`);

  const title = layer.title ? `<div class="ic-title">${escHtml(layer.title)}</div>` : '';
  // In flow mode a grid item has no intrinsic height; give the card a height so
  // the responsive canvas (maintainAspectRatio:false) has a box to fill.
  const flowH = ctx.flow ? `;height:${typeof layer.height === 'number' ? layer.height : 340}px` : '';
  return `<div class="ic-chart" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}${flowH}">
    ${title}
    <div class="ic-chart-canvas-wrap"><canvas id="${id}"></canvas></div>
  </div>`;
}

function buildChartConfig(
  layer: InteractiveChartLayer,
  rows: Record<string, unknown>[],
  isDark: boolean,
  accent?: string,
): unknown {
  const x = layer.x_field ?? 'x';
  const y = layer.y_field ?? 'y';
  const labels = rows.map(r => r[x]);
  const data = rows.map(r => Number(r[y] ?? 0));
  // Accent (if set) leads the palette so single-series charts match the report's color story.
  const palette = accent ? [accent, ...defaultPalette(isDark)] : defaultPalette(isDark);
  const colors = layer.custom_colors && layer.custom_colors.length > 0
    ? layer.custom_colors
    : palette;

  const grid = layer.grid !== false;
  const legend = layer.legend !== false;
  const animate = layer.animate !== false;
  const fg = isDark ? '#cbd5e1' : '#334155';
  const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';

  const baseDataset = {
    label: layer.y_label || y,
    data,
    backgroundColor: layer.chart_type === 'pie' || layer.chart_type === 'donut' ? colors : colors[0],
    borderColor: colors[0],
    borderWidth: 2,
    fill: layer.chart_type === 'area',
    tension: 0.3,
  };

  const type =
    layer.chart_type === 'donut' ? 'doughnut'
    : layer.chart_type === 'area' ? 'line'
    : layer.chart_type;

  return {
    type,
    data: { labels, datasets: [baseDataset] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: animate ? { duration: 600 } : false,
      plugins: {
        legend: { display: legend, labels: { color: fg } },
      },
      scales: ['pie', 'doughnut', 'donut'].includes(layer.chart_type) ? {} : {
        x: { ticks: { color: fg }, grid: { display: grid, color: gridColor } },
        y: { ticks: { color: fg }, grid: { display: grid, color: gridColor } },
      },
    },
  };
}

function defaultPalette(isDark: boolean): string[] {
  return isDark
    ? ['#60a5fa', '#34d399', '#f472b6', '#fbbf24', '#a78bfa', '#22d3ee', '#fb7185']
    : ['#2563eb', '#059669', '#db2777', '#d97706', '#7c3aed', '#0891b2', '#be123c'];
}

// ── Table renderer ───────────────────────────────────────────

function renderTable(layer: InteractiveTableLayer, ctx: InteractiveRenderContext): string {
  const rows = dataRows(layer.data_ref, ctx);
  const colsJson = JSON.stringify(layer.columns);
  const rowsJson = JSON.stringify(rows);
  const id = `table-${layer.id}`;

  const filterUI = layer.filterable
    ? `<input class="ic-table-filter" data-target="${id}" placeholder="Filter…" aria-label="Filter table">`
    : '';
  const exportUI = layer.exportable
    ? `<button class="ic-table-export" data-target="${id}" title="Download CSV">Export</button>`
    : '';

  ctx.tableInits.push(`window.__folioTables = window.__folioTables || {};
window.__folioTables[${JSON.stringify(id)}] = { columns: ${colsJson}, rows: ${rowsJson}, pageSize: ${layer.page_size ?? 25}, page: 0, sort: null };`);

  return `<div class="ic-table" id="${id}" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">
    ${(filterUI || exportUI) ? `<div class="ic-table-toolbar">${filterUI}${exportUI}</div>` : ''}
    <div class="ic-table-scroll"><table><thead></thead><tbody></tbody></table></div>
    ${layer.pagination ? `<div class="ic-table-pager"></div>` : ''}
  </div>`;
}

// ── KPI Card renderer ────────────────────────────────────────

function renderKpi(layer: KpiCardLayer, ctx: InteractiveRenderContext): string {
  const value = fmt(layer.value, layer.format, { currency: layer.currency, decimals: layer.decimals });
  const deltaVal = layer.delta != null ? fmt(layer.delta, layer.delta_format ?? 'percent') : '';
  const deltaSign = typeof layer.delta === 'number' ? Math.sign(layer.delta) : 0;
  const deltaColor = deltaSign > 0 ? (layer.delta_positive_color ?? 'var(--ic-pos)')
                    : deltaSign < 0 ? (layer.delta_negative_color ?? 'var(--ic-neg)')
                    : 'var(--ic-muted)';

  const sparkRows = layer.sparkline_data ? dataRows(layer.sparkline_data, ctx) : [];
  const sparkValues = layer.sparkline_field
    ? sparkRows.map(r => Number(r[layer.sparkline_field!] ?? 0))
    : [];
  const sparkSvg = sparkValues.length > 1 ? renderSparkline(sparkValues, layer.sparkline_color ?? 'currentColor') : '';

  const bg = layer.background ?? '';
  const fg = layer.text_color ?? '';
  const radius = layer.border_radius != null ? `border-radius:${layer.border_radius}px;` : '';
  const customStyle = `${bg ? `background:${bg};` : ''}${fg ? `color:${fg};` : ''}${radius}`;

  return `<div class="ic-kpi" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)};${customStyle}">
    ${layer.icon ? `<div class="ic-kpi-icon">${escHtml(layer.icon)}</div>` : ''}
    <div class="ic-kpi-label">${escHtml(layer.label)}</div>
    <div class="ic-kpi-value">${escHtml(value)}</div>
    ${deltaVal ? `<div class="ic-kpi-delta" style="color:${deltaColor}">${deltaSign > 0 ? '▲' : deltaSign < 0 ? '▼' : ''} ${escHtml(deltaVal)}</div>` : ''}
    ${sparkSvg ? `<div class="ic-kpi-spark">${sparkSvg}</div>` : ''}
  </div>`;
}

function renderSparkline(values: number[], color: string): string {
  const w = 100, h = 28;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * w;
    const y = h - ((v - min) / range) * (h - 2) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="${escAttr(color)}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}

// ── Rich Text renderer ───────────────────────────────────────

function renderRichText(layer: RichTextLayer, ctx: InteractiveRenderContext): string {
  if (layer.font_family) ctx.fontFamilies.add(layer.font_family);
  const style = [
    layerStyle(layer, ctx),
    layer.font_family ? `font-family:'${layer.font_family}',sans-serif` : '',
    layer.font_size ? `font-size:${layer.font_size}px` : '',
    layer.line_height ? `line-height:${layer.line_height}` : '',
    layer.color ? `color:${layer.color}` : '',
  ].filter(Boolean).join(';');
  const html = layer.format === 'html' ? layer.content : markdownToHtml(layer.content);
  return `<div class="ic-richtext" data-layer-id="${escAttr(layer.id)}" style="${style}">${html}</div>`;
}

function markdownToHtml(md: string): string {
  // Lightweight markdown → HTML for headings, bold, italic, links, inline code
  // Multi-paragraph and lists not supported; use format='html' for that.
  let s = escHtml(md);
  s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s.replace(/\n/g, '<br>');
}

// ── Embed Code renderer ──────────────────────────────────────

function renderEmbed(layer: Layer & { html: string }, ctx: InteractiveRenderContext): string {
  return `<div class="ic-embed" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">${layer.html}</div>`;
}

// ── Interactive control helpers ──────────────────────────────

/** Normalize an action (sugar string or structured) into a data-folio-action string. */
function actionStr(a?: string | ControlAction): string {
  if (!a) return '';
  if (typeof a === 'string') return a;
  const t = a.target ?? '';
  switch (a.type) {
    case 'set':          return `set:${t}=${a.value ?? ''}`;
    case 'toggle':       return `toggle:${t}`;
    case 'open_modal':   return `open_modal:${t}`;
    case 'close_modal':  return t ? `close_modal:${t}` : 'close_modal';
    case 'filter':       return a.value != null ? `filter:${t}:${a.value}` : `filter:${t}`;
    case 'scroll_to':    return `scroll_to:${t}`;
    case 'download_csv': return `download_csv:${t}`;
    case 'open_url':     return `open_url:${t}`;
    case 'goto_page':    return `goto_page:${t}`;
    default:             return t ? `${a.type}:${t}` : a.type;
  }
}

function optParts(o: FilterOption | string | number): { label: string; value: string } {
  if (o && typeof o === 'object') return { label: String(o.label), value: String(o.value) };
  return { label: String(o), value: String(o) };
}

function distinctValues(rows: Record<string, unknown>[], field: string): string[] {
  const seen = new Set<string>();
  for (const r of rows) { const v = r[field]; if (v != null) seen.add(String(v)); }
  return [...seen];
}

// ── Button ───────────────────────────────────────────────────

function renderButton(layer: ButtonLayer, ctx: InteractiveRenderContext): string {
  const variant = layer.variant ?? 'solid';
  const size = layer.size ?? 'md';
  const act = actionStr(layer.action);
  const custom = `${layer.background ? `background:${layer.background};border-color:${layer.background};` : ''}${layer.text_color ? `color:${layer.text_color};` : ''}${layer.border_radius != null ? `border-radius:${layer.border_radius}px;` : ''}`;
  const icon = layer.icon ? `<span class="ic-btn-ic">${escHtml(layer.icon)}</span>` : '';
  return `<div class="ic-ctl" style="${layerStyle(layer, ctx)}${layer.full_width ? ';width:100%' : ''}">
    <button class="ic-btn ic-btn-${variant} ic-btn-${size}"${layer.full_width ? ' style="width:100%"' : ''}${custom ? ` style="${custom}"` : ''}${act ? ` data-folio-action="${escAttr(act)}"` : ''}>${icon}${escHtml(layer.label)}</button>
  </div>`;
}

// ── Toggle / segmented ───────────────────────────────────────

function renderToggle(layer: ToggleLayer, ctx: InteractiveRenderContext): string {
  const init = layer.value != null ? String(layer.value) : (layer.options[0] ? optParts(layer.options[0]).value : '');
  const opts = layer.options.map(o => {
    const { label, value } = optParts(o as FilterOption | string);
    const on = value === init;
    return `<button class="ic-seg-opt${on ? ' active' : ''}" data-folio-action="set:${escAttr(layer.state_key)}=${escAttr(value)}" data-seg-group="${escAttr(layer.state_key)}" data-seg-value="${escAttr(value)}">${escHtml(label)}</button>`;
  }).join('');
  const lbl = layer.label ? `<span class="ic-ctl-label">${escHtml(layer.label)}</span>` : '';
  return `<div class="ic-ctl" style="${layerStyle(layer, ctx)}">${lbl}<div class="ic-seg" role="group">${opts}</div></div>`;
}

// ── Callout ──────────────────────────────────────────────────

function renderCallout(layer: CalloutLayer, ctx: InteractiveRenderContext): string {
  const v = layer.variant ?? 'info';
  const icon = layer.icon ?? { info: 'ℹ', success: '✓', warning: '⚠', danger: '✕', neutral: '•' }[v];
  const title = layer.title ? `<div class="ic-callout-title">${escHtml(layer.title)}</div>` : '';
  return `<div class="ic-callout ic-callout-${v}" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">
    <div class="ic-callout-ic">${escHtml(icon)}</div>
    <div class="ic-callout-body">${title}<div class="ic-richtext">${markdownToHtml(layer.content)}</div></div>
  </div>`;
}

// ── Progress / gauge ─────────────────────────────────────────

function renderProgress(layer: ProgressLayer, ctx: InteractiveRenderContext): string {
  const max = layer.max ?? 100;
  const pct = Math.max(0, Math.min(100, (layer.value / max) * 100));
  const color = layer.color ?? ctx.accent ?? 'var(--ic-accent)';
  const valText = layer.show_value === false ? '' : `${layer.value}${layer.unit ?? (max === 100 ? '%' : '')}`;
  const lbl = layer.label ? `<div class="ic-prog-label"><span>${escHtml(layer.label)}</span><span class="ic-prog-val">${escHtml(valText)}</span></div>` : (valText ? `<div class="ic-prog-label"><span></span><span class="ic-prog-val">${escHtml(valText)}</span></div>` : '');
  if (layer.style === 'radial') {
    const r = 30, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return `<div class="ic-prog ic-prog-radial" style="${layerStyle(layer, ctx)}">
      <svg viewBox="0 0 80 80"><circle cx="40" cy="40" r="${r}" class="ic-prog-track"/><circle cx="40" cy="40" r="${r}" class="ic-prog-arc" stroke="${escAttr(color)}" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg>
      <div class="ic-prog-center">${escHtml(valText)}</div>${layer.label ? `<div class="ic-prog-rlabel">${escHtml(layer.label)}</div>` : ''}
    </div>`;
  }
  return `<div class="ic-prog" style="${layerStyle(layer, ctx)}">${lbl}<div class="ic-prog-track-bar"><div class="ic-prog-fill" style="width:${pct.toFixed(1)}%;background:${escAttr(color)}"></div></div></div>`;
}

// ── Tooltip / popover ────────────────────────────────────────

function renderTooltip(layer: TooltipLayer, ctx: InteractiveRenderContext): string {
  const trigger = layer.icon ? escHtml(layer.icon) : (layer.label ? escHtml(layer.label) : 'ℹ');
  return `<span class="ic-tip" data-placement="${layer.placement ?? 'top'}" tabindex="0" style="${layerStyle(layer, ctx)}">
    <span class="ic-tip-trigger">${trigger}</span>
    <span class="ic-tip-pop"><span class="ic-richtext">${markdownToHtml(layer.content)}</span></span>
  </span>`;
}

// ── Tabs (container — recurses into child layers per panel) ───

function renderTabs(layer: TabsLayer, ctx: InteractiveRenderContext): string {
  const active = layer.active ?? 0;
  const variant = layer.variant ?? 'underline';
  const align = layer.align ?? 'left';
  const gid = `tabs-${layer.id}`;
  const btns = layer.tabs.map((t, i) => {
    const tid = t.id ?? `${gid}-${i}`;
    const ic = t.icon ? `<span class="ic-tab-ic">${escHtml(t.icon)}</span>` : '';
    return `<button class="ic-tab${i === active ? ' active' : ''}" data-folio-action="tab:${gid}:${tid}" data-tab-group="${gid}" data-tab-id="${tid}">${ic}${escHtml(t.label)}</button>`;
  }).join('');
  const panels = layer.tabs.map((t, i) => {
    const tid = t.id ?? `${gid}-${i}`;
    const inner = (t.layers ?? []).map(c => renderInteractiveLayer(c, ctx)).join('\n');
    return `<div class="ic-tab-panel${i === active ? ' active' : ''}" data-tab-panel="${gid}" data-tab-id="${tid}"><div class="folio-flow-grid">${inner}</div></div>`;
  }).join('\n');
  return `<div class="ic-tabs ic-tabs-${variant}" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">
    <div class="ic-tab-bar ic-tab-align-${align}" role="tablist">${btns}</div>${panels}
  </div>`;
}

// ── Accordion (container) ────────────────────────────────────

function renderAccordion(layer: AccordionLayer, ctx: InteractiveRenderContext): string {
  const items = layer.items.map((it, i) => {
    const iid = `acc-${layer.id}-${i}`;
    const open = it.open ?? false;
    const body = (it.layers && it.layers.length)
      ? `<div class="folio-flow-grid">${it.layers.map(c => renderInteractiveLayer(c, ctx)).join('\n')}</div>`
      : `<div class="ic-richtext">${markdownToHtml(it.body ?? '')}</div>`;
    const grp = layer.exclusive ? ` data-acc-group="acc-${escAttr(layer.id)}"` : '';
    return `<div class="ic-acc-item${open ? ' open' : ''}" id="${iid}"${grp}>
      <button class="ic-acc-head" data-folio-action="accordion:${iid}"><span>${escHtml(it.title)}</span><span class="ic-acc-chev">▾</span></button>
      <div class="ic-acc-panel"><div class="ic-acc-inner">${body}</div></div>
    </div>`;
  }).join('\n');
  return `<div class="ic-accordion" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">${items}</div>`;
}

// ── Modal / popup (insight dialog — opened by a button/row click) ──

function renderModal(layer: PopupLayer, ctx: InteractiveRenderContext): string {
  const head = layer.title
    ? `<div class="ic-modal-head"><div class="ic-modal-title">${escHtml(layer.title)}</div><button class="ic-modal-close" data-folio-action="close_modal:${escAttr(layer.id)}" aria-label="Close">×</button></div>`
    : `<button class="ic-modal-close ic-modal-close-float" data-folio-action="close_modal:${escAttr(layer.id)}" aria-label="Close">×</button>`;
  const body = (layer.layers && layer.layers.length)
    ? `<div class="folio-flow-grid">${layer.layers.map(c => renderInteractiveLayer(c, ctx)).join('\n')}</div>`
    : `<div class="ic-richtext">${markdownToHtml(layer.body ?? '')}</div>`;
  const bd = layer.close_on_backdrop === false ? '' : ` data-folio-action="close_modal:${escAttr(layer.id)}"`;
  return `<div class="ic-modal" id="${escAttr(layer.id)}" data-modal role="dialog" aria-modal="true" aria-hidden="true">
    <div class="ic-modal-backdrop"${bd}></div>
    <div class="ic-modal-dialog">${head}<div class="ic-modal-body">${body}</div></div>
  </div>`;
}

// ── Filter bar (multi-select — filters LINKED tables + charts) ──

function renderFilterBar(layer: FilterBarLayer, ctx: InteractiveRenderContext): string {
  const field = layer.field;
  const style = layer.style ?? 'chips';
  let opts: { label: string; value: string }[] = [];
  if (layer.options && layer.options.length) opts = layer.options.map(optParts);
  else if (layer.options_from) opts = distinctValues(dataRows(layer.options_from, ctx), field).map(v => ({ label: v, value: v }));
  const multi = !!layer.multi;
  const lbl = layer.label ? `<span class="ic-filter-label">${escHtml(layer.label)}</span>` : '';
  if (style === 'dropdown') {
    const o = opts.map(x => `<option value="${escAttr(x.value)}">${escHtml(x.label)}</option>`).join('');
    return `<div class="ic-filter" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">${lbl}<select class="ic-filter-select" data-filter-field="${escAttr(field)}"${multi ? ' multiple' : ''}>${layer.include_all !== false && !multi ? '<option value="__all__">All</option>' : ''}${o}</select></div>`;
  }
  const all = layer.include_all !== false
    ? `<button class="ic-chip active" data-folio-action="filter:${escAttr(field)}:__all__" data-filter-field="${escAttr(field)}" data-filter-value="__all__">All</button>`
    : '';
  const chips = opts.map(x => `<button class="ic-chip" data-folio-action="filter:${escAttr(field)}:${escAttr(x.value)}" data-filter-field="${escAttr(field)}" data-filter-value="${escAttr(x.value)}"${multi ? ' data-multi="1"' : ''}>${escHtml(x.label)}</button>`).join('');
  return `<div class="ic-filter ic-filter-${style}" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer, ctx)}">${lbl}<div class="ic-chips">${all}${chips}</div></div>`;
}

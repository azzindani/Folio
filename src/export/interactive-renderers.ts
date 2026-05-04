import type {
  Layer,
  InteractiveChartLayer,
  InteractiveTableLayer,
  KpiCardLayer,
  RichTextLayer,
  TableColumn,
} from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';

export interface InteractiveRenderContext {
  datasets: Map<string, LoadedDataset>;
  pageId: string;
  pageWidth: number;
  pageHeight: number;
  isDark: boolean;
  // Output channels populated as a side-effect:
  chartInits: string[];      // Chart.js init scripts
  tableInits: string[];      // Table init scripts
  fontFamilies: Set<string>; // Google Fonts to inject
  needsChartJs: boolean;
}

const INTERACTIVE_LAYER_TYPES = new Set<Layer['type']>([
  'interactive_chart',
  'interactive_table',
  'kpi_card',
  'rich_text',
  'embed_code',
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

function layerStyle(layer: Layer): string {
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
  const chartConfig = buildChartConfig(layer, rows, ctx.isDark);
  ctx.chartInits.push(`(function(){
    var el = document.getElementById(${JSON.stringify(id)});
    if (!el || !window.Chart) return;
    new window.Chart(el.getContext('2d'), ${JSON.stringify(chartConfig)});
  })();`);

  const title = layer.title ? `<div class="ic-title">${escHtml(layer.title)}</div>` : '';
  return `<div class="ic-chart" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer)}">
    ${title}
    <div class="ic-chart-canvas-wrap"><canvas id="${id}"></canvas></div>
  </div>`;
}

function buildChartConfig(
  layer: InteractiveChartLayer,
  rows: Record<string, unknown>[],
  isDark: boolean,
): unknown {
  const x = layer.x_field ?? 'x';
  const y = layer.y_field ?? 'y';
  const labels = rows.map(r => r[x]);
  const data = rows.map(r => Number(r[y] ?? 0));
  const colors = layer.custom_colors && layer.custom_colors.length > 0
    ? layer.custom_colors
    : defaultPalette(isDark);

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

  return `<div class="ic-table" id="${id}" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer)}">
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

  return `<div class="ic-kpi" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer)};${customStyle}">
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
    layerStyle(layer),
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
  void ctx;
  return `<div class="ic-embed" data-layer-id="${escAttr(layer.id)}" style="${layerStyle(layer)}">${layer.html}</div>`;
}

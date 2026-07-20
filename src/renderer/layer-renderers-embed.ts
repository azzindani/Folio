// Folio renderer — foreignObject data/embed renderers: chart/table/kpi/etc (verbatim).
import type { MermaidLayer, ChartLayer, CodeLayer, MathLayer, InteractiveChartLayer, InteractiveTableLayer, RichTextLayer, KpiCardLayer, MapLayer, EmbedCodeLayer } from '../schema/types';
import { createSVGElement } from './svg-utils';
import { getPreviewRows, getPreviewAccent } from './render-context';

import { applyCommonAttributes, makeForeignObject, escHtml } from './layer-renderers-shared';

export function renderMermaid(layer: MermaidLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.style.width = '100%';
  container.style.height = '100%';
  container.style.overflow = 'hidden';

  // Placeholder until async render completes
  const placeholder = document.createElement('div');
  placeholder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  placeholder.style.cssText = 'font-family:monospace;font-size:12px;color:#8892A4;padding:8px;white-space:pre;';
  placeholder.textContent = layer.definition;
  container.appendChild(placeholder);
  fo.appendChild(container);

  // Stable ID derived from layer.id to avoid mermaid ID collisions
  const diagramId = `mermaid-${layer.id.replace(/[^a-zA-Z0-9]/g, '-')}`;

  import('mermaid').then(mod => {
    const mermaid = mod.default;
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
    return mermaid.render(diagramId, layer.definition);
  }).then(({ svg }) => {
    container.innerHTML = svg;
  }).catch(() => {
    // Leave placeholder on error
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Chart (vega-embed) ───────────────────────────────────────
// Lazy-loads vega-embed on first use; renders a Vega-Lite spec
// into a foreignObject container and updates the DOM once done.

export function renderChart(layer: ChartLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.style.width = `${w}px`;
  container.style.height = `${h}px`;
  container.style.overflow = 'hidden';

  // Placeholder
  const placeholder = document.createElement('div');
  placeholder.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  placeholder.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#8892A4;font-family:monospace;font-size:12px;';
  placeholder.textContent = '[Chart loading…]';
  container.appendChild(placeholder);
  fo.appendChild(container);

  // Merge layer dimensions into spec so vega-embed respects them
  const spec = { width: w - 20, height: h - 20, ...layer.spec };

  import('vega-embed').then(({ default: embed }) => {
    container.innerHTML = '';
    return embed(container, spec as unknown as Parameters<typeof embed>[1], {
      renderer: 'svg',
      actions: false,
      theme: 'dark',
    });
  }).catch(() => {
    container.innerHTML = '';
    placeholder.textContent = '[Chart render failed]';
    container.appendChild(placeholder);
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Code (Prism.js) ──────────────────────────────────────────
// Lazy-loads Prism on first use for syntax highlighting.

export function renderCode(layer: CodeLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 200;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const pre = document.createElement('pre');
  pre.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  pre.style.cssText = [
    'font-family:JetBrains Mono,monospace',
    'font-size:13px',
    'margin:0',
    'padding:16px',
    'background:#1a1a2e',
    'color:#e0e0e8',
    'border-radius:8px',
    'overflow:auto',
    `width:${w}px`,
    `height:${h}px`,
    'box-sizing:border-box',
  ].join(';');

  const code = document.createElement('code');
  code.className = `language-${layer.language}`;
  // Escape HTML entities for initial plain render
  code.textContent = layer.code;
  pre.appendChild(code);
  fo.appendChild(pre);

  // Lazy-load Prism and apply syntax highlighting
  // prismjs uses `export =` so the dynamic import resolves to Prism directly
  import('prismjs').then(Prism => {
    // Dynamically load the language component if not already present
    const grammar = Prism.languages[layer.language];
    if (grammar) {
      code.innerHTML = Prism.highlight(layer.code, grammar, layer.language);
    } else {
      import(`prismjs/components/prism-${layer.language}.js`).then(() => {
        const g = Prism.languages[layer.language];
        if (g) code.innerHTML = Prism.highlight(layer.code, g, layer.language);
      }).catch(() => {
        // Language not available — plain text is fine
      });
    }
  }).catch(() => {
    // Prism unavailable — plain text remains
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Math (KaTeX) ─────────────────────────────────────────────
// Lazy-loads KaTeX on first use; renders LaTeX into HTML inside
// a foreignObject. Falls back to raw expression string on error.

export function renderMath(layer: MathLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 300;
  const h = typeof layer.height === 'number' ? layer.height : 100;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.style.cssText = `display:flex;align-items:center;justify-content:center;width:${w}px;height:${h}px;`;
  // Plain-text placeholder
  container.textContent = layer.expression;
  fo.appendChild(container);

  import('katex').then(mod => {
    const katex = mod.default;
    container.innerHTML = katex.renderToString(layer.expression, {
      throwOnError: false,
      displayMode: true,
      output: 'html',
    });
  }).catch(() => {
    // Leave plain text fallback
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Group ───────────────────────────────────────────────────

function normalizeChartAliases(layer: InteractiveChartLayer): void {
  const o = layer as unknown as Record<string, unknown>;
  if (layer.chart_type == null) { const a = o['chart'] ?? o['kind']; if (typeof a === 'string') o['chart_type'] = a; }
  if (layer.x_field == null && typeof o['x'] === 'string') o['x_field'] = o['x'] as string;
  if (layer.y_field == null && typeof o['y'] === 'string') o['y_field'] = o['y'] as string;
}

// ── Interactive Chart (Plotly) ───────────────────────────────

export function renderInteractiveChart(layer: InteractiveChartLayer, _svg: SVGSVGElement): SVGElement {
  normalizeChartAliases(layer);
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', { x: layer.x ?? 0, y: layer.y ?? 0, width: w, height: h });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.className = 'folio-chart';
  container.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;box-sizing:border-box;background:#191926;border-radius:10px;`;
  if (layer.id) container.dataset['layerId'] = layer.id;

  const ph = document.createElement('div');
  ph.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  ph.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#8892A4;font-family:Inter,sans-serif;font-size:12px;';
  ph.textContent = layer.title ?? `${layer.chart_type} chart`;
  container.appendChild(ph);
  fo.appendChild(container);

  // Draw a real chart from the design's inline data (or a representative
  // sample when the source is external / not present at design time) so the
  // studio canvas previews the widget instead of an empty placeholder.
  const rows = getPreviewRows(layer.data_ref);
  const { spec, isSample } = buildChartPreviewSpec(layer, rows, getPreviewAccent(), w, h);
  import('vega-embed').then(({ default: embed }) => {
    container.innerHTML = '';
    return embed(container, spec as unknown as Parameters<typeof embed>[1], {
      renderer: 'svg', actions: false, theme: 'dark',
    });
  }).then(() => {
    if (isSample) {
      const note = document.createElement('div');
      note.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      note.textContent = 'sample data';
      note.style.cssText = 'position:absolute;right:8px;bottom:6px;font:9px Inter,sans-serif;color:rgba(180,180,200,0.55);letter-spacing:0.05em;pointer-events:none;';
      container.style.position = 'relative';
      container.appendChild(note);
    }
  }).catch(() => {
    container.innerHTML = '';
    container.appendChild(ph);
  });

  applyCommonAttributes(fo, layer);
  return fo;
}

// Pick x/y fields for a chart preview — explicit fields win; otherwise infer a
// categorical x + numeric y from the first row.

function inferChartFields(layer: InteractiveChartLayer, rows: Record<string, unknown>[]): { x: string; y: string } {
  let x = layer.x_field;
  let y = layer.y_field;
  if ((!x || !y) && rows.length > 0) {
    const keys = Object.keys(rows[0]);
    const numKey = keys.find((k) => typeof rows[0][k] === 'number');
    const catKey = keys.find((k) => typeof rows[0][k] !== 'number') ?? keys[0];
    x = x ?? catKey;
    y = y ?? numKey ?? keys[1] ?? keys[0];
  }
  return { x: x ?? 'category', y: y ?? 'value' };
}

function sampleChartRows(x: string, y: string): Record<string, unknown>[] {
  const cats = ['A', 'B', 'C', 'D', 'E'];
  const vals = [38, 62, 49, 71, 55];
  return cats.map((c, i) => ({ [x]: c, [y]: vals[i] }));
}

interface VlSpec { [k: string]: unknown }

// Map an interactive_chart layer → a Vega-Lite spec for the editor preview.
// Vega is already bundled (the static `chart` layer uses it), so this needs no
// new dependency. The exported HTML still draws Chart.js/Plotly; this is a
// faithful design-time preview of shape + data, not a pixel match.

export function buildChartPreviewSpec(
  layer: InteractiveChartLayer,
  rows: Record<string, unknown>[],
  accent: string,
  w: number,
  h: number,
): { spec: VlSpec; isSample: boolean } {
  const { x, y } = inferChartFields(layer, rows);
  const isSample = rows.length === 0;
  const values = isSample ? sampleChartRows(x, y) : rows.slice(0, 60);
  const xType = typeof values[0]?.[x] === 'number' ? 'quantitative' : 'nominal';
  const colorEnc = layer.color_field
    ? { color: { field: layer.color_field, type: 'nominal', scale: { scheme: 'tableau10' } } }
    : {};

  const spec: VlSpec = {
    $schema: 'https://vega.github.io/schema/vega-lite/v5.json',
    width: Math.max(80, w - 28),
    height: Math.max(60, h - (layer.title ? 56 : 34)),
    background: '#191926',
    padding: 12,
    data: { values },
    config: {
      view: { stroke: 'transparent' },
      axis: { labelColor: '#b8b8c8', titleColor: '#d8d8e4', gridColor: 'rgba(255,255,255,0.06)', domainColor: 'rgba(255,255,255,0.18)' },
      legend: { labelColor: '#b8b8c8', titleColor: '#d8d8e4' },
      title: { color: '#f0f0f6', fontSize: 13, anchor: 'start' },
    },
  };
  if (layer.title) spec['title'] = layer.title;

  const xEnc = { field: x, type: xType, axis: { labelAngle: 0 } };
  const yEnc = { field: y, type: 'quantitative' };

  switch (layer.chart_type) {
    case 'line':
      spec['mark'] = { type: 'line', color: accent, point: { filled: true, color: accent }, strokeWidth: 2 };
      spec['encoding'] = { x: { field: x, type: 'ordinal' }, y: yEnc, ...colorEnc };
      break;
    case 'area':
      spec['mark'] = { type: 'area', color: accent, opacity: 0.65, line: { color: accent, strokeWidth: 2 } };
      spec['encoding'] = { x: { field: x, type: 'ordinal' }, y: yEnc, ...colorEnc };
      break;
    case 'scatter':
      spec['mark'] = { type: 'point', filled: true, color: accent, size: 70, opacity: 0.8 };
      spec['encoding'] = { x: xEnc, y: yEnc, ...colorEnc };
      break;
    case 'pie':
    case 'donut':
      spec['mark'] = { type: 'arc', outerRadius: Math.min(spec['width'] as number, spec['height'] as number) / 2 - 6, ...(layer.chart_type === 'donut' ? { innerRadius: Math.min(spec['width'] as number, spec['height'] as number) / 5 } : {}) };
      spec['encoding'] = { theta: { field: y, type: 'quantitative' }, color: { field: x, type: 'nominal', scale: { scheme: 'tableau10' } } };
      break;
    case 'heatmap':
      if (layer.color_field) {
        spec['mark'] = 'rect';
        spec['encoding'] = { x: { field: x, type: 'nominal' }, y: { field: layer.color_field, type: 'nominal' }, color: { field: y, type: 'quantitative', scale: { scheme: 'viridis' } } };
      } else {
        spec['mark'] = { type: 'bar', color: accent, cornerRadiusEnd: 3 };
        spec['encoding'] = { x: xEnc, y: yEnc };
      }
      break;
    case 'funnel':
      spec['mark'] = { type: 'bar', color: accent, cornerRadiusEnd: 3 };
      spec['encoding'] = { y: { field: x, type: 'nominal', sort: '-x' }, x: yEnc };
      break;
    case 'bar':
    case 'waterfall':
    default:
      spec['mark'] = { type: 'bar', color: accent, cornerRadiusEnd: 3 };
      spec['encoding'] = { x: xEnc, y: yEnc, ...colorEnc };
      break;
  }
  return { spec, isSample };
}

// ── Interactive Table (Tabulator) ────────────────────────────

export function renderInteractiveTable(layer: InteractiveTableLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', { x: layer.x ?? 0, y: layer.y ?? 0, width: w, height: h });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.className = 'folio-table';
  container.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;box-sizing:border-box;background:#191926;border-radius:10px;font-family:Inter,sans-serif;`;
  if (layer.id) container.dataset['layerId'] = layer.id;

  // Draw a real static table preview from the design's inline rows (Tabulator
  // mounts only in the exported HTML). Falls back to a sample so the shape
  // shows even when the source is external / not present at design time.
  const allRows = getPreviewRows(layer.data_ref);
  const cols = (layer.columns ?? []).length > 0
    ? layer.columns
    : (allRows[0] ? Object.keys(allRows[0]).map((f) => ({ field: f, title: f })) : [{ field: 'value', title: 'Value' }]);
  const sample = allRows.length === 0;
  const maxRows = Math.max(2, Math.floor((h - 44) / 30));
  const rows = sample ? sampleTableRows(cols) : allRows.slice(0, maxRows);

  const th = cols.map((c) => {
    const co = c as Record<string, unknown>;
    const align = (co['align'] as string) ?? 'left';
    // Header alias: title is canonical; accept label/header/name; else the field.
    const head = co['title'] ?? co['label'] ?? co['header'] ?? co['name'] ?? co['field'];
    return `<th style="text-align:${escHtml(align)};padding:8px 12px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:#9aa;border-bottom:1px solid rgba(255,255,255,0.12);white-space:nowrap;">${escHtml(String(head))}</th>`;
  }).join('');
  const trs = rows.map((r) => {
    const tds = cols.map((c) => {
      const align = (c as { align?: string }).align ?? 'left';
      const v = (r as Record<string, unknown>)[c.field];
      return `<td style="text-align:${escHtml(align)};padding:7px 12px;font-size:12px;color:#d8d8e4;border-bottom:1px solid rgba(255,255,255,0.05);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px;">${escHtml(v == null ? '' : String(v))}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');

  const hiddenCount = sample ? 0 : Math.max(0, allRows.length - rows.length);
  const footer = hiddenCount > 0
    ? `<div xmlns="http://www.w3.org/1999/xhtml" style="padding:6px 12px;font-size:10px;color:rgba(180,180,200,0.6);border-top:1px solid rgba(255,255,255,0.08);">+${hiddenCount} more row${hiddenCount === 1 ? '' : 's'}${layer.pagination === false ? '' : ' · paginated'}${layer.exportable ? ' · CSV' : ''}</div>`
    : (sample ? `<div xmlns="http://www.w3.org/1999/xhtml" style="padding:6px 12px;font-size:10px;color:rgba(180,180,200,0.55);border-top:1px solid rgba(255,255,255,0.08);">sample data</div>` : '');

  container.innerHTML = `<div xmlns="http://www.w3.org/1999/xhtml" style="height:100%;display:flex;flex-direction:column;"><div xmlns="http://www.w3.org/1999/xhtml" style="flex:1;overflow:hidden;"><table xmlns="http://www.w3.org/1999/xhtml" style="width:100%;border-collapse:collapse;"><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table></div>${footer}</div>`;

  fo.appendChild(container);
  applyCommonAttributes(fo, layer);
  return fo;
}

function sampleTableRows(cols: { field: string; title?: string }[]): Record<string, unknown>[] {
  const fill = (i: number, c: { field: string }, j: number): unknown =>
    j === 0 ? `Item ${i + 1}` : Math.round((i + 1) * (j + 1) * 12.5);
  return [0, 1, 2].map((i) => {
    const row: Record<string, unknown> = {};
    cols.forEach((c, j) => { row[c.field] = fill(i, c, j); });
    return row;
  });
}

// ── Rich Text (marked.js) ────────────────────────────────────

export function renderRichText(layer: RichTextLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const container = document.createElement('div');
  container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  container.className = 'folio-richtext';
  const ff = layer.font_family ?? 'Inter, sans-serif';
  const fs = layer.font_size ?? 16;
  const lh = layer.line_height ?? 1.6;
  const color = layer.color ?? '#e0e0e0';
  const linkColor = layer.link_color ?? '#6c5ce7';
  container.style.cssText = `width:100%;height:100%;overflow:auto;box-sizing:border-box;font-family:${ff};font-size:${fs}px;line-height:${lh};color:${color};--link-color:${linkColor};`;

  if (layer.format === 'html') {
    container.innerHTML = layer.content;
  } else {
    // Eager markdown render. We also keep the source in a dataset attr
    // so the report runtime can re-render after data-binding without
    // re-parsing the engine output.
    container.dataset['markdownSrc'] = layer.content;
    container.dataset['renderType'] = 'markdown';
    // Initial paint = literal text inside an inline-styled span; once
    // marked.js loads (lazy chunk) we swap it for parsed HTML. The
    // wrapper keeps font/colour inheritance and avoids the raw `<pre>`
    // look that surfaced as `**asterisks**` in static exports.
    const initial = document.createElement('span');
    initial.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    initial.style.cssText = 'white-space:pre-wrap;display:block;';
    initial.textContent = layer.content;
    container.appendChild(initial);
    import('marked').then(({ marked }) => {
      const html = marked.parse(layer.content, { gfm: true, breaks: true });
      // marked@18 returns a string for non-async input.
      container.innerHTML = typeof html === 'string' ? html : layer.content;
      container.dataset['markdownSrc'] = layer.content;
      container.dataset['renderType'] = 'markdown';
    }).catch(() => {
      // marked unavailable — leave the plain-text fallback in place.
    });
  }

  fo.appendChild(container);
  applyCommonAttributes(fo, layer);
  return fo;
}

// ── KPI Card ─────────────────────────────────────────────────

export function renderKpiCard(layer: KpiCardLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 300;
  const h = typeof layer.height === 'number' ? layer.height : 180;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  const card = document.createElement('div');
  card.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
  card.className = 'folio-kpi';
  const bg = layer.background ?? '#1e1e3a';
  const textColor = layer.text_color ?? '#ffffff';
  const radius = layer.border_radius ?? 12;
  card.style.cssText = `width:100%;height:100%;box-sizing:border-box;background:${bg};color:${textColor};border-radius:${radius}px;padding:20px;display:flex;flex-direction:column;justify-content:space-between;`;

  const valStr = typeof layer.value === 'number'
    ? formatKpiValue(layer.value, layer.format, layer.currency, layer.decimals)
    : String(layer.value);
  // A delta is not always a number. "unchanged", "was 2", "flat" are ordinary
  // things to write on a KPI card, and coercing them produced a literal
  // "▼ NaN" on the canvas — the interactive HTML export renders the same field
  // as plain text, so the editor preview and the export disagreed about the
  // same design. Only treat it as numeric when it actually parses.
  const deltaRaw = layer.delta;
  const deltaNum = deltaRaw !== undefined && deltaRaw !== null && String(deltaRaw).trim() !== ''
    ? Number(deltaRaw)
    : NaN;
  const deltaIsNumeric = Number.isFinite(deltaNum);
  const deltaStr = deltaRaw === undefined
    ? undefined
    : deltaIsNumeric
      ? formatKpiValue(deltaNum, layer.delta_format === 'percent' ? 'percent' : 'number', undefined, 1)
      : String(deltaRaw);
  const posColor = layer.delta_positive_color ?? '#00b894';
  const negColor = layer.delta_negative_color ?? '#e17055';
  // A non-numeric delta gets the neutral text colour and no arrow: an arrow
  // asserts a direction the text has not claimed.
  const deltaColor = !deltaIsNumeric ? 'currentColor' : deltaNum >= 0 ? posColor : negColor;
  const deltaArrow = !deltaIsNumeric ? '' : deltaNum >= 0 ? '▲ ' : '▼ ';

  card.innerHTML = `
    <div class="kpi-label" xmlns="http://www.w3.org/1999/xhtml" style="font-size:13px;opacity:0.7;text-transform:uppercase;letter-spacing:0.08em;">${escHtml(layer.label)}</div>
    <div class="kpi-value" xmlns="http://www.w3.org/1999/xhtml" style="font-size:36px;font-weight:700;line-height:1;">${escHtml(valStr)}</div>
    ${deltaStr ? `<div class="kpi-delta" xmlns="http://www.w3.org/1999/xhtml" style="font-size:14px;color:${deltaColor};">${escHtml(deltaArrow + deltaStr)}</div>` : ''}
    ${layer.sparkline_data ? `<canvas class="kpi-sparkline" data-data-ref="${escHtml(layer.sparkline_data ?? '')}" data-field="${escHtml(layer.sparkline_field ?? '')}" data-color="${escHtml(layer.sparkline_color ?? '#6c5ce7')}" style="width:100%;height:40px;"></canvas>` : ''}
  `;

  fo.appendChild(card);
  applyCommonAttributes(fo, layer);
  return fo;
}

// Cache by (currency, decimals). Constructing Intl.NumberFormat is expensive
// on cold workers — Node lazy-loads ICU data on first currency-style call,
// which is the root cause of the Windows CI timeout this cache fixes.

const _currencyFormatters = new Map<string, Intl.NumberFormat>();

function getCurrencyFormatter(currency: string, dec: number): Intl.NumberFormat {
  const key = `${currency}|${dec}`;
  let fmt = _currencyFormatters.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: dec });
    _currencyFormatters.set(key, fmt);
  }
  return fmt;
}

function formatKpiValue(value: number, format?: string, currency?: string, decimals?: number): string {
  const dec = decimals ?? 0;
  if (format === 'currency') {
    return getCurrencyFormatter(currency ?? 'USD', dec).format(value);
  }
  if (format === 'percent') {
    return `${value >= 0 ? '+' : ''}${value.toFixed(dec)}%`;
  }
  return value.toFixed(dec);
}

export function renderMap(layer: MapLayer, _svg: SVGSVGElement): SVGElement {
  const { fo, container } = makeForeignObject(layer, '[Map loading…]', 'folio-map');

  const meta = {
    layerId: layer.id,
    center: layer.center,
    zoom: layer.zoom ?? 2,
    tileProvider: layer.tile_provider ?? 'osm',
    overlays: layer.overlays ?? [],
  };
  container.dataset['leafletSpec'] = JSON.stringify(meta);
  container.dataset['renderType'] = 'leaflet';

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Embed Code ───────────────────────────────────────────────

export function renderEmbedCode(layer: EmbedCodeLayer, _svg: SVGSVGElement): SVGElement {
  const w = typeof layer.width === 'number' ? layer.width : 400;
  const h = typeof layer.height === 'number' ? layer.height : 300;

  const fo = createSVGElement('foreignObject', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
  });

  if (layer.sandbox !== false) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    iframe.style.cssText = `width:${w}px;height:${h}px;border:none;`;
    iframe.setAttribute('srcdoc', layer.html);
    iframe.setAttribute('sandbox', layer.allow_scripts ? 'allow-scripts' : '');
    fo.appendChild(iframe);
  } else {
    const container = document.createElement('div');
    container.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    container.style.cssText = `width:${w}px;height:${h}px;overflow:hidden;`;
    container.innerHTML = layer.html;
    fo.appendChild(container);
  }

  applyCommonAttributes(fo, layer);
  return fo;
}

// ── Popup ────────────────────────────────────────────────────

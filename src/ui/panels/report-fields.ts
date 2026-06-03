import type { Layer } from '../../schema/types';

// Visual property forms for interactive report components (chart / table / kpi /
// button / tabs / accordion / filter_bar / …). Returns HTML using the panel's
// existing field classes so edits flow through the generic handlers:
//   .prop-input  → text/number  (input/change → applyPropertyChange, dotted paths ok)
//   .prop-select → <select>     (change → applyPropertyChange)
//   .prop-check  → checkbox      (change → applyPropertyChange, bound in the panel)
// Array add/remove buttons carry data-arr-action and are wired by the panel.

export interface DatasetInfo { id: string; columns: string[]; }

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
const lbl = (t: string): string => `<div style="font-size:10px;color:var(--color-text-muted);margin-bottom:2px">${esc(t)}</div>`;
const cell = 'background:var(--color-bg);border:1px solid var(--color-border);border-radius:4px;padding:4px 6px;color:var(--color-text);font-size:12px;width:100%;box-sizing:border-box';

function txt(prop: string, label: string, value: unknown): string {
  return `<div>${lbl(label)}<input type="text" class="prop-input" data-prop="${prop}" value="${esc(value)}" style="${cell}"></div>`;
}
function num(prop: string, label: string, value: unknown, min?: number, max?: number, step = 1): string {
  const r = `${min != null ? `min="${min}"` : ''} ${max != null ? `max="${max}"` : ''} step="${step}"`;
  return `<div>${lbl(label)}<input type="number" class="prop-input" data-prop="${prop}" value="${esc(value)}" ${r} style="${cell}"></div>`;
}
function area(prop: string, label: string, value: unknown, rows = 3): string {
  return `<div>${lbl(label)}<textarea class="prop-input" data-prop="${prop}" rows="${rows}" style="${cell};resize:vertical;font-family:var(--font-mono);line-height:1.4">${esc(value)}</textarea></div>`;
}
function sel(prop: string, label: string, value: unknown, options: string[]): string {
  const cur = String(value ?? '');
  const opts = options.map(o => `<option value="${esc(o)}"${o === cur ? ' selected' : ''}>${esc(o)}</option>`).join('');
  return `<div>${lbl(label)}<select class="prop-select" data-prop="${prop}" style="${cell}">${opts}</select></div>`;
}
function chk(prop: string, label: string, checked: unknown): string {
  return `<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--color-text);cursor:pointer;padding:3px 0">
    <input type="checkbox" class="prop-check" data-prop="${prop}"${checked ? ' checked' : ''}> ${esc(label)}</label>`;
}
// Field picker — a select of the dataset's columns, always including the current value.
function fieldPicker(prop: string, label: string, value: unknown, cols: string[], allowNone = false): string {
  const cur = String(value ?? '');
  const all = Array.from(new Set([...(allowNone ? [''] : []), ...(cur ? [cur] : []), ...cols]));
  return sel(prop, label, cur, all.length ? all : [cur]);
}
const grid2 = (inner: string): string => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">${inner}</div>`;

function datasetIds(datasets: DatasetInfo[]): string[] { return datasets.map(d => d.id); }
function colsFor(ref: unknown, datasets: DatasetInfo[]): string[] {
  const id = String(ref ?? '').replace(/^\$data\./, '');
  return datasets.find(d => d.id === id)?.columns ?? [];
}

// ── Dispatcher ───────────────────────────────────────────────
export function renderReportFields(layer: Layer, datasets: DatasetInfo[]): string {
  const l = layer as unknown as Record<string, unknown>;
  switch (layer.type) {
    case 'interactive_chart': return chartFields(l, datasets);
    case 'interactive_table': return tableFields(l, datasets);
    case 'kpi_card':          return kpiFields(l);
    case 'rich_text':         return richTextFields(l);
    case 'button':            return buttonFields(l);
    case 'callout':           return calloutFields(l);
    case 'progress':          return progressFields(l);
    case 'toggle':            return toggleFields(l);
    case 'filter_bar':        return filterBarFields(l, datasets);
    case 'tooltip':           return tooltipFields(l);
    case 'popup':             return popupFields(l);
    case 'tabs':              return tabsFields(l);
    case 'accordion':         return accordionFields(l);
    default:                  return '';
  }
}

/** True for the types renderReportFields handles — lets the panel pick this path. */
export function hasReportFields(type: string): boolean {
  return ['interactive_chart', 'interactive_table', 'kpi_card', 'rich_text', 'button',
    'callout', 'progress', 'toggle', 'filter_bar', 'tooltip', 'popup', 'tabs', 'accordion'].includes(type);
}

const CHART_TYPES = ['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'funnel', 'waterfall'];

function chartFields(l: Record<string, unknown>, datasets: DatasetInfo[]): string {
  const cols = colsFor(l['data_ref'], datasets);
  return [
    grid2(sel('chart_type', 'Chart type', l['chart_type'], CHART_TYPES) + sel('library', 'Library', l['library'] ?? 'chartjs', ['chartjs', 'plotly'])),
    sel('data_ref', 'Dataset', l['data_ref'], datasetIds(datasets).length ? datasetIds(datasets) : [String(l['data_ref'] ?? '')]),
    grid2(fieldPicker('x_field', 'X field', l['x_field'], cols) + fieldPicker('y_field', 'Y field', l['y_field'], cols)),
    fieldPicker('color_field', 'Color by', l['color_field'], cols, true),
    txt('title', 'Title', l['title']),
    `<div style="display:flex;gap:14px">${chk('legend', 'Legend', l['legend'] !== false)}${chk('grid', 'Grid', l['grid'] !== false)}</div>`,
  ].join('');
}

const FORMATTERS = ['', 'currency', 'number', 'percent', 'date', 'badge', 'delta'];
const ALIGN = ['left', 'center', 'right'];

function tableFields(l: Record<string, unknown>, datasets: DatasetInfo[]): string {
  const cols = colsFor(l['data_ref'], datasets);
  const columns = Array.isArray(l['columns']) ? (l['columns'] as Record<string, unknown>[]) : [];
  const colRows = columns.map((c, i) => `
    <div style="border:1px solid var(--color-border);border-radius:5px;padding:6px;margin-bottom:5px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:10px;color:var(--color-text-muted)">Column ${i + 1}</span>
        <button class="prop-btn" data-arr-action="del-col" data-arr-index="${i}" title="Remove" style="border:none;background:none;color:var(--color-text-muted);cursor:pointer;font-size:13px">✕</button>
      </div>
      ${grid2(fieldPicker(`columns.${i}.field`, 'Field', c['field'], cols) + txt(`columns.${i}.title`, 'Title', c['title']))}
      ${grid2(sel(`columns.${i}.formatter`, 'Format', c['formatter'] ?? '', FORMATTERS) + sel(`columns.${i}.align`, 'Align', c['align'] ?? 'left', ALIGN))}
    </div>`).join('');
  return [
    sel('data_ref', 'Dataset', l['data_ref'], datasetIds(datasets).length ? datasetIds(datasets) : [String(l['data_ref'] ?? '')]),
    `<div style="display:flex;gap:14px;flex-wrap:wrap">${chk('filterable', 'Filter', l['filterable'])}${chk('exportable', 'CSV', l['exportable'])}${chk('pagination', 'Paginate', l['pagination'] !== false)}${chk('row_detail', 'Row drill-down', l['row_detail'])}</div>`,
    grid2(num('page_size', 'Page size', l['page_size'] ?? 20, 1) + fieldPicker('row_detail_title', 'Detail title field', l['row_detail_title'], cols, true)),
    `<div style="margin-top:8px;font-size:10px;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:.06em">Columns</div>`,
    colRows,
    `<button class="prop-btn" data-arr-action="add-col" style="width:100%;padding:5px;margin-top:4px;border:1px dashed var(--color-border);border-radius:5px;background:none;color:var(--color-text-muted);cursor:pointer;font-size:11px">+ Add column</button>`,
  ].join('');
}

const KPI_FORMATS = ['number', 'currency', 'percent'];
function kpiFields(l: Record<string, unknown>): string {
  return [
    txt('label', 'Label', l['label']),
    grid2(txt('value', 'Value', l['value']) + sel('format', 'Format', l['format'] ?? 'number', KPI_FORMATS)),
    grid2(num('decimals', 'Decimals', l['decimals'] ?? 0, 0, 6) + txt('currency', 'Currency', l['currency'] ?? '')),
    grid2(num('delta', 'Delta', l['delta'] ?? '') + sel('delta_format', 'Delta fmt', l['delta_format'] ?? 'number', ['number', 'percent'])),
  ].join('');
}

function richTextFields(l: Record<string, unknown>): string {
  return [
    sel('format', 'Format', l['format'] ?? 'markdown', ['markdown', 'html']),
    area('content', 'Content', l['content'], 6),
    grid2(num('font_size', 'Font size', l['font_size'] ?? 16, 8, 96) + txt('color', 'Color', l['color'] ?? '')),
  ].join('');
}

const VARIANTS = ['solid', 'outline', 'ghost', 'link'];
const ACTION_VERBS = 'open_modal:<id> · close_modal · toggle:<key> · set:<key>=<val> · filter:<field>:<val> · tab:<grp>:<id> · accordion:<id> · scroll_to:<id> · download_csv:<id> · open_url:<url> · goto_page:<id>';
function actionStr(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object') { const o = a as Record<string, unknown>; return o['target'] ? `${o['type']}:${o['target']}${o['value'] != null ? '=' + o['value'] : ''}` : String(o['type'] ?? ''); }
  return '';
}
function buttonFields(l: Record<string, unknown>): string {
  return [
    grid2(txt('label', 'Label', l['label']) + sel('variant', 'Variant', l['variant'] ?? 'solid', VARIANTS)),
    txt('action', 'Action', actionStr(l['action'])),
    `<div style="font-size:9px;color:var(--color-text-dim);line-height:1.5;margin-top:2px">${ACTION_VERBS}</div>`,
  ].join('');
}

function calloutFields(l: Record<string, unknown>): string {
  return [
    sel('variant', 'Variant', l['variant'] ?? 'info', ['info', 'success', 'warning', 'danger']),
    txt('title', 'Title', l['title']),
    area('content', 'Content', l['content'], 3),
  ].join('');
}

function progressFields(l: Record<string, unknown>): string {
  return [
    txt('label', 'Label', l['label']),
    grid2(num('value', 'Value', l['value'] ?? 0) + num('max', 'Max', l['max'] ?? 100)),
    grid2(sel('style', 'Style', l['style'] ?? 'bar', ['bar', 'radial']) + txt('unit', 'Unit', l['unit'] ?? '')),
  ].join('');
}

function strArrayEditor(prop: string, label: string, arr: unknown, addAction: string): string {
  const items = Array.isArray(arr) ? arr : [];
  const rows = items.map((v, i) => `<div style="display:flex;gap:4px;margin-bottom:4px">
    <input type="text" class="prop-input" data-prop="${prop}.${i}" value="${esc(v)}" style="${cell}">
    <button class="prop-btn" data-arr-action="del-${addAction}" data-arr-index="${i}" style="border:1px solid var(--color-border);background:none;color:var(--color-text-muted);cursor:pointer;border-radius:4px;padding:0 8px">✕</button>
  </div>`).join('');
  return `${lbl(label)}${rows}<button class="prop-btn" data-arr-action="add-${addAction}" style="width:100%;padding:4px;border:1px dashed var(--color-border);border-radius:5px;background:none;color:var(--color-text-muted);cursor:pointer;font-size:11px">+ Add</button>`;
}

function toggleFields(l: Record<string, unknown>): string {
  return [
    grid2(txt('label', 'Label', l['label']) + txt('state_key', 'State key', l['state_key'])),
    strArrayEditor('options', 'Options', l['options'], 'opt'),
  ].join('');
}

function filterBarFields(l: Record<string, unknown>, datasets: DatasetInfo[]): string {
  const ids = datasetIds(datasets);
  return [
    grid2(txt('field', 'Field', l['field']) + txt('label', 'Label', l['label'])),
    grid2(sel('options_from', 'Options from', l['options_from'] ?? '', ['', ...ids]) + sel('style', 'Style', l['style'] ?? 'chips', ['chips', 'dropdown'])),
    chk('multi', 'Multi-select', l['multi']),
  ].join('');
}

function tooltipFields(l: Record<string, unknown>): string {
  return grid2(txt('icon', 'Icon', l['icon'] ?? 'i')) + area('content', 'Content', l['content'], 2);
}

function popupFields(l: Record<string, unknown>): string {
  return [
    txt('title', 'Title', l['title']),
    area('body', 'Body (markdown)', l['body'], 5),
    chk('modal', 'Modal', l['modal'] !== false),
  ].join('');
}

function tabsFields(l: Record<string, unknown>): string {
  const tabs = Array.isArray(l['tabs']) ? (l['tabs'] as Record<string, unknown>[]) : [];
  const rows = tabs.map((t, i) => `<div style="display:flex;gap:4px;margin-bottom:4px">
    <input type="text" class="prop-input" data-prop="tabs.${i}.label" value="${esc(t['label'])}" style="${cell}">
    <button class="prop-btn" data-arr-action="del-tab" data-arr-index="${i}" style="border:1px solid var(--color-border);background:none;color:var(--color-text-muted);cursor:pointer;border-radius:4px;padding:0 8px">✕</button>
  </div>`).join('');
  return [
    sel('variant', 'Variant', l['variant'] ?? 'underline', ['underline', 'pills']),
    `<div style="margin-top:6px">${lbl('Tab labels')}${rows}<button class="prop-btn" data-arr-action="add-tab" style="width:100%;padding:4px;border:1px dashed var(--color-border);border-radius:5px;background:none;color:var(--color-text-muted);cursor:pointer;font-size:11px">+ Add tab</button></div>`,
    `<div style="font-size:9px;color:var(--color-text-dim);margin-top:4px">Select a child on the canvas to edit panel contents, or use the Payload editor.</div>`,
  ].join('');
}

function accordionFields(l: Record<string, unknown>): string {
  const items = Array.isArray(l['items']) ? (l['items'] as Record<string, unknown>[]) : [];
  const rows = items.map((it, i) => `<div style="border:1px solid var(--color-border);border-radius:5px;padding:6px;margin-bottom:5px">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:10px;color:var(--color-text-muted)">Item ${i + 1}</span>
    <button class="prop-btn" data-arr-action="del-acc" data-arr-index="${i}" style="border:none;background:none;color:var(--color-text-muted);cursor:pointer;font-size:13px">✕</button></div>
    ${txt(`items.${i}.title`, 'Title', it['title'])}
    ${area(`items.${i}.body`, 'Body', it['body'], 2)}
  </div>`).join('');
  return [
    chk('exclusive', 'Exclusive (one open)', l['exclusive']),
    `<div style="margin-top:6px">${lbl('Items')}${rows}<button class="prop-btn" data-arr-action="add-acc" style="width:100%;padding:4px;border:1px dashed var(--color-border);border-radius:5px;background:none;color:var(--color-text-muted);cursor:pointer;font-size:11px">+ Add item</button></div>`,
  ].join('');
}

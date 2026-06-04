import type { DesignSpec, Layer, DataSource } from '../schema/types';

// Cross-reference validation for interactive reports — the checks that make the
// MCP generation path "legit": catch charts/tables/filters pointing at datasets
// or fields that don't exist, buttons opening modals/tabs/accordions that don't
// exist, and transforms grouping by absent fields. These are the silent-failure
// classes that a shape-only validator (validator.ts) misses.

export interface ReportDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  layer_id?: string;
  fix?: string;
}

const CHART_TYPES = new Set(['bar', 'line', 'area', 'pie', 'donut', 'scatter', 'heatmap', 'funnel', 'waterfall']);

function refId(ref: unknown): string {
  return String(ref ?? '').replace(/^\$data\./, '');
}

// Columns a source exposes: inline/query → row keys; transform → [group_by, value|count].
function sourceColumns(s: DataSource): string[] {
  if (s.type === 'transform') {
    const out = s.agg === 'count' || !s.value ? 'count' : s.value;
    return [s.group_by, out].filter((x): x is string => !!x);
  }
  const rows = (s as { rows?: Record<string, unknown>[] }).rows;
  return Array.isArray(rows) && rows[0] ? Object.keys(rows[0]) : [];
}

// Recursively visit every layer (incl. tabs[].layers, accordion items[].layers,
// popup/group/auto_layout children).
function walk(layers: Layer[] | undefined, visit: (l: Layer) => void): void {
  for (const l of layers ?? []) {
    visit(l);
    const o = l as unknown as Record<string, unknown>;
    if (Array.isArray(o['layers'])) walk(o['layers'] as Layer[], visit);
    if (Array.isArray(o['tabs'])) for (const t of o['tabs'] as Record<string, unknown>[]) walk(t['layers'] as Layer[] | undefined, visit);
    if (Array.isArray(o['items'])) for (const it of o['items'] as Record<string, unknown>[]) walk(it['layers'] as Layer[] | undefined, visit);
  }
}

function allLayers(spec: DesignSpec): Layer[] {
  const flat: Layer[] = [];
  const pages = spec.pages ?? [];
  const top = pages.length ? pages.flatMap(p => p.layers ?? []) : (spec.layers ?? []);
  walk(top, l => flat.push(l));
  return flat;
}

/** Validate an interactive report's cross-references. Returns [] for a clean report. */
export function validateReport(spec: DesignSpec): ReportDiagnostic[] {
  const d: ReportDiagnostic[] = [];
  const sources = spec.report?.data?.sources ?? [];
  const cols = new Map<string, string[]>();
  const ids = new Set<string>();
  for (const s of sources) { cols.set(s.id, sourceColumns(s)); ids.add(s.id); }

  // Transform integrity.
  for (const s of sources) {
    if (s.type !== 'transform') continue;
    if (!s.from || !ids.has(s.from)) {
      d.push({ severity: 'error', code: 'transform-from', message: `transform "${s.id}" reads from "${s.from ?? '(unset)'}" which is not a dataset`, fix: 'Point `from` at an existing dataset id.' });
      continue;
    }
    const up = cols.get(s.from) ?? [];
    if (s.group_by && up.length && !up.includes(s.group_by)) d.push({ severity: 'warning', code: 'transform-groupby', message: `transform "${s.id}" groups by "${s.group_by}" not in "${s.from}"`, fix: `Use one of: ${up.join(', ')}` });
    if (s.value && s.agg !== 'count' && up.length && !up.includes(s.value)) d.push({ severity: 'warning', code: 'transform-value', message: `transform "${s.id}" aggregates "${s.value}" not in "${s.from}"`, fix: `Use one of: ${up.join(', ')}` });
  }

  const layers = allLayers(spec);
  const layerIds = new Set(layers.map(l => l.id));

  const checkField = (id: string, ref: string, field: unknown, label: string): void => {
    const c = cols.get(ref);
    if (!field || !c || !c.length) return; // unknown columns → don't false-flag
    if (!c.includes(String(field))) d.push({ severity: 'warning', code: 'field-missing', message: `${label} "${String(field)}" not in dataset "${ref}"`, layer_id: id, fix: `Available: ${c.join(', ')}` });
  };

  for (const l of layers) {
    const o = l as unknown as Record<string, unknown>;
    switch (l.type) {
      case 'interactive_chart':
      case 'interactive_table': {
        const ref = refId(o['data_ref']);
        if (!ref) { d.push({ severity: 'error', code: 'data-ref-missing', message: `${l.type} "${l.id}" has no data_ref`, layer_id: l.id, fix: 'Set data_ref to a dataset id.' }); break; }
        if (!ids.has(ref)) { d.push({ severity: 'error', code: 'data-ref-unknown', message: `${l.type} "${l.id}" → data_ref "${ref}" is not a declared dataset`, layer_id: l.id, fix: `Declared: ${[...ids].join(', ') || '(none — call bind_data)'}` }); break; }
        if (l.type === 'interactive_chart') {
          if (o['chart_type'] && !CHART_TYPES.has(String(o['chart_type']))) d.push({ severity: 'warning', code: 'chart-type', message: `chart "${l.id}" has unknown chart_type "${String(o['chart_type'])}"`, layer_id: l.id, fix: `Use: ${[...CHART_TYPES].join(', ')}` });
          if (o['library'] === 'plotly' && o['chart_type'] === 'heatmap' && !o['plotly_spec'] && !o['color_field']) d.push({ severity: 'warning', code: 'heatmap-spec', message: `plotly heatmap "${l.id}" needs plotly_spec or a color_field`, layer_id: l.id, fix: 'Add plotly_spec:{data,layout} or set color_field.' });
          checkField(l.id, ref, o['x_field'], 'chart x_field');
          checkField(l.id, ref, o['y_field'], 'chart y_field');
          checkField(l.id, ref, o['color_field'], 'chart color_field');
        } else {
          for (const c of (Array.isArray(o['columns']) ? o['columns'] as Record<string, unknown>[] : [])) checkField(l.id, ref, c['field'], 'table column field');
          if (o['row_detail_title']) checkField(l.id, ref, o['row_detail_title'], 'row_detail_title');
        }
        break;
      }
      case 'filter_bar': {
        if (o['options_from'] && !ids.has(refId(o['options_from']))) d.push({ severity: 'warning', code: 'filter-options', message: `filter_bar "${l.id}" options_from "${String(o['options_from'])}" is not a dataset`, layer_id: l.id });
        const field = o['field'];
        if (field) {
          const inAny = [...cols.values()].some(c => c.includes(String(field)));
          if (cols.size && !inAny) d.push({ severity: 'warning', code: 'filter-field', message: `filter_bar "${l.id}" field "${String(field)}" is not in any dataset`, layer_id: l.id, fix: 'It filters tables/charts by this key; ensure they share it.' });
        }
        break;
      }
      case 'button': {
        const target = actionTarget(o['action']);
        if (target && target.kind === 'open_modal' && !layerIds.has(target.id)) d.push({ severity: 'warning', code: 'action-modal', message: `button "${l.id}" opens modal "${target.id}" which has no layer`, layer_id: l.id, fix: 'Add a popup layer with that id (modal:true).' });
        if (target && target.kind === 'scroll_to' && !layerIds.has(target.id)) d.push({ severity: 'warning', code: 'action-scroll', message: `button "${l.id}" scrolls to "${target.id}" which has no layer`, layer_id: l.id });
        break;
      }
      case 'callout': {
        // `content` is canonical; `text` is a tolerated alias. Empty = a blank box.
        const body = o['content'] ?? o['text'];
        if (body == null || String(body).trim() === '') d.push({ severity: 'warning', code: 'callout-empty', message: `callout "${l.id}" has no content`, layer_id: l.id, fix: 'Set `content` to the callout body text.' });
        break;
      }
      case 'tabs': if (!Array.isArray(o['tabs']) || !o['tabs'].length) d.push({ severity: 'warning', code: 'tabs-empty', message: `tabs "${l.id}" has no tabs`, layer_id: l.id }); break;
      case 'accordion': if (!Array.isArray(o['items']) || !o['items'].length) d.push({ severity: 'warning', code: 'accordion-empty', message: `accordion "${l.id}" has no items`, layer_id: l.id }); break;
      case 'toggle': if (!Array.isArray(o['options']) || !o['options'].length) d.push({ severity: 'warning', code: 'toggle-empty', message: `toggle "${l.id}" has no options`, layer_id: l.id }); break;
      default: break;
    }
  }

  // Duplicate layer ids corrupt selection, the render cache, and data-layer-id
  // hooks. The classic cause: separate add_layers batches each restart numbering
  // (rect_1, text_2, …) so the second batch collides with the first.
  const counts = new Map<string, number>();
  for (const l of layers) counts.set(l.id, (counts.get(l.id) ?? 0) + 1);
  for (const [id, n] of counts) if (n > 1) d.push({ severity: 'error', code: 'dup-layer-id', message: `layer id "${id}" used ${n}× — ids must be unique`, layer_id: id, fix: 'Rename the collisions (add_layers now auto-dedupes new ids).' });

  // Content split across pages[] AND a top-level layers[] array: the editor
  // renders the page, the SVG renderer prefers top-level → half the report is
  // invisible in one view or the other. A report keeps all content in its page.
  const topCount = spec.layers?.length ?? 0;
  if ((spec.pages?.length ?? 0) > 0 && topCount > 0) d.push({ severity: 'error', code: 'layers-split', message: `design has pages[] AND ${topCount} top-level layer(s) — they will not all render`, fix: 'Move top-level layers into a page (add_layers with page_id).' });

  return d;
}

function actionTarget(action: unknown): { kind: string; id: string } | null {
  let str = '';
  if (typeof action === 'string') str = action;
  else if (action && typeof action === 'object') { const a = action as Record<string, unknown>; str = a['target'] ? `${a['type']}:${a['target']}` : String(a['type'] ?? ''); }
  const [kind, ...rest] = str.split(':');
  const id = rest.join(':').split('=')[0].split(':')[0];
  return kind ? { kind, id } : null;
}

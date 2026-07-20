import { describe, it, expect } from 'vitest';
import { assembleReportHTML } from './html-assembler';
import type { DesignSpec, Layer } from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';

function flowSpec(layers: Layer[]): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'c1', name: 'Components', type: 'report', created: '', modified: '' },
    document: { width: 1200, height: 100, unit: 'px' },
    pages: [{ id: 'p', label: 'P', layers }],
    report: { layout: 'flow', accent: '#f5c842', data: { sources: [
      { id: 'ds', type: 'inline', rows: [
        { k: 'A', sector: 'X', v: 1 }, { k: 'B', sector: 'Y', v: 2 }, { k: 'C', sector: 'X', v: 3 },
      ] },
    ] } },
  } as unknown as DesignSpec;
}
const ds = new Map<string, LoadedDataset>([['ds', { id: 'ds', rows: [
  { k: 'A', sector: 'X', v: 1 }, { k: 'B', sector: 'Y', v: 2 }, { k: 'C', sector: 'X', v: 3 },
] }]]);
const html = (layers: Layer[]): string => assembleReportHTML(flowSpec(layers), ds);

describe('interactive components — export', () => {
  it('button emits a data-folio-action trigger', () => {
    const h = html([{ id: 'b', type: 'button', z: 0, span: 3, label: 'Open', action: 'open_modal:m1' } as unknown as Layer]);
    expect(h).toContain('class="ic-btn');
    expect(h).toContain('data-folio-action="open_modal:m1"');
    expect(h).toContain('Open');
  });

  it('button accepts a structured ControlAction', () => {
    const h = html([{ id: 'b', type: 'button', z: 0, label: 'Set', action: { type: 'set', target: 'view', value: 'detail' } } as unknown as Layer]);
    expect(h).toContain('data-folio-action="set:view=detail"');
  });

  it('popup renders a hidden modal with a close trigger', () => {
    const h = html([{ id: 'm1', type: 'popup', z: 0, modal: true, title: 'Details', body: 'Hello' } as unknown as Layer]);
    expect(h).toContain('class="ic-modal"');
    expect(h).toContain('id="m1"');
    expect(h).toContain('data-folio-action="close_modal:m1"');
  });

  it('tabs render a tab bar + panels that recurse into child layers', () => {
    const h = html([{ id: 't', type: 'tabs', z: 0, tabs: [
      { label: 'One', layers: [{ id: 'k', type: 'kpi_card', z: 0, label: 'X', value: 1 }] },
      { label: 'Two', layers: [] },
    ] } as unknown as Layer]);
    expect(h).toContain('class="ic-tabs');
    expect(h).toContain('data-folio-action="tab:tabs-t:');
    expect(h).toContain('ic-tab-panel');
    expect(h).toContain('ic-kpi'); // child rendered inside a panel
  });

  it('accordion renders items with toggle triggers', () => {
    const h = html([{ id: 'a', type: 'accordion', z: 0, exclusive: true, items: [
      { title: 'Sec 1', body: 'body one', open: true }, { title: 'Sec 2', body: 'two' },
    ] } as unknown as Layer]);
    expect(h).toContain('class="ic-accordion"');
    expect(h).toContain('data-folio-action="accordion:acc-a-0"');
    expect(h).toContain('data-acc-group="acc-a"'); // exclusive
    expect(h).toContain('Sec 1');
  });

  it('filter_bar emits chips with filter actions + multi flag', () => {
    const h = html([{ id: 'f', type: 'filter_bar', z: 0, field: 'sector', multi: true, options: ['X', 'Y'] } as unknown as Layer]);
    expect(h).toContain('data-folio-action="filter:sector:X"');
    expect(h).toContain('data-multi="1"');
    expect(h).toContain('data-folio-action="filter:sector:__all__"'); // include_all default
  });

  it('filter_bar can derive options from a dataset', () => {
    const h = html([{ id: 'f', type: 'filter_bar', z: 0, field: 'sector', options_from: 'ds' } as unknown as Layer]);
    expect(h).toContain('data-filter-value="X"');
    expect(h).toContain('data-filter-value="Y"');
  });

  it('toggle renders a segmented control bound to a state key', () => {
    const h = html([{ id: 'tg', type: 'toggle', z: 0, state_key: 'view', options: ['Summary', 'Detail'] } as unknown as Layer]);
    expect(h).toContain('data-folio-action="set:view=Summary"');
    expect(h).toContain('data-seg-group="view"');
  });

  it('callout + progress + tooltip render', () => {
    const h = html([
      { id: 'c', type: 'callout', z: 0, variant: 'warning', content: 'be careful' } as unknown as Layer,
      { id: 'p', type: 'progress', z: 0, value: 72, label: 'Done' } as unknown as Layer,
      { id: 'pr', type: 'progress', z: 0, value: 50, style: 'radial' } as unknown as Layer,
      { id: 'tip', type: 'tooltip', z: 0, content: 'hint' } as unknown as Layer,
    ]);
    expect(h).toContain('ic-callout-warning');
    expect(h).toContain('ic-prog-fill');
    expect(h).toContain('ic-prog-radial');
    expect(h).toContain('ic-tip-pop');
  });

  it('chart `kind` alias is accepted as chart_type (not a blank canvas)', () => {
    const h = html([{ id: 'ck', type: 'interactive_chart', z: 0, kind: 'bar', data_ref: 'ds', x_field: 'k', y_field: 'v' } as unknown as Layer]);
    // The Chart.js config must carry a concrete type, not undefined/null.
    expect(h).toContain('"type":"bar"');
    expect(h).not.toMatch(/"type":(null|undefined)/);
  });

  it('table column `label` alias renders a header title (not "undefined")', () => {
    const h = html([{ id: 't', type: 'interactive_table', z: 0, data_ref: 'ds',
      columns: [{ field: 'k', label: 'Ticker' }, { field: 'v', label: 'Value' }] } as unknown as Layer]);
    // The serialized columns the runtime reads must carry title from the label.
    expect(h).toContain('"title":"Ticker"');
    expect(h).toContain('"title":"Value"');
  });

  it('charts register reactive metadata + the runtime exposes Folio.filters', () => {
    const h = html([{ id: 'ch', type: 'interactive_chart', z: 0, chart_type: 'bar', data_ref: 'ds', x_field: 'k', y_field: 'v' } as unknown as Layer]);
    expect(h).toContain('window.__folioCharts');
    expect(h).toContain('Folio.applyFilters');
    expect(h).toContain('data-folio-action'); // dispatcher present
  });

  it('table row_detail emits a clickable table + a hidden detail modal', () => {
    const h = html([{ id: 't', type: 'interactive_table', z: 0, data_ref: 'ds', row_detail: true,
      columns: [{ field: 'k', title: 'K' }, { field: 'v', title: 'V' }] } as unknown as Layer]);
    expect(h).toContain('ic-table-clickable');
    expect(h).toContain('id="table-t-rowmodal"');
    expect(h).toContain('rowDetail: true');
    expect(h).toContain('openRowDetail'); // runtime present
  });

  it('library:plotly charts load Plotly + register the reactive registry', () => {
    const h = html([{ id: 'p', type: 'interactive_chart', z: 0, library: 'plotly', chart_type: 'bar', data_ref: 'ds', x_field: 'k', y_field: 'v' } as unknown as Layer]);
    expect(h).toContain('cdn.plot.ly');
    expect(h).toContain('window.__folioPlotly');
    expect(h).toContain('class="ic-plotly"');
    expect(h).not.toContain('chart.umd.min.js'); // no Chart.js when only plotly used
  });

  it('plotly_spec passes a raw chart through', () => {
    const h = html([{ id: 'p', type: 'interactive_chart', z: 0, library: 'plotly', chart_type: 'heatmap', data_ref: 'ds',
      plotly_spec: { data: [{ type: 'heatmap', z: [[1, 2], [3, 4]] }] } } as unknown as Layer]);
    expect(h).toContain('"type":"heatmap"');
    expect(h).toContain('raw:');
  });
});

describe('interactive components — degrade instead of crashing the export', () => {
  it('derives table columns from the data when none are declared', () => {
    // `layer.columns[0]` threw a raw TypeError, so ONE table without an
    // explicit column list meant no HTML file at all — for a design
    // report(op:validate) had just passed as clean.
    const out = html([{ id: 't', type: 'interactive_table', span: 12, data_ref: 'ds' } as unknown as Layer]);
    expect(out).toContain('"field":"k"');
    expect(out).toContain('"field":"sector"');
    expect(out).toContain('"field":"v"');
  });

  it('still honours an explicit column list', () => {
    const out = html([{
      id: 't', type: 'interactive_table', span: 12, data_ref: 'ds',
      columns: [{ field: 'k', title: 'Key' }],
    } as unknown as Layer]);
    expect(out).toContain('"title":"Key"');
    expect(out).not.toContain('"field":"sector"');
  });

  it('renders a chart with no data_ref as empty rather than throwing', () => {
    expect(() => html([{ id: 'c', type: 'interactive_chart', span: 12, chart_type: 'bar' } as unknown as Layer]))
      .not.toThrow();
  });

  it('renders a table with no data_ref as empty rather than throwing', () => {
    expect(() => html([{ id: 't', type: 'interactive_table', span: 12 } as unknown as Layer]))
      .not.toThrow();
  });

  it('produces a usable document even when every binding is missing', () => {
    const out = html([
      { id: 'c', type: 'interactive_chart', span: 6 } as unknown as Layer,
      { id: 't', type: 'interactive_table', span: 6 } as unknown as Layer,
    ]);
    expect(out).toContain('<!DOCTYPE html>');
    expect(out.length).toBeGreaterThan(500);
  });
});

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

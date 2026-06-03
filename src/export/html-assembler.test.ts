import { describe, it, expect } from 'vitest';
import { assembleReportHTML } from './html-assembler';
import type { DesignSpec } from '../schema/types';
import type { LoadedDataset } from '../report/data-loader';

function makeReportSpec(pageCount = 2): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'r1', name: 'My Report', type: 'report', created: '', modified: '' },
    document: { width: 1080, height: 1080, unit: 'px' },
    pages: Array.from({ length: pageCount }, (_, i) => ({
      id: `p${i + 1}`,
      label: `Page ${i + 1}`,
      layers: [],
    })),
    report: {
      layout: 'paged',
      navigation: { type: 'sidebar' },
    },
  } as unknown as DesignSpec;
}

const emptyDatasets = new Map<string, LoadedDataset>();

describe('assembleReportHTML', () => {
  it('returns a DOCTYPE HTML string', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
  });

  it('embeds the report title', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets);
    expect(html).toContain('My Report');
  });

  it('renders one section per page', () => {
    const html = assembleReportHTML(makeReportSpec(3), emptyDatasets);
    const matches = html.match(/class="folio-page/g);
    expect(matches?.length).toBe(3);
  });

  it('first section has active class', () => {
    const html = assembleReportHTML(makeReportSpec(2), emptyDatasets);
    expect(html).toContain('folio-page active');
  });

  it('includes sidebar nav for sidebar layout', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets);
    expect(html).toContain('folio-sidebar');
  });

  it('applies layout-scroll class for scroll layout', () => {
    const spec = makeReportSpec();
    spec.report!.layout = 'scroll';
    const html = assembleReportHTML(spec, emptyDatasets);
    expect(html).toContain('layout-scroll');
  });

  it('applies layout-tabs class for tabs layout', () => {
    const spec = makeReportSpec();
    spec.report!.layout = 'tabs';
    const html = assembleReportHTML(spec, emptyDatasets);
    expect(html).toContain('layout-tabs');
  });

  it('embeds the runtime JS navigation', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets);
    expect(html).toContain('window.Folio');
  });

  it('embeds design meta as JSON', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets);
    expect(html).toContain('folio-design');
    expect(html).toContain('"pageCount":2');
  });

  it('respects light theme option', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets, { theme: 'light' });
    expect(html).toContain('data-theme="light"');
  });

  it('sets data-theme on <body> so the light-theme CSS actually applies', () => {
    const html = assembleReportHTML(makeReportSpec(), emptyDatasets, { theme: 'light' });
    expect(html).toMatch(/<body class="[^"]*"\s+data-theme="light"/);
  });

  it('resolves $data.* expressions via datasets', () => {
    const spec = makeReportSpec(1);
    (spec.pages as NonNullable<typeof spec.pages>)[0].layers = [{ id: 'k', type: 'kpi_card', z: 0, label: 'Total', value: '$agg.sales.sum(amount)' }] as unknown as DesignSpec['layers'];
    const datasets = new Map<string, LoadedDataset>([
      ['sales', { id: 'sales', rows: [{ amount: 100 }, { amount: 200 }] }],
    ]);
    const html = assembleReportHTML(spec, datasets);
    // Should not throw; HTML should contain the section
    expect(html).toContain('folio-page');
  });

  it('handles spec with no pages gracefully', () => {
    const spec = makeReportSpec(0);
    const html = assembleReportHTML(spec, emptyDatasets);
    expect(html).toContain('<!DOCTYPE html>');
  });

  it('handles spec with no report section', () => {
    const spec = makeReportSpec();
    delete (spec as unknown as Record<string, unknown>)['report'];
    const html = assembleReportHTML(spec, emptyDatasets);
    expect(html).toContain('<!DOCTYPE html>');
  });
});

function makeFlowSpec(): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'f1', name: 'Flow Report', type: 'report', created: '', modified: '' },
    document: { width: 1200, height: 100, unit: 'px' },
    pages: [{
      id: 'overview', label: 'Overview', layers: [
        { id: 'h', type: 'rich_text', z: 0, span: 12, font_family: 'Playfair Display', content: '**Title**', format: 'markdown' },
        { id: 'k1', type: 'kpi_card', z: 0, label: 'Revenue', value: 1000, format: 'number' },
        { id: 'c1', type: 'interactive_chart', z: 0, span: 8, height: 320, chart_type: 'line', data_ref: 'd', x_field: 'x', y_field: 'y' },
        { id: 't1', type: 'interactive_table', z: 0, data_ref: 'd', columns: [{ field: 'x', title: 'X' }] },
      ],
    }],
    report: { layout: 'flow', max_width: 1180, accent: '#f5c842', font_heading: 'Playfair Display', font_body: 'Inter' },
  } as unknown as DesignSpec;
}

describe('assembleReportHTML — flow layout', () => {
  const ds = new Map<string, LoadedDataset>([['d', { id: 'd', rows: [{ x: 'Jan', y: 1 }, { x: 'Feb', y: 2 }] }]]);

  it('emits the responsive flow grid, not the fixed-canvas stage', () => {
    const html = assembleReportHTML(makeFlowSpec(), ds);
    expect(html).toContain('layout-flow');
    expect(html).toContain('folio-flow-grid');
    expect(html).toContain('grid-column:span');
    expect(html).not.toContain('class="folio-page-stage"');
  });

  it('applies max_width, accent, and editorial fonts', () => {
    const html = assembleReportHTML(makeFlowSpec(), ds);
    expect(html).toContain('--folio-maxw:1180px');
    expect(html).toContain('--ic-accent:#f5c842');
    expect(html).toContain('Playfair+Display');
    expect(html).toContain('Inter');
  });

  it('defaults grid spans by layer type (kpi=3, chart=8 explicit, table=12)', () => {
    const html = assembleReportHTML(makeFlowSpec(), ds);
    expect(html).toContain('grid-column:span 3'); // kpi default
    expect(html).toContain('grid-column:span 8'); // chart explicit
    expect(html).toContain('grid-column:span 12'); // table default + rich_text
  });

  it('seeds the chart palette with the report accent', () => {
    const html = assembleReportHTML(makeFlowSpec(), ds);
    expect(html).toContain('#f5c842'); // accent reaches chart config / css
    expect(html).toContain('Chart.js');
  });

  it('lets scroll and flow layouts grow the document (no inner-scroll clip)', () => {
    const html = assembleReportHTML(makeFlowSpec(), ds);
    expect(html).toContain('body.layout-scroll #folio-report,body.layout-flow #folio-report{overflow:visible}');
  });

  it('honours report.flow:true even when layout is not "flow"', () => {
    const spec = makeFlowSpec();
    (spec.report as unknown as { layout: string }).layout = 'scroll';
    (spec.report as unknown as { flow: boolean }).flow = true;
    const html = assembleReportHTML(spec, ds);
    expect(html).toContain('layout-flow');
    expect(html).toContain('folio-flow-grid');
  });
});

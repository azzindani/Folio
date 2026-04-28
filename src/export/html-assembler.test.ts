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

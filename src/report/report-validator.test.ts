import { describe, it, expect } from 'vitest';
import { validateReport } from './report-validator';
import type { DesignSpec, Layer, DataSource } from '../schema/types';

function report(layers: Layer[], sources: DataSource[] = []): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'r', name: 'R', type: 'report', created: '', modified: '' },
    document: { width: 1200, height: 100, unit: 'px' },
    pages: [{ id: 'p', label: 'P', layers }],
    report: { layout: 'flow', data: { sources } },
  } as unknown as DesignSpec;
}
const stocks: DataSource = { id: 'stocks', type: 'inline', rows: [{ ticker: 'BBRI', sector: 'Banking', yield: 6.8 }] };
const codes = (d: ReturnType<typeof validateReport>): string[] => d.map(x => x.code);
const L = (o: Record<string, unknown>): Layer => ({ z: 0, ...o }) as unknown as Layer;

describe('validateReport', () => {
  it('returns no diagnostics for a well-formed report', () => {
    const d = validateReport(report([
      L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'stocks', x_field: 'ticker', y_field: 'yield' }),
      L({ id: 'b', type: 'button', action: 'open_modal:m1' }),
      L({ id: 'm1', type: 'popup', modal: true, title: 'X' }),
    ], [stocks]));
    expect(d).toEqual([]);
  });

  it('flags a chart with no data_ref (error) and an unknown data_ref (error)', () => {
    expect(codes(validateReport(report([L({ id: 'c', type: 'interactive_chart', chart_type: 'bar' })], [stocks])))).toContain('data-ref-missing');
    expect(codes(validateReport(report([L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'ghost' })], [stocks])))).toContain('data-ref-unknown');
  });

  it('warns when a chart field is not in its dataset', () => {
    const d = validateReport(report([L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'stocks', x_field: 'ticker', y_field: 'nope' })], [stocks]));
    expect(codes(d)).toContain('field-missing');
    expect(d.find(x => x.code === 'field-missing')?.message).toContain('nope');
  });

  it('strips a $data. prefix on data_ref', () => {
    expect(validateReport(report([L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: '$data.stocks', x_field: 'ticker', y_field: 'yield' })], [stocks]))).toEqual([]);
  });

  it('warns on a button opening a modal that does not exist, accepts one that does', () => {
    expect(codes(validateReport(report([L({ id: 'b', type: 'button', action: 'open_modal:ghost' })], [stocks])))).toContain('action-modal');
    expect(codes(validateReport(report([L({ id: 'b', type: 'button', action: 'open_modal:m1' }), L({ id: 'm1', type: 'popup', modal: true })], [stocks])))).not.toContain('action-modal');
  });

  it('validates a transform: missing from is an error, bad group field warns', () => {
    const dErr = validateReport(report([], [stocks, { id: 't', type: 'transform', from: 'ghost', group_by: 'sector', agg: 'avg', value: 'yield' }]));
    expect(codes(dErr)).toContain('transform-from');
    const dWarn = validateReport(report([], [stocks, { id: 't', type: 'transform', from: 'stocks', group_by: 'nope', agg: 'avg', value: 'yield' }]));
    expect(codes(dWarn)).toContain('transform-groupby');
  });

  it('recognizes a transform output as a bindable dataset (no false field-missing)', () => {
    const d = validateReport(report([
      L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'bySector', x_field: 'sector', y_field: 'yield' }),
    ], [stocks, { id: 'bySector', type: 'transform', from: 'stocks', group_by: 'sector', agg: 'avg', value: 'yield' }]));
    expect(d).toEqual([]);
  });

  it('warns when a filter_bar field is in no dataset', () => {
    expect(codes(validateReport(report([L({ id: 'f', type: 'filter_bar', field: 'ghost', multi: true })], [stocks])))).toContain('filter-field');
    expect(codes(validateReport(report([L({ id: 'f', type: 'filter_bar', field: 'sector', multi: true })], [stocks])))).not.toContain('filter-field');
  });

  it('validates layers nested inside tabs', () => {
    const d = validateReport(report([
      L({ id: 't', type: 'tabs', tabs: [{ label: 'A', layers: [L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'ghost' })] }] }),
    ], [stocks]));
    expect(codes(d)).toContain('data-ref-unknown');
  });

  it('flags a chart with no x/y field (renders empty), accepts the x/y string aliases', () => {
    expect(codes(validateReport(report([L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'stocks' })], [stocks])))).toContain('chart-fields-missing');
    // `x`/`y` strings are tolerated aliases for x_field/y_field → not flagged.
    expect(codes(validateReport(report([L({ id: 'c', type: 'interactive_chart', chart: 'bar', data_ref: 'stocks', x: 'ticker', y: 'yield' })], [stocks])))).not.toContain('chart-fields-missing');
  });

  it('flags a callout with no content, accepts the text alias', () => {
    expect(codes(validateReport(report([L({ id: 'c', type: 'callout', variant: 'info' })], [stocks])))).toContain('callout-empty');
    expect(codes(validateReport(report([L({ id: 'c', type: 'callout', variant: 'info', text: 'hi' })], [stocks])))).not.toContain('callout-empty');
    expect(codes(validateReport(report([L({ id: 'c', type: 'callout', variant: 'info', content: 'hi' })], [stocks])))).not.toContain('callout-empty');
  });

  it('flags duplicate layer ids', () => {
    const d = validateReport(report([
      L({ id: 'rect_1', type: 'rect' }),
      L({ id: 'rect_1', type: 'rect' }),
    ], [stocks]));
    expect(codes(d)).toContain('dup-layer-id');
    expect(d.find(x => x.code === 'dup-layer-id')?.severity).toBe('error');
  });

  it('flags content split across pages[] and top-level layers[]', () => {
    const spec = {
      _protocol: 'design/v1',
      meta: { id: 'r', name: 'R', type: 'report', created: '', modified: '' },
      document: { width: 1200, height: 100, unit: 'px' },
      pages: [{ id: 'p', label: 'P', layers: [L({ id: 'a', type: 'rect' })] }],
      layers: [L({ id: 'b', type: 'rect' })],
      report: { layout: 'flow', data: { sources: [stocks] } },
    } as unknown as Parameters<typeof validateReport>[0];
    expect(codes(validateReport(spec))).toContain('layers-split');
  });

  // These three all shipped as controls that RENDER but do nothing — the class
  // of bug the live preview surfaced. Silence was the actual defect.
  it('flags a rich_text with no text under either field name', () => {
    const d = validateReport(report([
      L({ id: 'r1', type: 'rich_text' }),
      L({ id: 'r2', type: 'rich_text', content: '   ' }),
    ], [stocks]));
    expect(codes(d).filter(c => c === 'richtext-empty')).toHaveLength(2);
  });

  it('accepts `body` as an alias for rich_text content', () => {
    const d = validateReport(report([L({ id: 'r', type: 'rich_text', body: 'real text' })], [stocks]));
    expect(codes(d)).not.toContain('richtext-empty');
  });

  it('flags tabs whose panels are all empty', () => {
    // Tab bodies come from `layers`; prose on `content` silently vanishes.
    const d = validateReport(report([
      L({ id: 't', type: 'tabs', tabs: [{ id: 'a', label: 'A', content: 'lost' }, { id: 'b', label: 'B', content: 'lost' }] }),
    ], [stocks]));
    expect(codes(d)).toContain('tabs-hollow');
  });

  it('does not flag tabs that have real panel layers', () => {
    const d = validateReport(report([
      L({ id: 't', type: 'tabs', tabs: [{ id: 'a', label: 'A', layers: [L({ id: 'x', type: 'rich_text', content: 'hi' })] }] }),
    ], [stocks]));
    expect(codes(d)).not.toContain('tabs-hollow');
  });

  it('flags a filter_bar with no field or options', () => {
    const d = validateReport(report([L({ id: 'f', type: 'filter_bar' })], [stocks]));
    expect(codes(d)).toEqual(expect.arrayContaining(['filter-no-field', 'filter-no-options']));
  });

  it('flags empty tabs/accordion/toggle', () => {
    const d = validateReport(report([
      L({ id: 't', type: 'tabs', tabs: [] }),
      L({ id: 'a', type: 'accordion', items: [] }),
      L({ id: 'g', type: 'toggle', options: [] }),
    ], [stocks]));
    expect(codes(d)).toEqual(expect.arrayContaining(['tabs-empty', 'accordion-empty', 'toggle-empty']));
  });
});

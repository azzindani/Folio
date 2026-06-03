import { describe, it, expect } from 'vitest';
import { renderReportFields, hasReportFields, type DatasetInfo } from './report-fields';
import type { Layer } from '../../schema/types';

const ds: DatasetInfo[] = [{ id: 'stocks', columns: ['ticker', 'sector', 'yield', 'mcap'] }];
const L = (o: Record<string, unknown>): Layer => ({ z: 0, ...o }) as unknown as Layer;

describe('hasReportFields', () => {
  it('claims the interactive component types and not basic shapes', () => {
    for (const t of ['interactive_chart', 'interactive_table', 'kpi_card', 'button', 'tabs', 'accordion', 'filter_bar', 'toggle', 'callout', 'progress', 'tooltip', 'popup', 'rich_text'])
      expect(hasReportFields(t)).toBe(true);
    for (const t of ['rect', 'circle', 'text', 'line', 'image']) expect(hasReportFields(t)).toBe(false);
  });
});

describe('chart fields', () => {
  const h = renderReportFields(L({ id: 'c', type: 'interactive_chart', chart_type: 'bar', data_ref: 'stocks', x_field: 'ticker', y_field: 'yield' }), ds);
  it('emits chart_type, library, data_ref, and field pickers', () => {
    expect(h).toContain('data-prop="chart_type"');
    expect(h).toContain('data-prop="library"');
    expect(h).toContain('data-prop="data_ref"');
    expect(h).toContain('data-prop="x_field"');
    expect(h).toContain('data-prop="color_field"');
  });
  it('field pickers list the dataset columns', () => {
    expect(h).toContain('<option value="sector"');
    expect(h).toContain('<option value="mcap"');
  });
  it('selects the current chart_type', () => {
    expect(h).toMatch(/<option value="bar" selected>/);
  });
});

describe('table fields', () => {
  const h = renderReportFields(L({ id: 't', type: 'interactive_table', data_ref: 'stocks',
    columns: [{ field: 'ticker', title: 'Ticker', align: 'left' }, { field: 'yield', title: 'Yield', formatter: 'number', align: 'right' }] }), ds);
  it('renders per-column editors with dotted data-props + add/remove controls', () => {
    expect(h).toContain('data-prop="columns.0.field"');
    expect(h).toContain('data-prop="columns.1.formatter"');
    expect(h).toContain('data-arr-action="del-col" data-arr-index="1"');
    expect(h).toContain('data-arr-action="add-col"');
  });
  it('exposes the boolean table options as checkboxes', () => {
    expect(h).toContain('class="prop-check" data-prop="row_detail"');
    expect(h).toContain('data-prop="filterable"');
  });
});

describe('other component fields', () => {
  it('button → label, variant, action', () => {
    const h = renderReportFields(L({ id: 'b', type: 'button', label: 'Open', variant: 'solid', action: 'open_modal:m1' }), ds);
    expect(h).toContain('data-prop="action"');
    expect(h).toContain('value="open_modal:m1"');
    expect(h).toMatch(/<option value="solid" selected>/);
  });
  it('button serializes an object action back to the sugar string', () => {
    const h = renderReportFields(L({ id: 'b', type: 'button', action: { type: 'set', target: 'view', value: 'detail' } }), ds);
    expect(h).toContain('value="set:view=detail"');
  });
  it('toggle → options array editor', () => {
    const h = renderReportFields(L({ id: 'g', type: 'toggle', state_key: 'view', options: ['A', 'B'] }), ds);
    expect(h).toContain('data-prop="options.0"');
    expect(h).toContain('data-arr-action="add-opt"');
  });
  it('accordion → item title/body editors', () => {
    const h = renderReportFields(L({ id: 'a', type: 'accordion', items: [{ title: 'S1', body: 'b' }] }), ds);
    expect(h).toContain('data-prop="items.0.title"');
    expect(h).toContain('data-prop="items.0.body"');
    expect(h).toContain('data-arr-action="add-acc"');
  });
  it('filter_bar → options_from picks from datasets', () => {
    const h = renderReportFields(L({ id: 'f', type: 'filter_bar', field: 'sector', options_from: 'stocks' }), ds);
    expect(h).toContain('data-prop="options_from"');
    expect(h).toMatch(/<option value="stocks" selected>/);
  });
});

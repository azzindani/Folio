import { describe, it, expect } from 'vitest';
import { expandShorthand } from './shorthand-expand';
import type { ShorthandLayer } from './shorthand-helpers';

const expand = (sh: Record<string, unknown>): Record<string, unknown> =>
  expandShorthand(sh as unknown as ShorthandLayer) as unknown as Record<string, unknown>;

describe('unknown layer types keep their fields', () => {
  it('carries interactive_chart bindings through expansion', () => {
    // These were dropped: the default branch claimed to "pass through as-is"
    // but returned geometry only, so a flow report authored exactly as the
    // engine guide documents lost data_ref/chart_type/x_field on the way in,
    // rendered empty, and then crashed the HTML export.
    const out = expand({
      type: 'interactive_chart', id: 'c1', span: 12, flow_h: 340,
      chart_type: 'bar', data_ref: 'exports', x_field: 'format', y_field: 'kb',
      title: 'Export size',
    });
    expect(out['data_ref']).toBe('exports');
    expect(out['chart_type']).toBe('bar');
    expect(out['x_field']).toBe('format');
    expect(out['y_field']).toBe('kb');
    expect(out['title']).toBe('Export size');
  });

  it('carries table and callout fields', () => {
    const table = expand({ type: 'interactive_table', id: 't1', span: 12, data_ref: 'ds', filterable: true, exportable: true });
    expect(table['data_ref']).toBe('ds');
    expect(table['filterable']).toBe(true);

    const callout = expand({ type: 'callout', id: 'cal', span: 12, content: 'Body text', variant: 'info' });
    expect(callout['content']).toBe('Body text');
    expect(callout['variant']).toBe('info');
  });

  it('does not duplicate geometry keys already consumed into the base', () => {
    const out = expand({ type: 'interactive_table', id: 't', pos: [10, 20, 30, 40], data_ref: 'ds' });
    expect(out['pos']).toBeUndefined();
    expect(out['x']).toBe(10);
    expect(out['width']).toBe(30);
  });
});

describe('flow grid placement survives expansion', () => {
  it('keeps span and flow_h on a KNOWN type', () => {
    // kpi_card has its own expander case, so it needs span from the shared base
    // — without it add_layers rejected the whole call with "needs a positive
    // width" for a report layer that is sized by grid span, not pixels.
    const out = expand({ type: 'kpi_card', id: 'k1', span: 4, label: 'Tools', value: '21' });
    expect(out['span']).toBe(4);
    expect(out['label']).toBe('Tools');
  });

  it('keeps span on an unknown type', () => {
    expect(expand({ type: 'interactive_chart', id: 'c', span: 6, flow_h: 300 })['span']).toBe(6);
    expect(expand({ type: 'interactive_chart', id: 'c', span: 6, flow_h: 300 })['flow_h']).toBe(300);
  });

  it('ignores a nonsensical span rather than storing it', () => {
    expect(expand({ type: 'interactive_table', id: 't', span: 0 })['span']).toBeUndefined();
  });

  it('leaves ordinary pixel-positioned layers untouched', () => {
    const out = expand({ type: 'rect', id: 'r', pos: [0, 0, 100, 50], fill: '#fff' });
    expect(out['span']).toBeUndefined();
    expect(out['width']).toBe(100);
  });
});

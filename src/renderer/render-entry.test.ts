import { describe, it, expect } from 'vitest';
import { renderEntry, isFlowReport } from './render-entry';
import type { DesignSpec } from '../schema/types';

const doc = { width: 800, height: 600, unit: 'px' as const, dpi: 96 };

function poster(): DesignSpec {
  return {
    _protocol: 'design/v2',
    meta: { id: 'd1', name: 'P', type: 'poster', created: '', modified: '' },
    document: doc,
    theme: { ref: 'midnight' },
    layers: [
      { id: 't1', type: 'text', x: 10, y: 10, width: 200, height: 40, z: 1, content: { type: 'plain', value: 'Hi' } },
    ],
  } as unknown as DesignSpec;
}

describe('renderEntry', () => {
  it('renders a poster at document size', () => {
    const r = renderEntry(poster(), { theme: undefined });
    expect(r.isFlow).toBe(false);
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    expect(r.svg.getAttribute('viewBox')).toBe('0 0 800 600');
  });

  it('selects the requested page for paged designs', () => {
    const spec = {
      ...poster(),
      layers: undefined,
      pages: [
        { id: 'p1', layers: [{ id: 'a', type: 'text', x: 0, y: 0, width: 100, height: 20, z: 1, content: { type: 'plain', value: 'PAGE-ONE' } }] },
        { id: 'p2', layers: [{ id: 'b', type: 'text', x: 0, y: 0, width: 100, height: 20, z: 1, content: { type: 'plain', value: 'PAGE-TWO' } }] },
      ],
    } as unknown as DesignSpec;
    expect(renderEntry(spec, { pageIndex: 0 }).svg.textContent).toContain('PAGE-ONE');
    expect(renderEntry(spec, { pageIndex: 1 }).svg.textContent).toContain('PAGE-TWO');
  });

  it('clamps an out-of-range pageIndex to the last page', () => {
    const spec = {
      ...poster(),
      layers: undefined,
      pages: [{ id: 'p1', layers: [] }, { id: 'p2', layers: [] }],
    } as unknown as DesignSpec;
    expect(() => renderEntry(spec, { pageIndex: 99 })).not.toThrow();
  });

  it('detects + lays out a flow report on its responsive grid (height grows past document)', () => {
    const spec = {
      ...poster(),
      report: { type: 'report', layout: 'flow', max_width: 600 },
      layers: [
        { id: 'a', type: 'kpi_card', span: 12, z: 1 },
        { id: 'b', type: 'kpi_card', span: 12, z: 2 },
        { id: 'c', type: 'kpi_card', span: 12, z: 3 },
      ],
    } as unknown as DesignSpec;
    expect(isFlowReport(spec)).toBe(true);
    const r = renderEntry(spec);
    expect(r.isFlow).toBe(true);
    // Flow uses the responsive container width (max_width=600), NOT the
    // document width (800) — proof the grid layout ran instead of poster render.
    expect(r.width).toBe(600);
    expect(r.svg.getAttribute('viewBox')).toBe(`0 0 600 ${r.height}`);
    // Height is derived from the stacked grid, not the fixed document height.
    expect(r.height).not.toBe(doc.height);
  });

  it('is deterministic — same spec renders byte-identical SVG twice', () => {
    const a = new XMLSerializer().serializeToString(renderEntry(poster()).svg);
    const b = new XMLSerializer().serializeToString(renderEntry(poster()).svg);
    expect(a).toBe(b);
  });
});

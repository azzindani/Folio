// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { evalSource, resolveNames, resolveSourceFormulas } from './formula-source';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { specAt } from '../export/gif-frames';
import { collectFindings } from '../mcp/engine/diagnose-collect';
import { resolveSpec } from '../renderer/resolve-source';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;
const card = (formulas: Record<string, string>): Layer =>
  L({ id: 'card', type: 'rect', z: 1, x: 0, y: 100, width: 200, height: 120, fill: '#222222', formulas });
const design = (layers: Layer[], names?: Record<string, unknown>, pageNames?: Record<string, unknown>): DesignSpec => ({
  meta: { id: 'd', name: 'D', type: 'carousel' }, document: { width: 1080, height: 1350 }, ...(names ? { names } : {}),
  pages: [{ id: 'p1', layers, ...(pageNames ? { names: pageNames } : {}) }],
} as unknown as DesignSpec);

describe('source formulas', () => {
  it('evaluates against names, W, H and utils, and names build on the ones before them', () => {
    const names = resolveNames({ Gutter: 60, Col: '=(W - Gutter * 3) / 2', Accent: '#E4572E' }, 1080, 1350);
    expect(names).toEqual({ Gutter: 60, Col: 450, Accent: '#E4572E' });
    expect(evalSource('=Col + Gutter', { names, W: 1080, H: 1350 })).toEqual({ ok: true, value: 510 });
    expect(evalSource('=utils.clamp(H, 0, 900)', { names, W: 1080, H: 1350 })).toEqual({ ok: true, value: 900 });
  });

  it('reports a failure instead of applying it — the runtime drew the raw "=…" text', () => {
    const problems: never[] = [];
    const out = resolveSourceFormulas([card({ width: '=Colum * 2', fill: '=Accent' })], { names: { Accent: '#E4572E' }, W: 1080, H: 1350 }, problems);
    expect(out[0]).toMatchObject({ width: 200, fill: '#E4572E', formulas: { width: '=Colum * 2' } });
    expect(problems).toEqual([expect.objectContaining({ layer_id: 'card', prop: 'width', formula: '=Colum * 2' })]);
    expect(evalSource('=W / 0 - Infinity', { names: {}, W: 1, H: 1 }).ok).toBe(false);
  });

  it('leaves runtime formulas (state, data, pages) to the report runtime', () => {
    const layer = card({ opacity: '=state.on ? 1 : 0.2', width: '=W / 2' });
    const [out] = resolveSourceFormulas([layer], { names: {}, W: 1080, H: 1350 });
    expect(out).toMatchObject({ width: 540, formulas: { opacity: '=state.on ? 1 : 0.2' } });
    expect((out as unknown as { formulas: object }).formulas).not.toHaveProperty('width');
  });

  it('draws the resolved value in every export, a page\'s names over the design\'s', () => {
    const spec = design([card({ x: '=Margin', width: '=W - Margin * 2', fill: '=Accent', 'style.opacity': '=Fade' })],
      { Margin: 80, Accent: '#E4572E', Fade: 0.5 }, { Accent: '#1B998B' });
    const svg = renderToSVGString(spec);
    expect(svg).toContain('width="920"');
    expect(svg).toContain('#1B998B');
    expect(svg).not.toContain('#E4572E');
    const frame = specAt(spec, 0, 0).pages?.[0]?.layers?.[0];
    expect(frame).toMatchObject({ x: 80, width: 920, fill: '#1B998B' });
    expect(resolveSpec(spec).pages?.[0]?.layers?.[0]).toMatchObject({ x: 80, width: 920 });
  });

  it('measures the resolved boxes in diagnose, and names a formula that fails', () => {
    const off = design([card({ x: '=W + 100' })]);
    expect(collectFindings(off, '/dev/null').some(f => f.code !== 'formula_error' && /card/.test(f.message))).toBe(true);
    const broken = design([card({ width: '=Colum * 2' })], { Col: '=Gutter +' });
    const errs = collectFindings(broken, '/dev/null').filter(f => f.code === 'formula_error');
    expect(errs.map(f => f.message)).toEqual([
      expect.stringContaining('names.Col'),
      expect.stringContaining('"card" width = =Colum * 2 fails'),
    ]);
    expect(errs.every(f => f.severity === 'error')).toBe(true);
  });
});

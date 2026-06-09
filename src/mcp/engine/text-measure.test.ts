import { describe, it, expect } from 'vitest';
import { estTextHeight, measureTextLayer, findTextOverflows } from './text-measure';
import type { Layer } from '../../schema/types';

const txt = (id: string, x: number, y: number, w: number, h: number, value: string, size: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'text', z: 5, x, y, width: w, height: h, content: { type: 'plain', value }, style: { font_size: size, ...extra } } as unknown as Layer);

describe('estTextHeight', () => {
  it('estimates a long headline as multiple lines', () => {
    // 38 chars at 96px in an 880px box ≈ 3 wrapped lines.
    const h = estTextHeight('5 Habits of Highly Effective Engineers', 96, 880, 1.02);
    expect(h).toBeGreaterThan(250);
    expect(h).toBeLessThan(360);
  });
  it('a short string fits one line', () => {
    expect(estTextHeight('Hi', 40, 800, 1.2)).toBe(Math.ceil(40 * 1.2));
  });
  it('respects explicit newlines', () => {
    const two = estTextHeight('a\nb', 20, 800, 1.5);
    expect(two).toBe(Math.ceil(2 * 20 * 1.5));
  });
  it('condensed fonts fit more chars per line than serif', () => {
    const serif = estTextHeight('AAAAAAAAAAAAAAAAAAAA', 50, 400, 1.2);
    const anton = estTextHeight('AAAAAAAAAAAAAAAAAAAA', 50, 400, 1.2, 'Anton');
    expect(anton).toBeLessThanOrEqual(serif);
  });
});

describe('measureTextLayer', () => {
  it('returns null for non-text and empty text', () => {
    expect(measureTextLayer({ id: 'r', type: 'rect', x: 0, y: 0, width: 10, height: 10 } as unknown as Layer)).toBeNull();
    expect(measureTextLayer(txt('e', 0, 0, 100, 40, '   ', 20))).toBeNull();
  });
  it('reports estH well above declaredH for an undersized headline box', () => {
    const m = measureTextLayer(txt('h', 100, 200, 880, 120, '5 Habits of Highly Effective Engineers', 96, { line_height: 1.02, font_family: 'Playfair Display' }));
    expect(m).toBeTruthy();
    expect(m!.declaredH).toBe(120);
    expect(m!.estH).toBeGreaterThan(m!.declaredH * 1.5);
    expect(m!.lines).toBeGreaterThanOrEqual(3);
  });
});

describe('findTextOverflows', () => {
  it('flags an overflowing headline and lists the layers it collides with', () => {
    const layers: Layer[] = [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350 } as unknown as Layer,
      txt('headline', 100, 200, 880, 120, '5 Habits of Highly Effective Engineers', 96, { line_height: 1.02 }),
      { id: 'rule', type: 'rect', z: 1, x: 100, y: 340, width: 800, height: 4 } as unknown as Layer,
      txt('h1_title', 180, 380, 500, 30, 'Write Small, Focused Tests', 24),
    ];
    const ov = findTextOverflows(layers, 1350);
    const head = ov.find(o => o.id === 'headline');
    expect(head).toBeTruthy();
    expect(head!.spill).toBeGreaterThan(100);
    expect(head!.collides).toContain('rule');
    expect(head!.collides).toContain('h1_title');
  });

  it('does NOT flag a correctly-sized box, nor the background underneath', () => {
    const layers: Layer[] = [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350 } as unknown as Layer,
      txt('headline', 100, 200, 880, 360, '5 Habits of Highly Effective Engineers', 96, { line_height: 1.02 }),
    ];
    expect(findTextOverflows(layers, 1350)).toHaveLength(0);
  });

  it('marks offBottom when text runs past the canvas bottom into empty space', () => {
    const layers: Layer[] = [
      txt('foot', 100, 1300, 880, 30, 'A very long footer line that wraps several times past the bottom edge of the canvas surely', 40),
    ];
    const ov = findTextOverflows(layers, 1350);
    expect(ov[0]?.offBottom).toBe(true);
  });
});

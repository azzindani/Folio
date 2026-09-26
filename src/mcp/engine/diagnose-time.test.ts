import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { collectFindings } from './diagnose-collect';
import { seenWindow } from '../../animation/lifespan';

// The one-shot proof piece (stop-forwarding): six "collisions" and three near-misses between
// beats that never share the screen, and a character standing on its desk called a cut.

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;
const text = (id: string, y: number, value: string, rule?: unknown): Layer => L({
  id, type: 'text', z: 5, x: 90, y, width: 900, height: 120, content: { type: 'plain', value },
  style: { font_family: 'Inter', font_size: 88, font_weight: 800, color: '#1F2A36' }, ...(rule ? { animation: { rule } } : {}),
});
const design = (layers: Layer[]): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1350 }, length_ms: 26000,
  layers: [L({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#EEF4F8' }), ...layers],
} as unknown as DesignSpec);
const codes = (spec: DesignSpec, code: string): string[] => collectFindings(spec, '/dev/null').filter(f => f.code === code).map(f => f.message);

describe('diagnose judges layers at the moments they are seen', () => {
  it('reads when a rule-driven layer can be seen', () => {
    const w = (rule: unknown): unknown => seenWindow(L({ id: 'x', type: 'text', animation: { keyframes: (rule as { k: unknown[] }).k, playback: { delay: 1000 } } }));
    expect(w({ k: [{ t: 0, opacity: 1 }, { t: 2000, opacity: 1 }, { t: 2300, opacity: 0 }] })).toEqual({ in: 0, out: 3300 });
    expect(w({ k: [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }] })).toEqual({ in: 1000, out: Infinity });
  });

  it('calls beats that take turns in one spot a composition, and the same texts together a pile-up', () => {
    const turns = design([text('cover', 290, 'Start routing.', { preset: 'fade_out', at: 3000, duration: 300 }), text('payoff', 294, 'Zero forwarded threads.', { preset: 'rise', at: 20000 })]);
    expect(codes(turns, 'collision')).toEqual([]);
    expect(codes(turns, 'misalignment')).toEqual([]);
    const together = design([text('cover', 290, 'Start routing.'), text('payoff', 294, 'Zero forwarded threads.')]);
    expect(codes(together, 'collision').length).toBe(1);
  });

  it('lets a character stand on a desk laid edge to edge', () => {
    const mel = L({ id: 'mel', type: 'group', z: 10, x: 380, y: 700, width: 320, height: 230,
      animation: { keyframes: [{ t: 0, x: 0, y: 0 }, { t: 1000, x: 0, y: 0 }, { t: 1600, x: 300, y: 150 }, { t: 4000, x: 300, y: 150 }], playback: { duration: 4000, origin: 'offset' } },
      layers: [L({ id: 'mel_body', type: 'rect', z: 0, x: 380, y: 700, width: 320, height: 230, fill: '#FBF7EF' })] });
    const desk = L({ id: 'desk', type: 'rect', z: 1, x: 0, y: 940, width: 1080, height: 410, fill: '#E6D5BA' });
    const box = L({ id: 'box', type: 'rect', z: 2, x: 700, y: 960, width: 200, height: 160, fill: '#C9A57A' });
    const found = codes({ ...design([desk, box, mel]), markers: { a: 0, b: 900 } } as DesignSpec, 'motion_collision');
    expect(found.some(m => m.includes('"desk"')), found.join(' | ')).toBe(false);
    expect(found.some(m => m.includes('"box"')), 'a real object is still named').toBe(true);
  });
});

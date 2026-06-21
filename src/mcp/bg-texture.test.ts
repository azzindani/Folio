import { describe, it, expect } from 'vitest';
import { parseBgSpec, composeBackground } from './shorthand-background';

type L = { id: string; type: string; fill?: { type?: string; pattern?: string; opacity?: number } };
const ctx = { bg: '#FDF6E3', accent: '#C94F4F', text: '#1A1A1A', palette: [] as string[] };

describe('bg_style pattern textures', () => {
  it('parses a bare pattern token as a visible overlay (strength 1)', () => {
    const { overlays } = parseBgSpec('solid + graph_paper');
    expect(overlays).toHaveLength(1);
    expect(overlays[0]).toMatchObject({ name: 'graph_paper', strength: 1 });
  });

  it('parses soft / bold qualifiers', () => {
    expect(parseBgSpec('solid + dot_grid:soft').overlays[0].strength).toBeLessThan(0.5);
    expect(parseBgSpec('solid + grid:bold').overlays[0].strength).toBeGreaterThan(1.5);
  });

  it('parses a numeric absolute opacity', () => {
    expect(parseBgSpec('solid + graph_paper:0.2').overlays[0].absOpacity).toBe(0.2);
  });

  it('renders an explicit pattern at a VISIBLE opacity (not the 0.035 grain)', () => {
    const ls = composeBackground('solid + graph_paper', 'bg', 0, 0, 1080, 1400, ctx, 0) as unknown as L[];
    const tex = ls.find(l => l.fill?.type === 'pattern' && l.fill?.pattern === 'graph_paper');
    expect(tex).toBeTruthy();
    expect(tex!.fill!.opacity!).toBeGreaterThan(0.08);
  });

  it('honors an absolute numeric opacity on the rendered overlay', () => {
    const ls = composeBackground('solid + dot_grid:0.3', 'bg', 0, 0, 1080, 1400, ctx, 0) as unknown as L[];
    const tex = ls.find(l => l.fill?.pattern === 'dot_grid');
    expect(tex!.fill!.opacity).toBe(0.3);
  });
});

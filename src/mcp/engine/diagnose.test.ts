import { describe, it, expect } from 'vitest';
import { analyzeLayers } from './diagnose';
import type { Layer } from '../../schema/types';

const W = 1080, H = 1080;
const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#FAF5EC' } } as unknown as Layer;
const text = (id: string, x: number, y: number, w: number, h: number, size: number, color = '#0A0A0A'): Layer =>
  ({ id, type: 'text', z: 5, x, y, width: w, height: h, content: { type: 'plain', value: id }, style: { font_size: size, color } } as unknown as Layer);

function codes(layers: Layer[]): string[] {
  return analyzeLayers(layers, W, H).map(f => f.code);
}

describe('analyzeLayers — geometry', () => {
  it('flags off-canvas layers as errors', () => {
    const f = analyzeLayers([bg, { id: 'stray', type: 'rect', z: 1, x: -50, y: 40, width: 200, height: 200, fill: { type: 'solid', color: '#000' } } as unknown as Layer], W, H);
    const off = f.find(x => x.code === 'off_canvas');
    expect(off).toBeTruthy();
    expect(off!.severity).toBe('error');
    expect(off!.layer_id).toBe('stray');
  });

  it('flags colliding same-kind content (text pile-up)', () => {
    const f = analyzeLayers([bg, text('a', 100, 100, 300, 80, 40), text('b', 120, 110, 300, 80, 40)], W, H);
    expect(f.some(x => x.code === 'collision')).toBe(true);
  });

  it('does NOT flag a text over a (different-kind) card as a collision', () => {
    const card = { id: 'card', type: 'rect', z: 1, x: 80, y: 80, width: 400, height: 200, fill: { type: 'solid', color: '#FFFFFF' } } as unknown as Layer;
    const f = analyzeLayers([bg, card, text('label', 100, 120, 300, 60, 32)], W, H);
    expect(f.some(x => x.code === 'collision')).toBe(false);
  });

  it('flags tiny text', () => {
    const f = analyzeLayers([bg, text('fine', 96, 100, 400, 40, 9)], W, H);
    const t = f.find(x => x.code === 'tiny_text');
    expect(t?.severity).toBe('warning');
  });

  it('flags near-miss misalignment (edges off by a few px)', () => {
    const f = analyzeLayers([bg, text('h', 100, 100, 400, 60, 48), text('b', 103, 200, 400, 40, 24)], W, H);
    const m = f.find(x => x.code === 'misalignment');
    expect(m?.severity).toBe('suggestion');
    expect(m?.message).toMatch(/off by 3/);
  });
});

describe('analyzeLayers — composition fold-in + clean baseline', () => {
  it('flags a missing background', () => {
    expect(codes([text('h', 96, 100, 400, 60, 96)])).toContain('composition');
  });

  it('returns no errors/warnings for a clean, well-built poster', () => {
    const f = analyzeLayers([bg, text('headline', 96, 120, 880, 130, 96), text('body', 96, 320, 700, 60, 24, '#333333')], W, H);
    expect(f.filter(x => x.severity === 'error')).toHaveLength(0);
    expect(f.filter(x => x.severity === 'warning')).toHaveLength(0);
  });
});

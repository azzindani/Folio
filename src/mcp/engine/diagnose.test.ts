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

describe('analyzeLayers — off-canvas content nested inside a preset group', () => {
  // The review's "0 errors, 0 warnings" deck: the GROUP box claims it fits the
  // canvas while its children — which carry absolute coordinates, since a group
  // renders as a bare <g> — draw well past the bottom edge.
  const lying = (childY: number): Layer => ({
    id: 'sections', type: 'group', z: 1, x: 0, y: 0, width: W, height: H,
    layers: [
      { id: 's_bg', type: 'rect', z: 0, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: '#101010' } },
      text('s_body', 80, childY, 900, 120, 28),
    ],
  } as unknown as Layer);

  it('is an ERROR even though the group box itself fits', () => {
    const f = analyzeLayers([lying(2066)], W, H);
    const off = f.filter(x => x.code === 'off_canvas');
    expect(off).toHaveLength(1);
    expect(off[0].severity).toBe('error');
    expect(off[0].layer_id).toBe('s_body');
    expect(off[0].message).toMatch(/clipped/);
  });

  it('says how far out it is, so the model can size the fix', () => {
    const [off] = analyzeLayers([lying(2066)], W, H).filter(x => x.code === 'off_canvas');
    expect(off.message).toContain('1106px outside');
  });

  it('leaves content that fits alone', () => {
    expect(codes([lying(400)])).not.toContain('off_canvas');
  });

  it('does not flag DECORATION that bleeds off the edge — that is a design move', () => {
    const decor = {
      id: 'g', type: 'group', z: 1, x: 0, y: 0, width: W, height: H,
      layers: [{ id: 'blob', type: 'ellipse', z: 0, x: W - 60, y: 200, width: 400, height: 400, fill: { type: 'solid', color: '#B8543C' } }],
    } as unknown as Layer;
    expect(codes([bg, decor])).not.toContain('off_canvas');
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

describe('analyzeLayers — sparse-content nudge → enrich_brief', () => {
  it('flags a near-empty poster (bg + 1 short text)', () => {
    expect(codes([bg, text('h', 96, 120, 880, 80, 96)])).toContain('sparse_content');
  });

  it('does NOT flag a rich preset group (many children)', () => {
    const group = { id: 'sec', type: 'group', z: 0, x: 0, y: 0, width: W, height: H,
      layers: Array.from({ length: 8 }, (_, i) => text(`c${i}`, 80, 80 + i * 60, 400, 50, 28)) } as unknown as Layer;
    expect(codes([group])).not.toContain('sparse_content');
  });

  it('does NOT flag a content-full poster', () => {
    const layers = [bg, text('headline', 96, 120, 880, 130, 96),
      text('body', 96, 320, 700, 120, 24), text('stat', 96, 500, 400, 100, 72)];
    expect(codes(layers)).not.toContain('sparse_content');
  });
});

describe('analyzeLayers — stacked full-canvas presets (re-added not replaced)', () => {
  const fg = (id: string): Layer => ({ id, type: 'group', z: 0, x: 0, y: 0, width: W, height: H,
    layers: Array.from({ length: 6 }, (_, i) => text(`${id}_t${i}`, 80, 80 + i * 60, 400, 50, 28)) } as unknown as Layer);
  it('warns when the same full-canvas preset is stacked multiple times', () => {
    const f = analyzeLayers([fg('feature_grid_1'), fg('feature_grid_1-2'), fg('feature_grid_1-3')], W, H);
    const hit = f.find(x => x.code === 'stacked_presets');
    expect(hit).toBeTruthy();
    expect(hit!.severity).toBe('warning');
    expect(hit!.message).toContain('feature_grid_1-3');
  });
  it('does NOT warn for a single full-canvas preset group', () => {
    expect(analyzeLayers([fg('feature_grid_1')], W, H).some(x => x.code === 'stacked_presets')).toBe(false);
  });
});

describe('analyzeLayers — serialized-spec leak (patch-fumble safety net)', () => {
  const textV = (id: string, value: string): Layer =>
    ({ id, type: 'text', z: 5, x: 96, y: 200, width: 880, height: 300, content: { type: 'plain', value }, style: { font_size: 28 } } as unknown as Layer);

  it('flags a text layer whose content is a serialized shorthand blob', () => {
    const v = ', "bg": "#FAF5EC", "accent": "#B8543C", "text_color": "#1A1A1A", "bg_style": "gradient + curve';
    expect(codes([bg, textV('leak', v)])).toContain('serialized_spec');
  });

  it('flags a JSON-array string dumped as copy', () => {
    expect(codes([bg, textV('leak2', '[{"type":"stat","value":"55%","label":"share"}]')])).toContain('serialized_spec');
  });

  it('does NOT flag normal prose that happens to mention a colon', () => {
    expect(codes([bg, textV('ok', 'Renewables: the fastest-growing source of new power worldwide in 2024.')])).not.toContain('serialized_spec');
  });
});

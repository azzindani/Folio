import { describe, it, expect } from 'vitest';
import { analyzeLayers } from './diagnose';
import { inkLeft } from '../../export/frame-geometry';
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

  it('flags near-miss misalignment (edges off by a few px) — two texts by their letters', () => {
    const h = text('h', 100, 100, 400, 60, 48), b = text('b', 103, 200, 400, 40, 24);
    const m = analyzeLayers([bg, h, b], W, H).find(x => x.code === 'misalignment');
    expect(m?.severity).toBe('suggestion');
    const off = (inkLeft(b) ?? NaN) - (inkLeft(h) ?? NaN);
    expect(m?.message).toContain(`their letters are ${Math.abs(off).toFixed(1)}px apart (ink, not boxes)`);
    expect(m?.call).toEqual({ tool: 'edit_layer', params: { op: 'move', layer_id: 'h', dx: Math.round(off) } });
  });

  // benchmark r6 b22: a 300 px "30%" set 6 px left of a column of smaller lines to line its letters up.
  it('judges display type by where its letters start, and names the move that lines them up', () => {
    const face = { font_family: 'Archivo', font_weight: 900 };
    const kicker = { ...text('kicker', 90, 320, 600, 44, 32), style: { ...face, font_size: 32, color: '#C5501E' } } as unknown as Layer;
    const pct = { ...text('pct', 84, 700, 800, 330, 300), content: { type: 'plain', value: '30%' }, style: { ...face, font_size: 300, color: '#C5501E' } } as unknown as Layer;
    const inkK = inkLeft(kicker) ?? NaN, inkP = inkLeft(pct) ?? NaN;
    expect(inkP - 84).toBeGreaterThan(inkK - 90 + 4);   // the numeral's letters start further inside its box
    const m = analyzeLayers([bg, kicker, pct], W, H).find(x => x.code === 'misalignment');
    expect(m?.layer_id).toBe('pct');
    expect(m?.call?.params).toEqual({ op: 'move', layer_id: 'pct', dx: Math.round(inkK - inkP) });
  });

  it('leaves boxes a few px apart alone when their letters line up — optical alignment, set on purpose', () => {
    const head = { ...text('head', 100, 100, 600, 130, 110), content: { type: 'plain', value: 'Harbour' }, style: { font_family: 'Archivo', font_weight: 900, font_size: 110 } } as unknown as Layer;
    const body = { ...text('body', 100, 300, 600, 40, 24), content: { type: 'plain', value: 'Harbour walk' }, style: { font_family: 'Archivo', font_size: 24 } } as unknown as Layer;
    const x = 100 + Math.round((inkLeft(head) ?? NaN) - (inkLeft(body) ?? NaN));
    expect(x - 100).toBeGreaterThanOrEqual(1);         // the boxes differ by a near-miss…
    expect(x - 100).toBeLessThanOrEqual(6);
    const lined = { ...body, x } as unknown as Layer;
    expect(analyzeLayers([bg, head, lined], W, H).filter(f => f.code === 'misalignment')).toEqual([]);   // …the letters do not
  });

  it('stays quiet when the pair is exactly aligned on another line (benchmark r2: a chart row)', () => {
    // A 30px label and a 24px note centred on the same bar row: tops 3px apart by design.
    const f = analyzeLayers([bg, text('label', 120, 512, 170, 42, 30), text('note', 600, 515, 200, 36, 24)], W, H);
    expect(f.filter(x => x.code === 'misalignment')).toEqual([]);
    // Right-aligned figures of different widths: left edges near, right edges exact.
    const g = analyzeLayers([bg, text('a', 700, 300, 200, 40, 24), text('b', 704, 400, 196, 40, 24)], W, H);
    expect(g.filter(x => x.code === 'misalignment')).toEqual([]);
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

describe('analyzeLayers — a camera world', () => {
  it('reports nothing off-canvas for a scene laid out across the world, nested or not', () => {
    const scene = { id: 'scene', type: 'group', z: 1, locked: true, x: 0, y: -540, width: 5760, height: 3240, layers: [
      { id: 'zoneC', type: 'text', z: 2, x: 3960, y: 96, width: 1680, height: 140, content: { type: 'plain', value: 'Far right' }, style: { font_size: 60 } },
    ] } as unknown as Layer;
    const world = { x: 0, y: -540, width: 5760, height: 3240 };
    expect(analyzeLayers([scene], 1920, 1080).some(f => f.code === 'off_canvas')).toBe(true);
    expect(analyzeLayers([scene], 1920, 1080, world).filter(f => f.code === 'off_canvas')).toEqual([]);
  });
});

describe('analyzeLayers — text overflow reaches group children (benchmark r1)', () => {
  const words = (id: string, value: string, x: number, y: number, w: number, h: number, size: number): Layer =>
    ({ id, type: 'text', z: 5, x, y, width: w, height: h, content: { type: 'plain', value }, style: { font_size: size, line_height: 1.4 } } as unknown as Layer);
  const panel = { id: 'panel', type: 'rect', z: 1, x: 80, y: 480, width: 440, height: 110, fill: { type: 'solid', color: '#0F1B2D' } } as unknown as Layer;
  const fix = words('fix', 'Send a three-line agenda twenty-four hours before. No agenda? Cancel the meeting outright.', 100, 500, 400, 60, 32);
  const group = (locked: boolean, kids: Layer[]): Layer =>
    ({ id: 'slide', type: 'group', locked, x: 0, y: 0, width: W, height: H, layers: kids } as unknown as Layer);

  it('sees a spill out of a panel inside a locked group, and names the panel as its ground', () => {
    const f = analyzeLayers([bg, group(true, [panel, fix])], W, H).find(x => x.code === 'text_overflow');
    expect(f?.layer_id).toBe('fix');
    expect(f?.severity).toBe('error');
    expect(f?.message).toContain('runs out of "panel"');
    expect(f?.message).not.toContain('overlaps');
  });

  it('leaves a one-line label in a box trimmed to its cap height alone', () => {
    const kick = words('kick', 'WHAT IT DOES', 80, 60, 600, 34, 38);
    expect(analyzeLayers([bg, group(false, [kick])], W, H).some(x => x.code === 'text_overflow')).toBe(false);
  });

  it('breaks a word where the renderer breaks it — and not one cut to its own width', () => {
    // "Astra" at 96 px is ~250 px: in a 126 px box it draws on three lines, as the flipbook shows.
    const narrow = words('w1', 'Astra', 140, 462, 126, 101, 96);
    expect(analyzeLayers([bg, group(false, [narrow])], W, H).some(x => x.code === 'text_overflow')).toBe(true);
    // A split piece's box is its exact width; the measure reading it a hair wide does not break it.
    const cut = { ...words('w2', 'Astra', 140, 462, 263, 101, 96), style: { font_family: 'Archivo', font_weight: 800, font_size: 96, line_height: 1.4 } } as unknown as Layer;
    expect(analyzeLayers([bg, group(false, [cut])], W, H).some(x => x.code === 'text_overflow')).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';

import { expandShorthand } from './shorthand-expand';
import type { ShorthandLayer } from './shorthand-helpers';

import { scalePathD, stampFixedCanvas, drainPresetFitReports, resetPresetFitReports, presetMinHeight, PRESET_FIT_MIN_SCALE } from './preset-fit';

type G = { type?: string; height?: number; width?: number; layers: Rec[] };
type Rec = { id: string; type: string; x?: number; y?: number; width?: number; height?: number; style?: { font_size?: number }; layers?: Rec[] };

const block = (i: number) => ({
  kind: 'text', heading: `Sub-theme ${i}`,
  text: 'A reasonably long paragraph of supporting copy that wraps across several lines to take up real vertical space on the page.',
});

/** A `sections` slide with n blocks in a landscape 1920×1080 box. */
function slide(n: number, fixed: boolean, w = 1920, h = 1080): G {
  const sh = {
    id: 's', type: 'sections', z: 0, pos: [0, 0, w, h], bg: '#0A0A0A',
    title: 'Air Cargo Performance', subtitle: 'A two sentence intro deck that frames the topic for the board.',
    blocks: Array.from({ length: n }, (_, i) => block(i + 1)),
  } as unknown as ShorthandLayer;
  if (fixed) stampFixedCanvas([sh]);
  return expandShorthand(sh) as unknown as G;
}

/** Deepest bottom edge in the subtree — where the content really ends. */
function bottom(l: Rec): number {
  let b = (l.y ?? 0) + (l.height ?? 0);
  for (const c of l.layers ?? []) b = Math.max(b, bottom(c));
  return b;
}

function fontSizes(l: Rec, out: number[] = []): number[] {
  if (typeof l.style?.font_size === 'number') out.push(l.style.font_size);
  for (const c of l.layers ?? []) fontSizes(c, out);
  return out;
}

describe('preset fit-to-box — an explicit height binds on a fixed canvas', () => {
  beforeEach(() => resetPresetFitReports());

  it('a POSTER keeps content-sizing: the preset still grows past the requested height', () => {
    const g = slide(6, false);
    expect(g.height ?? 0).toBeGreaterThan(1080);
    expect(drainPresetFitReports()).toHaveLength(0);
  });

  it('a SLIDE is compressed into the declared box — nothing renders off the bottom edge', () => {
    const g = slide(6, true);
    expect(g.height).toBe(1080);
    for (const l of g.layers) expect(bottom(l)).toBeLessThanOrEqual(1080 + 1);
  });

  it('reports the compression with the numbers a model needs to act on', () => {
    slide(6, true);
    const [r] = drainPresetFitReports();
    expect(r).toBeDefined();
    expect(r.preset).toBe('sections');
    expect(r.box_height).toBe(1080);
    expect(r.natural_height).toBeGreaterThan(1080);
    expect(r.scale).toBeLessThan(1);
    expect(r.note).toContain('1080');
    expect(r.note).toContain('compressed');
  });

  it('shrinks type with the layout instead of clipping it', () => {
    const loose = fontSizes(slide(6, false) as unknown as Rec);
    const tight = fontSizes(slide(6, true) as unknown as Rec);
    expect(tight.length).toBe(loose.length);
    expect(Math.max(...tight)).toBeLessThan(Math.max(...loose));
  });

  it('keeps the backdrop full-bleed — a compressed preset leaves no unpainted strip', () => {
    const g = slide(6, true);
    const bg = g.layers.find(l => l.type === 'rect' && (l.width ?? 0) >= 1920 * 0.95);
    expect(bg).toBeDefined();
    expect(bg?.x).toBe(0);
    expect(bg?.y).toBe(0);
    expect(bg?.width).toBe(1920);
    expect(bg?.height).toBe(1080);
  });

  it('content that already fits is left untouched', () => {
    const g = slide(1, true, 1080, 1920);
    expect(drainPresetFitReports()).toHaveLength(0);
    expect(g.height).not.toBe(1920);
  });

  it('refuses to compress past the legibility floor and says so', () => {
    slide(22, true);
    const [r] = drainPresetFitReports();
    expect(r.scale).toBe(PRESET_FIT_MIN_SCALE);
    expect(r.overflow).toBeGreaterThan(0);
    expect(r.note).toContain('STILL overflows');
    expect(r.note).toMatch(/cut content/);
  });

  it('reports drain once — a second read is empty, so notes never leak into the next call', () => {
    slide(6, true);
    expect(drainPresetFitReports()).toHaveLength(1);
    expect(drainPresetFitReports()).toHaveLength(0);
  });
});

describe('scalePathD — motif geometry scales with the layout it lives in', () => {
  it('scales absolute coordinates about the origin', () => {
    expect(scalePathD('M 0 0 L 100 200', 0.5, 0, 0, 0)).toBe('M0 0L50 100');
  });

  it('applies the horizontal centering offset to x only', () => {
    expect(scalePathD('M 0 0 L 100 100', 0.5, 0, 0, 10)).toBe('M10 0L60 50');
  });

  it('scales relative deltas without translating them', () => {
    expect(scalePathD('m 10 10 l 40 40', 0.5, 0, 0, 100)).toBe('m5 5l20 20');
  });

  it('scales arc radii but never its rotation or flags', () => {
    const out = scalePathD('M 0 0 A 100 50 30 1 0 200 100', 0.5, 0, 0, 0);
    expect(out).toBe('M0 0A50 25 30 1 0 100 50');
  });

  it('leaves a path it cannot parse alone', () => {
    expect(scalePathD('', 0.5, 0, 0, 0)).toBe('');
  });
});

describe('presetMinHeight — the per-preset minimum canvas the guide quotes', () => {
  it('answers for a flow preset', () => {
    expect(presetMinHeight('sections', 1920)).toBe(2016);
  });

  it('is undefined for a type that owns no vertical flow', () => {
    expect(presetMinHeight('rect', 1920)).toBeUndefined();
  });
});

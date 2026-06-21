import { describe, it, expect } from 'vitest';
import { dedupOverlappingDuplicates, normalizeTextAliases, trimTrailingDeadBand, ensureTopMargin } from './engine-finalize-geom';
import type { Layer } from '../schema/types';

describe('ensureTopMargin — nudge a flush-top hand-placed poster down (suite-014)', () => {
  const DW = 1080, DH = 1080;
  const bg = (): Layer => ({ id: 'bg', type: 'rect', z: -1, x: 0, y: 0, width: DW, height: DH, fill: { type: 'solid', color: '#FAF5EC' } } as unknown as Layer);
  const tx = (id: string, y: number, h: number): Layer =>
    ({ id, type: 'text', z: 1, x: 65, y, width: 950, height: h, content: { type: 'plain', value: 'x' } } as unknown as Layer);

  it('shifts a title placed at y:0 (+ its siblings) down so the top clears a margin', () => {
    const title = tx('text_1', 0, 135);
    const layers = [bg(), title, tx('text_2', 150, 135), tx('text_3', 300, 51)];
    const moved = ensureTopMargin(layers, DW, DH);
    expect(moved).toBe(3);                                  // 3 texts shifted, bg left alone
    const ty = (title as unknown as { y: number }).y;
    expect(ty).toBeGreaterThanOrEqual(Math.round(DH * 0.05) - 1);  // top now clears ~5%
    expect((layers[0] as unknown as { y: number }).y).toBe(0);     // full-bleed bg untouched
    // relative spacing preserved (title→sub gap stays 150)
    expect((layers[2] as unknown as { y: number }).y - ty).toBe(150);
  });

  it('leaves a composition that already has a top margin alone', () => {
    const layers = [bg(), tx('a', 120, 135), tx('b', 300, 60)];
    expect(ensureTopMargin(layers, DW, DH)).toBe(0);
  });

  it('does NOT shift when content fills to the bottom (no room → would clip)', () => {
    const layers = [bg(), tx('a', 0, 135), tx('b', 200, 135), tx('c', 980, 90)]; // bottom at 1070
    expect(ensureTopMargin(layers, DW, DH)).toBe(0);
  });

  it('skips a preset/group layout (it owns its own margins)', () => {
    const grp = { id: 'g', type: 'group', z: 0, x: 0, y: 0, width: DW, height: DH, layers: [tx('t', 0, 100)] } as unknown as Layer;
    expect(ensureTopMargin([bg(), grp], DW, DH)).toBe(0);
  });

  it('drives the margin off CONTENT, not a degenerate decoration parked at (0,0)', () => {
    // a stray zero-size line at origin must not over-shift content that already clears
    const line0 = { id: 'ln', type: 'line', z: 2, x1: 0, y1: 0, x2: 1, y2: 0, stroke: { color: '#000', width: 2 } } as unknown as Layer;
    const layers = [bg(), line0, tx('a', 120, 135), tx('b', 320, 60)];
    expect(ensureTopMargin(layers, DW, DH)).toBe(0);        // real content already at y=120 → no shift
  });
});

describe('trimTrailingDeadBand — shrink a top-anchored poster on a non-standard canvas', () => {
  const DW = 1080, DH = 1800;   // 0.60 — NOT a standard poster ratio
  const tx = (id: string, y: number, h: number): Layer =>
    ({ id, type: 'text', z: 1, x: 80, y, width: 920, height: h, content: { type: 'plain', value: 'x' } } as unknown as Layer);

  it('trims a top-anchored sparse poster + clamps its full-canvas bg', () => {
    const bg = { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: DW, height: DH, fill: { type: 'solid', color: '#FAD' } } as unknown as Layer;
    const layers = [bg, tx('t1', 60, 90), tx('t2', 200, 60), tx('t3', 320, 60)]; // content y60..380
    const newH = trimTrailingDeadBand(layers, DW, DH);
    expect(newH).toBeGreaterThan(380);
    expect(newH).toBeLessThan(560);             // ~content bottom (380) + a margin
    expect((bg as unknown as { height: number }).height).toBe(newH);   // bg clamped
  });

  it('respects a DELIBERATE ratio (4:5) — a sparse Instagram post stays 4:5', () => {
    const layers = [tx('t1', 60, 90), tx('t2', 200, 60)];
    expect(trimTrailingDeadBand(layers, 1080, 1350)).toBe(0);   // 4:5 → never trimmed
  });

  it('leaves a vertically-centered composition alone (large top gap)', () => {
    const t = tx('mid', 800, 200);              // centered on 1800 → topGap 800 > 15%
    expect(trimTrailingDeadBand([t], DW, DH)).toBe(0);
  });

  it('leaves a content-filling poster alone (no dead band)', () => {
    const layers = [tx('a', 60, 90), tx('b', 800, 200), tx('c', 1600, 120)];
    expect(trimTrailingDeadBand(layers, DW, DH)).toBe(0);
  });

  it('ignores a shape-only poster (no text/icon/image content)', () => {
    const r = { id: 'r', type: 'rect', z: 1, x: 100, y: 100, width: 400, height: 400, fill: { type: 'solid', color: '#000' } } as unknown as Layer;
    expect(trimTrailingDeadBand([r], DW, DH)).toBe(0);
  });
});

describe('normalizeTextAliases — verbose text:/flat-style → canonical content+style', () => {
  it('folds a bare text: alias + flat font/size/color into content + style (the blank-timeline fix)', () => {
    const layers = [
      { type: 'text', text: 'Website Redesign Timeline', font: 'Playfair Display', size: 80, color: '#0A0A0A',
        x: 186, y: 316, width: 2108, height: 173, style: { font_size: 164, font_weight: 800, color: '#1A1A1A' } },
    ] as unknown as Layer[];
    const n = normalizeTextAliases(layers);
    expect(n).toBe(1);
    const o = layers[0] as unknown as Record<string, unknown>;
    expect(o['content']).toEqual({ type: 'plain', value: 'Website Redesign Timeline' });
    expect(o['text']).toBeUndefined();
    const s = o['style'] as Record<string, unknown>;
    expect(s['font_family']).toBe('Playfair Display');
    expect(s['font_size']).toBe(164);   // existing style.font_size wins over flat size:80
    expect(s['color']).toBe('#1A1A1A'); // existing style.color wins over flat color
    expect(o['size']).toBeUndefined();
    expect(o['font']).toBeUndefined();
    expect(o['color']).toBeUndefined();
  });
  it('lifts flat size:/color: into style when style lacks them', () => {
    const layers = [{ type: 'text', text: 'Hi', size: 90, color: '#222' }] as unknown as Layer[];
    normalizeTextAliases(layers);
    const s = (layers[0] as unknown as Record<string, unknown>)['style'] as Record<string, unknown>;
    expect(s['font_size']).toBe(90);
    expect(s['color']).toBe('#222');
  });
  it('recurses into groups and leaves canonical content untouched', () => {
    const layers = [{ type: 'group', layers: [
      { type: 'text', content: { type: 'plain', value: 'keep' }, style: { font_size: 40 } },
      { type: 'text', text: 'lift me' },
    ] }] as unknown as Layer[];
    expect(normalizeTextAliases(layers)).toBe(1);
    const kids = (layers[0] as unknown as { layers: Record<string, unknown>[] }).layers;
    expect(kids[0]['content']).toEqual({ type: 'plain', value: 'keep' });
    expect(kids[1]['content']).toEqual({ type: 'plain', value: 'lift me' });
  });
});

const W = 1080, H = 1620;
const txt = (id: string, value: string, x: number, y: number): Layer =>
  ({ id, type: 'text', z: 1, x, y, width: 800, height: 60, content: { type: 'plain', value }, style: { font_size: 48 } } as unknown as Layer);

describe('dedupOverlappingDuplicates — rename-twin removal', () => {
  it('drops an EXACT-duplicate rename-twin text even when the copies are far apart', () => {
    // The suite-012 birria bug: a menu split across two add_layers calls →
    // `quesa_title` + `quesa_title-2`, SAME text, DIFFERENT y (two offset ladders).
    const layers = [
      txt('quesa_title', 'QUESABIRRIA', 154, 998),
      txt('quesa_title-2', 'QUESABIRRIA', 154, 941),
    ];
    const removed = dedupOverlappingDuplicates(layers, W, H);
    expect(removed).toBe(1);
    expect(layers).toHaveLength(1);
    expect(layers[0].id).toBe('quesa_title-2'); // keeps the LAST (most recent) placement
  });

  it('keeps both when the base-ids match but the text differs', () => {
    const layers = [
      txt('line', 'TACOS', 100, 200),
      txt('line-2', 'CONSOMÉ', 100, 600),
    ];
    expect(dedupOverlappingDuplicates(layers, W, H)).toBe(0);
    expect(layers).toHaveLength(2);
  });

  it('does not collapse two distinct same-text layers with UNRELATED ids', () => {
    // No rename-twin relationship (different base ids) and no overlap → left alone.
    const layers = [
      txt('a', 'GO', 100, 100),
      txt('b', 'GO', 100, 1400),
    ];
    expect(dedupOverlappingDuplicates(layers, W, H)).toBe(0);
    expect(layers).toHaveLength(2);
  });

  it('leaves a short (<3 char) repeated twin alone', () => {
    const layers = [
      txt('n', 'GO', 100, 100),
      txt('n-2', 'GO', 100, 1400),
    ];
    expect(dedupOverlappingDuplicates(layers, W, H)).toBe(0);
    expect(layers).toHaveLength(2);
  });
});

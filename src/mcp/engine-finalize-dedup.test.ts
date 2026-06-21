import { describe, it, expect } from 'vitest';
import { dedupOverlappingDuplicates, normalizeTextAliases } from './engine-finalize-geom';
import type { Layer } from '../schema/types';

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

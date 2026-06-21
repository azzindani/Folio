import { describe, it, expect } from 'vitest';
import { dedupOverlappingDuplicates } from './engine-finalize-geom';
import type { Layer } from '../schema/types';

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

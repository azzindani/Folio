import { describe, it, expect } from 'vitest';
import { unitWidth } from './text-unit-width';
import { splitLayer } from './text-split';
import { metricsForFamily } from '../../utils/font-metrics';
import { plainTextLayout } from '../../renderer/layer-renderers-shared';
import { fontsDir } from './fonts';
import type { Layer } from '../../schema/types';

const BOLD = { font_size: 120, font_family: 'Archivo', font_weight: 800 };

describe('unitWidth', () => {
  it('never gives a unit less room than the renderer wraps by', () => {
    const estimate = plainTextLayout('every', BOLD as never, {}).lineWidths[0] ?? 0;
    expect(unitWidth('every', BOLD, 305)).toBeGreaterThanOrEqual(estimate);
    expect(unitWidth('every', BOLD, 900)).toBe(900); // a wider measurement still wins
  });

  // The live fault: "every" wrapped its "y" onto a second line inside a one-line mask.
  it('keeps every word of a bold headline on one line once split', () => {
    const head = { id: 'h', type: 'text', x: 80, y: 520, width: 920, content: { type: 'plain', value: 'Animate every word' }, style: BOLD } as unknown as Layer;
    const { units } = splitLayer(head, 'word', metricsForFamily('Archivo', [fontsDir()]));
    expect(units.map(u => u.text)).toEqual(['Animate', 'every', 'word']);
    for (const u of units) {
      expect(plainTextLayout(u.text, BOLD as never, { x: u.x, y: u.y, width: u.width }).lines, u.text).toHaveLength(1);
    }
  });
});

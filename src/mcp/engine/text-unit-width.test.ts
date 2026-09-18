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

  // Found live twice: "Every format." at -6 tracking rendered "Ever format", and
  // "Approvals that" at -1.5 rendered "Approval tha". lineWidths subtracts negative
  // tracking; the wrap rule does not, so both old numbers were too narrow.
  it('keeps tight-tracked display words whole', () => {
    const cases: [string, number, number, number][] = [
      ['Every format.', 200, -6, 1600],
      ['Approvals that chase themselves.', 84, -1.5, 904],
    ];
    for (const [value, font_size, letter_spacing, width] of cases) {
      const style = { ...BOLD, font_size, letter_spacing };
      const head = { id: 'h', type: 'text', x: 88, y: 158, width, content: { type: 'plain', value }, style } as unknown as Layer;
      const { units } = splitLayer(head, 'word', metricsForFamily('Archivo', [fontsDir()]));
      expect(units.map(u => u.text).join(' ')).toBe(value);
      for (const u of units) {
        expect(plainTextLayout(u.text, style as never, { x: u.x, y: u.y, width: u.width }).lines, `${u.text} @ ${font_size}px`).toHaveLength(1);
      }
    }
  });
});

describe('monospace capitals are no wider than any other monospace glyph', () => {
  // Found live: month initials set in a mono face, spaced to sit under chart
  // points, wrapped one character early because caps were widened.
  it('keeps a row of mono initials that fits its box on one line', () => {
    const style = { font_family: 'JetBrains Mono', font_size: 23.33, font_weight: 700 };
    const row = 'J    F    M    A    M    J    J    A    S    O    N    D';   // 56 chars × 14 px = 784
    expect(plainTextLayout(row, style as never, { x: 0, y: 0, width: 860 }).lines).toHaveLength(1);
    // A sans headline in capitals still gets the wider estimate.
    const sans = plainTextLayout('ABCD EFGHIJ', { font_family: 'Inter', font_size: 100 } as never, { width: 560 });   // 11 × 58 px > 560
    expect(sans.lines.length).toBeGreaterThan(1);
  });
});

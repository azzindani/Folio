import { describe, it, expect } from 'vitest';
import { computeFlowLayout } from './flow-layout';
import type { Layer } from '../schema/types';

const L = (id: string, type: string, span?: number, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type, z: 0, ...(span != null ? { span } : {}), ...extra }) as unknown as Layer;

describe('computeFlowLayout', () => {
  it('places a full-width layer at the left padding', () => {
    const layers = [L('h', 'rich_text', 12)];
    computeFlowLayout(layers, { containerWidth: 1200, padX: 40 });
    const l = layers[0] as unknown as Record<string, number>;
    expect(l.x).toBe(40);
    expect(l.y).toBe(48);
    expect(l.width).toBe(1120); // 1200 - 2*40
  });

  it('lays 4 span-3 KPIs in one row, then wraps the 5th', () => {
    const layers = [L('a', 'kpi_card', 3), L('b', 'kpi_card', 3), L('c', 'kpi_card', 3), L('d', 'kpi_card', 3), L('e', 'kpi_card', 3)];
    computeFlowLayout(layers, { containerWidth: 1200 });
    const y = (i: number) => (layers[i] as unknown as Record<string, number>).y;
    expect(y(0)).toBe(y(1)); // same row
    expect(y(0)).toBe(y(3)); // 4 across
    expect(y(4)).toBeGreaterThan(y(0)); // 5th wraps to next row
  });

  it('defaults spans by type when omitted (kpi=3, chart=6, table=12)', () => {
    const layers = [L('k', 'kpi_card'), L('c', 'interactive_chart'), L('t', 'interactive_table')];
    computeFlowLayout(layers, { containerWidth: 1200 });
    const w = (i: number) => (layers[i] as unknown as Record<string, number>).width;
    // kpi(3) + chart(6) = 9 cols on row 1; table(12) wraps to row 2 full width
    expect((layers[2] as unknown as Record<string, number>).width).toBe(1120);
    expect(w(0)).toBeLessThan(w(1)); // kpi narrower than chart
  });

  it('grows total height with content and never collapses below a floor', () => {
    const tall = computeFlowLayout([L('c', 'interactive_chart', 12, { height: 400 }), L('t', 'interactive_table', 12)], { containerWidth: 1200 });
    expect(tall.height).toBeGreaterThan(400);
    const empty = computeFlowLayout([], { containerWidth: 1200 });
    expect(empty.height).toBeGreaterThanOrEqual(240);
  });
});

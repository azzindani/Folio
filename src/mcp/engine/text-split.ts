/**
 * Split a text layer into the units a text animator moves — characters, words
 * or lines — each placed exactly where the renderer drew it.
 *
 * Lines come from plainTextLayout, the renderer's own wrap and anchor rule, so
 * a wrapped paragraph splits along the lines a viewer sees. Characters and
 * words are placed along each line by the font's measured advances (the same
 * charOffsets split_text uses), anchored per line the way each <tspan> is.
 * Pure: no file system — the caller passes the font metrics.
 */

import type { Layer } from '../../schema/types';
import { plainTextLayout } from '../../renderer/layer-renderers-shared';
import { charOffsets, letterSpacingPx, type FontMetrics } from '../../utils/font-metrics';
import { pieces } from './split-text-op';
import { unitWidth } from './text-unit-width';

export type SplitBy = 'char' | 'word' | 'line';

/** One unit to animate, as a text layer's box: its first baseline sits `fontSize` below y. */
export interface TextUnit { text: string; x: number; y: number; width: number; height: number; line: number }

export function splitLayer(src: Layer, by: SplitBy, metrics: FontMetrics | null): { units: TextUnit[]; exact: boolean } {
  const o = src as unknown as Record<string, unknown>;
  const content = o['content'] as { value?: unknown } | undefined;
  const value = typeof content?.value === 'string' ? content.value : '';
  const style = (o['style'] ?? {}) as Record<string, unknown>;
  const layout = plainTextLayout(value, style as never, o as never);
  const { fontSize, lineH } = layout;
  const spacing = letterSpacingPx(style['letter_spacing'], fontSize);
  const boxX = typeof o['x'] === 'number' ? o['x'] : 0;
  const boxW = typeof o['width'] === 'number' ? o['width'] : undefined;

  const units: TextUnit[] = [];
  let exact = true;
  layout.lines.forEach((line, i) => {
    if (!line.trim()) return;
    // The piece's own first baseline lands on this line's baseline.
    const top = layout.textY - fontSize + i * lineH;
    if (by === 'line') {
      units.push({ text: line, x: boxX, y: top, width: boxW ?? layout.lineWidths[i] ?? 0, height: lineH, line: i });
      return;
    }
    const run = charOffsets(line, fontSize, metrics, 0.54, spacing);
    exact = exact && run.exact;
    const start = layout.anchor === 'middle' ? layout.textX - run.total / 2
      : layout.anchor === 'end' ? layout.textX - run.total : layout.textX;
    for (const p of pieces(run.units, by)) {
      const from = run.offsets[p.start] ?? 0;
      const to = p.end < run.offsets.length ? (run.offsets[p.end] ?? run.total) : run.total;
      // Placed by measurement, sized so the renderer's own wrap rule never breaks the unit again.
      units.push({ text: p.text, x: Math.round(start + from), y: top, width: unitWidth(p.text, style, to - from), height: lineH, line: i });
    }
  });
  return { units, exact: by === 'line' ? true : exact };
}

import type { Layer } from '../schema/types';

// Flow-report editor layout: assign real x/y/width/height to span-positioned layers
// so the studio canvas shows the responsive 12-col grid (instead of stacking every
// layer at the origin) AND selection/handles — which read layer geometry — line up.
// Mutates the passed layers in place; idempotent (deterministic from span + width).
// Scoped to flow/scroll reports by the caller; never runs for posters/carousels.

const SPAN_DEFAULT: Record<string, number> = {
  kpi_card: 3, interactive_chart: 6, button: 3, toggle: 4, tooltip: 2, progress: 4,
};
function defaultSpan(type: string): number {
  return SPAN_DEFAULT[type] ?? 12;
}

function estHeight(layer: Layer): number {
  const l = layer as unknown as Record<string, unknown>;
  // Explicit user-set flow height wins (set by canvas height-resize). The
  // computed `height` field is rewritten every layout pass, so it can't store
  // intent — flow_h does.
  if (typeof l['flow_h'] === 'number' && l['flow_h'] > 0) return l['flow_h'] as number;
  const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  switch (layer.type) {
    case 'kpi_card': return 124;
    case 'interactive_chart': return num(l['height'], 340);
    case 'interactive_table': return 380;
    case 'rich_text': return Math.max(40, Math.round(num(l['font_size'], 16) * 1.5) + 20);
    case 'button': return 52;
    case 'toggle': return 54;
    case 'filter_bar': return 60;
    case 'callout': return 100;
    case 'progress': return l['style'] === 'radial' ? 130 : 78;
    case 'tooltip': return 40;
    case 'tabs': return num(l['height'], 330) + 70;
    case 'accordion': return (Array.isArray(l['items']) ? (l['items'] as unknown[]).length : 3) * 56 + 90;
    case 'popup': return 180;
    default: return 80;
  }
}

export interface FlowLayoutOpts {
  containerWidth?: number;
  gap?: number;
  padX?: number;
  padY?: number;
}

export interface FlowLayoutResult { width: number; height: number; }

export interface FlowGridMetrics {
  containerWidth: number;
  gap: number;
  padX: number;
  padY: number;
  /** Width of a single grid column in px. */
  colW: number;
}

// The single source of truth for flow geometry — computeFlowLayout, the canvas
// grid overlay, and the width↔span mapping all derive from this so they stay
// pixel-aligned. Defaults match computeFlowLayout's.
export function flowGridMetrics(opts: FlowLayoutOpts = {}): FlowGridMetrics {
  const containerWidth = opts.containerWidth ?? 1200;
  const gap = opts.gap ?? 22;
  const padX = opts.padX ?? 40;
  const padY = opts.padY ?? 48;
  const inner = containerWidth - 2 * padX;
  const colW = (inner - 11 * gap) / 12;
  return { containerWidth, gap, padX, padY, colW };
}

/** Left x (px) of column index `col` (0-based) in the flow grid. */
export function flowColumnX(col: number, m: FlowGridMetrics): number {
  return m.padX + col * (m.colW + m.gap);
}

/** Pixel width of a span (1–12 columns) including inter-column gaps. */
export function flowSpanWidth(span: number, m: FlowGridMetrics): number {
  const s = Math.max(1, Math.min(12, span));
  return s * m.colW + (s - 1) * m.gap;
}

export function computeFlowLayout(layers: Layer[], opts: FlowLayoutOpts = {}): FlowLayoutResult {
  const m = flowGridMetrics(opts);
  const cw = m.containerWidth;
  const gap = m.gap;
  const padX = m.padX;
  const padY = m.padY;
  const colW = m.colW;

  let colsUsed = 0;
  let rowTop = padY;
  let rowMaxH = 0;

  for (const l of layers) {
    const span = Math.max(1, Math.min(12, Math.round((l as { span?: number }).span ?? defaultSpan(l.type))));
    if (colsUsed > 0 && colsUsed + span > 12) { rowTop += rowMaxH + gap; colsUsed = 0; rowMaxH = 0; }
    const w = span * colW + (span - 1) * gap;
    const x = padX + colsUsed * (colW + gap);
    const h = estHeight(l);
    const m = l as unknown as Record<string, unknown>;
    m['x'] = Math.round(x);
    m['y'] = Math.round(rowTop);
    m['width'] = Math.round(w);
    m['height'] = h;
    colsUsed += span;
    rowMaxH = Math.max(rowMaxH, h);
    if (colsUsed >= 12) { rowTop += rowMaxH + gap; colsUsed = 0; rowMaxH = 0; }
  }

  const totalH = rowTop + (colsUsed > 0 ? rowMaxH + gap : 0) + padY;
  return { width: cw, height: Math.max(Math.round(totalH), 240) };
}

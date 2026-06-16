// Folio editor canvas — low-level 2D drawing helpers (rulers, gap annotations).
// Extracted from canvas.ts. Pure canvas-2d functions, no class state.
import type { RulerUnit } from './state';
import { computeRulerTicks } from '../utils/ruler-units';

export const RULER_SIZE = 20; // px width/height of ruler strips

export function drawRuler(
  ctx: CanvasRenderingContext2D,
  length: number,
  thickness: number,
  zoom: number,
  pan: number,
  axis: 'h' | 'v',
  unit: RulerUnit = 'px',
): void {
  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  const bg      = isDark ? '#1e1e2e' : '#f0efee';
  const border  = isDark ? '#2d2d4e' : '#d1cfc9';
  const tickClr = isDark ? '#555577' : '#aaa9a5';
  const textClr = isDark ? '#7a7a9a' : '#888682';

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0,
    axis === 'h' ? length : thickness,
    axis === 'h' ? thickness : length,
  );

  // Border line along the canvas edge
  ctx.fillStyle = border;
  if (axis === 'h') {
    ctx.fillRect(0, thickness - 1, length, 1);
  } else {
    ctx.fillRect(thickness - 1, 0, 1, length);
  }

  ctx.font = `9px sans-serif`;
  ctx.textBaseline = 'top';

  // Design-px range visible in the viewport
  const startDesignPx = -pan / zoom;
  const endDesignPx   = (length / zoom) - pan / zoom;

  const ticks = computeRulerTicks(startDesignPx, endDesignPx, unit, zoom);

  for (const tick of ticks) {
    const screenPx = Math.round(tick.px * zoom + pan);
    if (screenPx < 0 || screenPx > length) continue;

    if (axis === 'h') {
      ctx.fillStyle = tickClr;
      ctx.fillRect(screenPx, thickness - 6, 1, 6);
      ctx.fillStyle = textClr;
      ctx.fillText(tick.label, screenPx + 2, 2);
    } else {
      ctx.fillStyle = tickClr;
      ctx.fillRect(thickness - 6, screenPx, 6, 1);
      ctx.save();
      ctx.fillStyle = textClr;
      ctx.translate(2, screenPx - 1);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(tick.label, 0, 0);
      ctx.restore();
    }
  }
}

// ── Distance annotation helpers ──────────────────────────────

export function measureGaps(
  sel: SVGRect,
  ref: SVGRect,
): { left: number | null; right: number | null; top: number | null; bottom: number | null } {
  const left   = sel.x > ref.x + ref.width  ? sel.x - (ref.x + ref.width)  : null;
  const right  = ref.x > sel.x + sel.width  ? ref.x - (sel.x + sel.width)  : null;
  const top    = sel.y > ref.y + ref.height ? sel.y - (ref.y + ref.height) : null;
  const bottom = ref.y > sel.y + sel.height ? ref.y - (sel.y + sel.height) : null;
  return { left, right, top, bottom };
}

export function drawArrowLine(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number,
  x2: number, y2: number,
): void {
  if (Math.abs(x2 - x1) < 2 && Math.abs(y2 - y1) < 2) return;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  // Small end ticks
  const isH = Math.abs(y2 - y1) < Math.abs(x2 - x1);
  ctx.setLineDash([]);
  ctx.beginPath();
  if (isH) {
    ctx.moveTo(x1, y1 - 4); ctx.lineTo(x1, y1 + 4);
    ctx.moveTo(x2, y2 - 4); ctx.lineTo(x2, y2 + 4);
  } else {
    ctx.moveTo(x1 - 4, y1); ctx.lineTo(x1 + 4, y1);
    ctx.moveTo(x2 - 4, y2); ctx.lineTo(x2 + 4, y2);
  }
  ctx.stroke();
  ctx.setLineDash([3, 3]);
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  text: string,
): void {
  const w = ctx.measureText(text).width + 6;
  ctx.setLineDash([]);
  ctx.fillStyle = '#e94560';
  ctx.fillRect(x - w / 2, y - 10, w, 14);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x - w / 2 + 3, y);
  ctx.setLineDash([3, 3]);
  ctx.fillStyle = '#e94560';
}


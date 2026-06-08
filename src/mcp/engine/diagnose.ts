// Structured design diagnostics for the diagnose_design MCP tool — the engine's
// built-in troubleshooter. Geometry-aware checks the model is blind to:
// off-canvas, collisions, misalignment (incl. near-miss "almost aligned"),
// tiny text. Folds in the existing composition lint + quality critic, all as
// structured findings with fixes. Pure — no I/O.

import type { Layer } from '../../schema/types';
import { lintComposition, reviewComposition } from './design-lint';

export interface Finding {
  code: string;
  severity: 'error' | 'warning' | 'suggestion';
  message: string;
  layer_id?: string;
  fix?: string;
}

interface Box { id: string; type: string; z: number; x: number; y: number; w: number; h: number; }

function box(l: Layer): Box | null {
  const p = (l as { pos?: unknown }).pos;
  let x: unknown, y: unknown, w: unknown, h: unknown;
  if (Array.isArray(p) && p.length >= 4) { [x, y, w, h] = p; }
  else { x = l.x; y = l.y; w = l.width; h = l.height; }
  if ([x, y, w, h].some(v => typeof v !== 'number')) return null;
  return { id: l.id, type: l.type, z: typeof l.z === 'number' ? l.z : 0, x: x as number, y: y as number, w: w as number, h: h as number };
}

// Top-level layers only (group children are positioned relative to their parent
// in some layouts; collision/alignment is judged at the canvas level).
function boxes(layers: Layer[]): Box[] {
  return layers.map(box).filter((b): b is Box => b !== null);
}

function overlapArea(a: Box, b: Box): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

const FULL_BG = (b: Box, W: number, H: number): boolean => b.w * b.h >= W * H * 0.85 && b.x <= 2 && b.y <= 2;
const SIZED = new Set(['rect', 'image', 'icon', 'ellipse', 'circle', 'group', 'chart', 'kpi_card', 'path', 'text', 'qrcode', 'polygon']);

// ── geometry checks ─────────────────────────────────────────
function geometryFindings(layers: Layer[], W: number, H: number): Finding[] {
  const out: Finding[] = [];
  const bs = boxes(layers).filter(b => SIZED.has(b.type));

  // Off-canvas.
  for (const b of bs) {
    if (b.x < -4 || b.y < -4 || b.x + b.w > W + 4 || b.y + b.h > H + 4) {
      out.push({
        code: 'off_canvas', severity: 'error', layer_id: b.id,
        message: `"${b.id}" extends outside the ${W}×${H} canvas (x:${Math.round(b.x)} y:${Math.round(b.y)} w:${Math.round(b.w)} h:${Math.round(b.h)}) — it will be clipped.`,
        fix: `Move/resize it inside [0,0,${W},${H}].`,
      });
    }
  }

  // Tiny text.
  for (const l of layers) {
    if (l.type !== 'text') continue;
    const fs = (l as { style?: { font_size?: number } }).style?.font_size;
    if (typeof fs === 'number' && fs > 0 && fs < 12) {
      out.push({ code: 'tiny_text', severity: 'warning', layer_id: l.id, message: `text "${l.id}" is ${fs}px — too small to read comfortably.`, fix: 'Use ≥14px for body, ≥12px minimum.' });
    }
  }

  // Collisions — two same-kind content layers (text↔text, icon↔icon) that overlap
  // are almost always an accidental pile-up (the #1 hand-placement failure).
  const content = bs.filter(b => !FULL_BG(b, W, H) && (b.type === 'text' || b.type === 'icon' || b.type === 'kpi_card'));
  for (let i = 0; i < content.length; i++) {
    for (let j = i + 1; j < content.length; j++) {
      const a = content[i], c = content[j];
      if (a.type !== c.type) continue;
      const ov = overlapArea(a, c);
      const minArea = Math.min(a.w * a.h, c.w * c.h);
      if (minArea > 0 && ov / minArea > 0.3) {
        out.push({
          code: 'collision', severity: 'warning', layer_id: a.id,
          message: `"${a.id}" and "${c.id}" (both ${a.type}) overlap by ${Math.round((ov / minArea) * 100)}% — likely a collision / illegible pile-up.`,
          fix: 'Space them apart, or use one auto_layout/row/column container so the engine lays them out without overlap.',
        });
      }
    }
  }

  // Alignment near-miss — edges within 1–6px of each other read as a sloppy
  // misalignment (the eye sees "almost lined up"). Suggest snapping.
  const edges: Array<{ id: string; edge: string; v: number }> = [];
  for (const b of bs) {
    if (FULL_BG(b, W, H)) continue;
    edges.push({ id: b.id, edge: 'left', v: b.x }, { id: b.id, edge: 'top', v: b.y });
  }
  const seenPairs = new Set<string>();
  for (let i = 0; i < edges.length; i++) {
    for (let j = i + 1; j < edges.length; j++) {
      if (edges[i].edge !== edges[j].edge || edges[i].id === edges[j].id) continue;
      const d = Math.abs(edges[i].v - edges[j].v);
      const key = [edges[i].id, edges[j].id, edges[i].edge].sort().join('|');
      if (d >= 1 && d <= 6 && !seenPairs.has(key)) {
        seenPairs.add(key);
        out.push({
          code: 'misalignment', severity: 'suggestion', layer_id: edges[i].id,
          message: `"${edges[i].id}" and "${edges[j].id}" are almost ${edges[i].edge}-aligned (off by ${d.toFixed(1)}px).`,
          fix: `Snap both ${edges[i].edge} edges to the same value, or call align_layers.`,
        });
      }
    }
  }

  return out;
}

/** Run all diagnostics over a page's layers. */
export function analyzeLayers(layers: Layer[], W: number, H: number): Finding[] {
  const out = geometryFindings(layers, W, H);
  // Fold composition lint (render-correctness) as warnings/errors.
  for (const note of lintComposition(layers, W, H)) {
    const severity: Finding['severity'] = /invisible|outside|No full-canvas/.test(note) ? 'warning' : 'warning';
    out.push({ code: 'composition', severity, message: note });
  }
  // Fold quality critic as suggestions.
  for (const note of reviewComposition(layers, W, H)) {
    out.push({ code: 'quality', severity: 'suggestion', message: note });
  }
  return out;
}

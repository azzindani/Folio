// Composition lint — catches the silent-but-deadly authoring failures an LLM
// makes that PASS schema validation yet render badly: invisible/low-contrast
// text, text whose colored "chip" is too small (so it spills onto the canvas
// and vanishes), a missing background, and off-canvas layers. Returned as
// add_layers notes so the model self-corrects before seal_design.
//
// Pure — no I/O. Reuses the color math from ./reference.

import type { Layer } from '../../schema/types';
import { hexToRgb, luminance, type RGB } from './reference';

interface Rect { x: number; y: number; w: number; h: number }

function rectOf(l: Layer): Rect | null {
  const p = (l as { pos?: unknown }).pos;
  let x: unknown, y: unknown, w: unknown, h: unknown;
  if (Array.isArray(p) && p.length >= 4) { [x, y, w, h] = p; }
  else { x = l.x; y = l.y; w = l.width; h = l.height; }
  if ([x, y, w, h].some(v => typeof v !== 'number')) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

/** First hex color of a solid or gradient fill; null for tokens/none/images. */
function solidColor(l: Layer): string | null {
  const f = (l as { fill?: unknown }).fill;
  if (typeof f === 'string') return f.startsWith('#') ? f : null;
  if (f && typeof f === 'object') {
    const o = f as { type?: string; color?: string; stops?: { color?: string }[] };
    if (typeof o.color === 'string' && o.color.startsWith('#')) return o.color;
    const s = o.stops?.[0]?.color;
    if (typeof s === 'string' && s.startsWith('#')) return s;
  }
  return null;
}

function textColor(l: Layer): string | null {
  const c = (l as { style?: { color?: unknown } }).style?.color;
  return typeof c === 'string' && c.startsWith('#') ? c : null;
}

function textValue(l: Layer): string {
  const v = (l as { content?: { value?: unknown } }).content?.value;
  return typeof v === 'string' ? v : '';
}

function contains(outer: Rect, inner: Rect): boolean {
  return outer.x <= inner.x + 0.5 && outer.y <= inner.y + 0.5
    && outer.x + outer.w >= inner.x + inner.w - 0.5
    && outer.y + outer.h >= inner.y + inner.h - 0.5;
}

function contrast(a: RGB | null, b: RGB | null): number | null {
  if (!a || !b) return null;
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const OPAQUE_BACKDROP = new Set(['image', 'chart', 'video', 'mermaid', 'code', 'math']);
const SIZED = new Set(['rect', 'image', 'icon', 'ellipse', 'group', 'chart', 'kpi_card']);

/** Returns human-readable composition notes (empty = clean). */
export function lintComposition(layers: Layer[], canvasW: number, canvasH: number): string[] {
  const notes: string[] = [];
  const z = (l: Layer): number => (typeof l.z === 'number' ? l.z : 0);

  // 1. Full-canvas background present?
  const bgRect = layers
    .filter(l => solidColor(l) && (() => { const r = rectOf(l); return r ? r.w * r.h >= canvasW * canvasH * 0.9 && r.x <= 2 && r.y <= 2 : false; })())
    .sort((a, b) => z(a) - z(b))[0];
  const bgColor = bgRect ? solidColor(bgRect) : null;
  if (!bgRect) {
    notes.push(`No full-canvas background — add a rect at z:0 pos:[0,0,${canvasW},${canvasH}] with a solid fill so the canvas isn't blank/white.`);
  }

  // 2. Invisible / low-contrast text (also catches a chip too small to cover the text).
  for (const t of layers) {
    if (t.type !== 'text') continue;
    if (((t as { opacity?: number }).opacity ?? 1) < 0.6) continue;
    const tc = textColor(t), tr = rectOf(t);
    if (!tc || !tr || !textValue(t).trim()) continue;
    const beneath = layers.filter(o => o !== t && z(o) <= z(t) && rectOf(o) && contains(rectOf(o)!, tr));
    if (beneath.some(o => OPAQUE_BACKDROP.has(o.type))) continue; // text over a photo — backdrop unknown
    const chip = beneath.filter(o => solidColor(o)).sort((a, b) => z(a) - z(b)).pop();
    const backdrop = (chip ? solidColor(chip) : bgColor) ?? '#FFFFFF';
    const cr = contrast(hexToRgb(tc), hexToRgb(backdrop));
    if (cr !== null && cr < 2.0) {
      notes.push(`text "${t.id}" (${tc}) is nearly invisible on its background (${backdrop}, contrast ${cr.toFixed(2)}:1). Use a contrasting text color, or ensure a contrasting block fully covers the text box (a chip narrower than the text spills onto the canvas).`);
    }
  }

  // 3. Off-canvas sized layers.
  for (const l of layers) {
    if (!SIZED.has(l.type)) continue;
    const r = rectOf(l);
    if (!r) continue;
    if (r.x < -4 || r.y < -4 || r.x + r.w > canvasW + 4 || r.y + r.h > canvasH + 4) {
      notes.push(`layer "${l.id}" extends outside the ${canvasW}x${canvasH} canvas (x:${Math.round(r.x)} y:${Math.round(r.y)} w:${Math.round(r.w)} h:${Math.round(r.h)}) — it will be clipped.`);
    }
  }

  return notes.slice(0, 8);
}

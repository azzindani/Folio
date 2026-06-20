// Composition lint — catches the silent-but-deadly authoring failures an LLM
// makes that PASS schema validation yet render badly: invisible/low-contrast
// text, text whose colored "chip" is too small (so it spills onto the canvas
// and vanishes), a missing background, and off-canvas layers. Returned as
// add_layers notes so the model self-corrects before seal_design.
//
// Pure — no I/O. Reuses the color math from ./reference.

import type { Layer } from '../../schema/types';
import { hexToRgb, luminance, saturation, hue, type RGB } from './reference';
import { findTextOverflows } from './text-measure';

interface Rect { x: number; y: number; w: number; h: number }

function rectOf(l: Layer): Rect | null {
  const p = (l as { pos?: unknown }).pos;
  let x: unknown, y: unknown, w: unknown, h: unknown;
  if (Array.isArray(p) && p.length >= 4) { [x, y, w, h] = p; }
  else { x = l.x; y = l.y; w = l.width; h = l.height; }
  if ([x, y, w, h].some(v => typeof v !== 'number')) return null;
  return { x: x as number, y: y as number, w: w as number, h: h as number };
}

/** First hex color of a solid/gradient/pattern fill; null for tokens/none/images. */
function solidColor(l: Layer): string | null {
  const f = (l as { fill?: unknown }).fill;
  if (typeof f === 'string') return f.startsWith('#') ? f : null;
  if (f && typeof f === 'object') {
    const o = f as { type?: string; color?: string; bg?: string; fg?: string; stops?: { color?: string }[] };
    if (typeof o.color === 'string' && o.color.startsWith('#')) return o.color;
    // Pattern fill — the panel reads as its bg (or fg) for backdrop/contrast.
    if (o.type === 'pattern') {
      const pc = o.bg ?? o.fg;
      if (typeof pc === 'string' && pc.startsWith('#')) return pc;
    }
    const s = o.stops?.[0]?.color;
    if (typeof s === 'string' && s.startsWith('#')) return s;
  }
  // A SHAPE carrying its fill under top-level `color` (the renderer honors this as
  // a solid fill) — without it a `color`-only bg rect is invisible to the backdrop
  // check → a FALSE "no background" / "text invisible on #FFFFFF" note. Gated to
  // shapes so a text layer's `color` (its text color) isn't misread as a fill.
  if (f === undefined && (l.type === 'rect' || l.type === 'ellipse' || l.type === 'circle' || l.type === 'polygon' || l.type === 'path')) {
    const c = (l as { color?: unknown }).color;
    if (typeof c === 'string' && c.startsWith('#')) return c;
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

function fontSize(l: Layer): number | null {
  const s = (l as { style?: { font_size?: unknown } }).style?.font_size;
  return typeof s === 'number' ? s : null;
}

function align(l: Layer): string | undefined {
  return (l as { style?: { align?: string } }).style?.align;
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

  // 1. Full-canvas background present? Also look one level into group/preset
  //    layers (marble_bg / backdrop wrap their full-canvas rect in a group).
  // Accept a theme-TOKEN fill ($surface / $background / $primary …) as a real
  // background too. solidColor is hex-only (it feeds contrast math), so a base
  // rect filled with a token used to be invisible to this check → a FALSE "no
  // full-canvas background" note that tells the model to redo a poster that
  // already HAS a background (a real blank-design false alarm).
  const solidOrTokenFill = (l: Layer): boolean => {
    if (solidColor(l)) return true;
    const f = (l as { fill?: unknown }).fill;
    const c = typeof f === 'string' ? f : (f && typeof f === 'object' ? (f as { color?: unknown }).color : undefined);
    return typeof c === 'string' && c.startsWith('$');
  };
  const isFullCanvasSolid = (l: Layer): boolean => {
    if (!solidOrTokenFill(l)) return false;
    const r = rectOf(l);
    return r ? r.w * r.h >= canvasW * canvasH * 0.9 && r.x <= 2 && r.y <= 2 : false;
  };
  const bgCandidates: Layer[] = [];
  for (const l of layers) {
    if (isFullCanvasSolid(l)) bgCandidates.push(l);
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) for (const k of kids) if (isFullCanvasSolid(k)) bgCandidates.push(k);
  }
  const bgRect = bgCandidates.sort((a, b) => z(a) - z(b))[0];
  const bgColor = bgRect ? solidColor(bgRect) : null;
  if (!bgRect) {
    notes.push(`No full-canvas background — add a rect at z:0 pos:[0,0,${canvasW},${canvasH}] with a solid fill so the canvas isn't blank/white.`);
  }

  // 1b. Empty-value text placeholders — the model built a card/slot structure but
  //     left the value BLANK (the Flowstate pricing: every tier card had value:''
  //     where the $/mo price belongs, plus no features). It LOOKS designed but the
  //     data is missing, and a vision-less model can't see the gap. Recurse into
  //     preset groups (the slots are nested) and surface it so the model fills the
  //     real content instead of shipping an empty shell. Only flag SIZED text (a
  //     real display slot), never an incidental empty string.
  const emptyIds: string[] = [];
  const scanEmpty = (ls: Layer[]): void => {
    for (const l of ls) {
      if (l.type === 'text') { const fs = fontSize(l); if (fs && fs > 0 && !textValue(l).trim()) emptyIds.push(String(l.id ?? '?')); }
      const kids = (l as { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) scanEmpty(kids);
    }
  };
  scanEmpty(layers);
  if (emptyIds.length) {
    notes.push(`${emptyIds.length} text slot(s) are EMPTY (${emptyIds.slice(0, 5).join(', ')}${emptyIds.length > 5 ? '…' : ''}) — placeholder(s) the model never filled (e.g. a price/stat). The render shows a blank where the data belongs. Fill each with the real value from the brief (update_layer/patch_design), or remove it — don't ship an empty shell.`);
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

  // 4. Text overflow — box too short for the wrapped text, so it spills and
  //    collides with layers below. The #1 thing a vision-less model can't see.
  for (const o of findTextOverflows(layers, canvasH)) {
    const where = o.collides.length ? `, overlapping ${o.collides.length} layer(s) below` : o.offBottom ? ', running off the canvas bottom' : '';
    notes.push(`text "${o.id}" (${o.fontSize}px) needs ~${o.estH}px for ~${o.lines} wrapped lines but its box is only ${o.declaredH}px tall — it spills ~${o.spill}px${where}. Raise height to ≥${o.estH}px, shrink font_size, or use a preset that auto-sizes.`);
  }

  // 5. Invisible decor — a sized shape whose fill barely contrasts the canvas it
  //    sits on adds NOTHING (the model thinks it added a visual accent, but it's
  //    not there — a vision-less blind spot). Flag only the clearly-invisible.
  if (bgColor) {
    const DECOR = new Set(['rect', 'ellipse', 'circle', 'path', 'polygon']);
    for (const l of layers) {
      if (l === bgRect || !DECOR.has(l.type)) continue;
      if (((l as { opacity?: number }).opacity ?? 1) < 0.5) continue; // intentionally faint
      const fc = solidColor(l), r = rectOf(l);
      if (!fc || !r) continue;
      if (r.w * r.h >= canvasW * canvasH * 0.6) continue; // large panel, not an accent
      const cr = contrast(hexToRgb(fc), hexToRgb(bgColor));
      if (cr !== null && cr < 1.2) {
        notes.push(`decor "${l.id}" (${fc}) is nearly invisible on the background (${bgColor}, contrast ${cr.toFixed(2)}:1) — it adds no visible element. Give it a contrasting color (or the accent), or remove it.`);
      }
    }
  }

  return notes.slice(0, 8);
}

// ── Design-quality critic ─────────────────────────────────────
// Beyond "does it render" (lintComposition), this flags MEDIOCRITY — the
// happy-path output that's legible but flat. Advisory notes that push the
// model toward hierarchy, restraint, margins and a grid. Conservative on
// purpose (only clear weaknesses) so it guides without nagging.
export function reviewComposition(layers: Layer[], canvasW: number, _canvasH: number): string[] {
  const notes: string[] = [];
  const texts = layers.filter(l => l.type === 'text' && textValue(l).trim());

  // 1. Hierarchy — is there a dominant headline (one clear focal point)?
  const sizes = texts.map(fontSize).filter((n): n is number => typeof n === 'number');
  if (sizes.length >= 3) {
    const max = Math.max(...sizes);
    const rest = sizes.filter(s => s < max).sort((a, b) => a - b);
    const median = rest.length ? rest[Math.floor(rest.length / 2)] : max;
    if (median > 0 && max / median < 2.2) {
      notes.push(`weak hierarchy — the largest text is ${max}px, only ${(max / median).toFixed(1)}× the body (${median}px). Give the poster ONE dominant headline ~3–5× the body so the eye has a focal point.`);
    }
  }

  // 2. Accent discipline — how many distinct VIVID colors are in play?
  const hues = new Set<number>();
  for (const l of layers) {
    const c = textColor(l) ?? solidColor(l);
    const rgb = c ? hexToRgb(c) : null;
    if (!rgb) continue;
    if (saturation(rgb) > 0.4 && luminance(rgb) > 0.12 && luminance(rgb) < 0.92) hues.add(Math.round(hue(rgb) / 30));
  }
  if (hues.size > 3) {
    notes.push(`accent sprawl — ${hues.size} different vivid colors. Designed work commits to ONE accent (+ neutrals) and lets type & whitespace carry the rest; collapse the palette.`);
  }

  // 3. Margins — left-anchored text crowding the canvas edge.
  const m = Math.round(canvasW * 0.03);
  const leftCrowd = texts.filter(t => { const r = rectOf(t); return r && r.x < m && align(t) !== 'right' && r.w < canvasW * 0.8; });
  if (leftCrowd.length) {
    notes.push(`text crowds the edge (${leftCrowd.length} layer(s) at x<${m}px) — hold a consistent margin (~${Math.round(canvasW * 0.06)}px) so the layout breathes.`);
  }

  // 4. Grid — left-aligned text should snap to 1–2 columns, not scatter.
  const lefts = texts.filter(t => align(t) !== 'center' && align(t) !== 'right')
    .map(t => rectOf(t)?.x).filter((n): n is number => typeof n === 'number')
    .map(x => Math.round(x / 8) * 8);
  if (new Set(lefts).size > 4) {
    notes.push(`inconsistent alignment — ${new Set(lefts).size} different left edges. Snap left-aligned text to 1–2 columns (a margin + one indent) for a tidy grid.`);
  }

  return notes.slice(0, 4);
}

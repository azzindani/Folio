// Folio MCP — preset fit-to-box.
//
// Every layout preset (sections/versus/list/timeline/stat/…) sizes its type and
// spacing from the box WIDTH and then grows DOWNWARD to whatever height the
// content needs. On a portrait poster that is correct — the page is as tall as
// the story. On a fixed landscape slide it is a silent clipping bug: a `sections`
// page handed pos:[0,0,1920,1080] measures ~1536px tall and the bottom third
// renders off-canvas, because the explicit height was only ever a suggestion.
//
// This module makes an EXPLICIT height a HARD bound. When the built preset
// overflows the box the model asked for, the subtree is uniformly scaled to fit
// (fonts, spacing and geometry all shrink together, so proportions survive) and
// centered horizontally; full-bleed backdrops are stretched back to the box so no
// unpainted strip appears. Scale has a legibility floor — below it the preset is
// compressed as far as it can go and the overflow is REPORTED rather than hidden,
// so `diagnose_design` and the tool response both tell the truth.
//
// Uniform scale is used deliberately: it is one pass over the tree, works for
// every preset without per-preset code, and is pure spatial math — the engine's
// job — leaving the design decisions to the model.
import type { Layer } from '../schema/types';

import type { ShorthandLayer } from './shorthand-helpers';

/** Below this the type is no longer legible; compress no further and report. */
export const PRESET_FIT_MIN_SCALE = 0.55;

/** Preset types whose builders own their own layout and can outgrow the box. */
const FITTABLE = new Set<string>([
  'feature_grid', 'editorial', 'poster', 'split', 'list', 'steps', 'checklist',
  'numbered_list', 'stat', 'metric', 'big_number', 'event', 'flyer', 'hero',
  'sections', 'infographic', 'document', 'report_poster', 'timeline', 'roadmap',
  'history', 'milestones', 'mindmap', 'mind_map', 'brainstorm', 'concept_map',
  'process_cards', 'pricing', 'plans', 'tiers', 'price_table', 'versus',
  'compare', 'comparison', 'vs', 'ribbon_cards', 'tip_cards', 'ribbon',
  'value_list', 'values', 'tips_list', 'newsletter', 'bulletin', 'digest',
]);

/** Is this a layout preset — a type whose builder owns the whole layout, and
 *  whose authored spec is therefore worth keeping? */
export function isFittablePreset(type: string): boolean {
  return FITTABLE.has(type);
}

/** What happened to one preset that did not fit its declared box. */
export interface PresetFitReport {
  /** Layer id of the preset group. */
  id: string;
  /** Preset type as the model wrote it. */
  preset: string;
  /** Height the content actually needed at the declared width. */
  natural_height: number;
  /** Height the model declared via pos[3] / height. */
  box_height: number;
  /** Uniform scale applied (1 = untouched). */
  scale: number;
  /** Pixels still overflowing after compression (0 = fits). */
  overflow: number;
  /** Model-facing sentence: what happened and what to do about it. */
  note: string;
}

const reports: PresetFitReport[] = [];

/** Clear the buffer — called at the start of every expansion run. */
export function resetPresetFitReports(): void {
  reports.length = 0;
}

/** Take (and clear) the fit reports collected during the last expansion. */
export function drainPresetFitReports(): PresetFitReport[] {
  const out = reports.slice();
  reports.length = 0;
  return out;
}

/** The box height the MODEL declared, or undefined when it left sizing to the
 *  engine. Only an explicit pos[3]/height counts — an absent height means "as
 *  tall as the content needs", which is the poster behaviour and stays intact. */
export function declaredBoxHeight(sh: ShorthandLayer): number | undefined {
  const h = sh.pos?.[3] ?? (typeof sh.height === 'number' ? sh.height : undefined);
  return typeof h === 'number' && h > 0 ? h : undefined;
}

/** Mark every preset on a PAGED design (carousel/presentation) as living on a
 *  canvas that cannot grow. A poster's canvas is elastic — the document resizes
 *  to whatever the content measures, so an over-tall preset is auto-fit, not a
 *  clip. A slide's canvas is fixed by the deck, so the same overflow renders off
 *  the edge and the declared box has to bind. Returns how many were stamped. */
export function stampFixedCanvas(layers: ShorthandLayer[]): number {
  let n = 0;
  for (const sh of layers) {
    if (!sh || typeof sh !== 'object' || Array.isArray(sh)) continue;
    const r = sh as unknown as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (!FITTABLE.has(t)) continue;
    r['__fixedCanvas'] = true;
    n++;
  }
  return n;
}

// ── Path data ───────────────────────────────────────────────
// A `path` layer renders its raw `d` — the x/y/width/height box is NOT a
// transform — so scaling the subtree has to scale the coordinates inside `d`
// too, or every motif and connector stays at its original size while the rest of
// the preset shrinks around it. Per-command arity, with only the LENGTH and
// COORDINATE arguments touched: an arc's rotation and its two flags are not
// distances and corrupt the curve if scaled.

const ARITY: Record<string, number> = { m: 2, l: 2, t: 2, h: 1, v: 1, c: 6, s: 4, q: 4, a: 7, z: 0 };

/** Scale one path's coordinates about (ox,oy) by k, then shift x by dx. */
export function scalePathD(d: string, k: number, ox: number, oy: number, dx: number): string {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return d;
  const sx = (v: number): number => ox + dx + (v - ox) * k;
  const sy = (v: number): number => oy + (v - oy) * k;
  const out: string[] = [];
  let cmd = '';
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    if (/[a-zA-Z]/.test(t)) { cmd = t; out.push(t); i++; continue; }
    const lower = cmd.toLowerCase();
    const n = ARITY[lower];
    if (n === undefined || n === 0) { out.push(t); i++; continue; }
    const rel = cmd !== cmd.toUpperCase();
    const args = tokens.slice(i, i + n).map(Number);
    if (args.length < n || args.some(v => !Number.isFinite(v))) { out.push(t); i++; continue; }
    const mapped = args.map((v, j) => {
      if (lower === 'a') {
        if (j === 0 || j === 1) return v * k;            // rx, ry — lengths
        if (j === 2 || j === 3 || j === 4) return v;      // x-rotation + both flags
        return rel ? v * k : (j === 5 ? sx(v) : sy(v));
      }
      if (lower === 'h') return rel ? v * k : sx(v);
      if (lower === 'v') return rel ? v * k : sy(v);
      return rel ? v * k : (j % 2 === 0 ? sx(v) : sy(v));
    });
    for (const v of mapped) out.push(String(Math.round(v * 100) / 100));
    i += n;
  }
  return out.join(' ').replace(/\s*([a-zA-Z])\s*/g, '$1');
}

// ── Subtree scaling ─────────────────────────────────────────
// Length-valued keys, scaled wherever they appear in a layer or its style. Ratio
// and colour fields (line_height, opacity, weight) are deliberately absent —
// they are not distances and must survive compression unchanged.

const SIZE_KEYS = new Set<string>([
  'font_size', 'letter_spacing', 'stroke_width', 'radius', 'corner_radius',
  'icon_size', 'gap', 'padding', 'blur', 'spread', 'offset_x', 'offset_y',
  'arrow_size', 'bar_width', 'thickness', 'dash', 'size',
]);

function scaleLengths(node: unknown, k: number, depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) { for (const v of node) scaleLengths(v, k, depth + 1); return; }
  const o = node as Record<string, unknown>;
  for (const [key, v] of Object.entries(o)) {
    if (typeof v === 'number' && SIZE_KEYS.has(key)) { o[key] = Math.round(v * k * 100) / 100; continue; }
    // `width` is a length only inside a stroke descriptor — anywhere else it is
    // a layer box already handled by the geometry pass.
    if (key === 'stroke' && v && typeof v === 'object' && typeof (v as Record<string, unknown>)['width'] === 'number') {
      const s = v as Record<string, unknown>;
      s['width'] = Math.max(0.5, Math.round((s['width'] as number) * k * 100) / 100);
      continue;
    }
    if (v && typeof v === 'object' && key !== 'layers' && key !== 'content') scaleLengths(v, k, depth + 1);
  }
}

/** Scale one layer subtree about (ox,oy) by k, shifting x by dx. Children carry
 *  ABSOLUTE document coordinates (a group renders as a bare <g> with no
 *  transform), so every node is rewritten rather than the group box alone. */
function scaleSubtree(layer: Layer, k: number, ox: number, oy: number, dx: number): void {
  const o = layer as unknown as Record<string, unknown>;
  const num = (key: string): number | undefined => (typeof o[key] === 'number' ? o[key] as number : undefined);
  const px = (v: number): number => Math.round(ox + dx + (v - ox) * k);
  const py = (v: number): number => Math.round(oy + (v - oy) * k);

  const x = num('x'), y = num('y'), w = num('width'), h = num('height');
  if (x !== undefined) o['x'] = px(x);
  if (y !== undefined) o['y'] = py(y);
  if (w !== undefined) o['width'] = Math.max(1, Math.round(w * k));
  if (h !== undefined) o['height'] = Math.max(1, Math.round(h * k));
  for (const key of ['x1', 'x2'] as const) { const v = num(key); if (v !== undefined) o[key] = px(v); }
  for (const key of ['y1', 'y2'] as const) { const v = num(key); if (v !== undefined) o[key] = py(v); }
  if (typeof o['d'] === 'string') o['d'] = scalePathD(o['d'] as string, k, ox, oy, dx);

  scaleLengths(o['style'], k);
  scaleLengths(o['effects'], k);
  for (const key of ['radius', 'corner_radius', 'icon_size', 'gap', 'padding', 'arrow_size'] as const) {
    const v = num(key);
    if (v !== undefined) o[key] = Math.round(v * k * 100) / 100;
  }
  if (o['stroke'] && typeof o['stroke'] === 'object') scaleLengths({ stroke: o['stroke'] }, k);

  const kids = o['layers'];
  if (Array.isArray(kids)) for (const c of kids as Layer[]) scaleSubtree(c, k, ox, oy, dx);
}

// ── Fit ─────────────────────────────────────────────────────

/** Bottom edge of the deepest descendant — the preset's TRUE extent, which can
 *  exceed the height its builder claimed on the group box. */
function subtreeBottom(layer: Layer): number {
  const o = layer as unknown as Record<string, unknown>;
  const y = typeof o['y'] === 'number' ? o['y'] as number : 0;
  const h = typeof o['height'] === 'number' ? o['height'] as number : 0;
  const y2 = typeof o['y2'] === 'number' ? o['y2'] as number : undefined;
  let bottom = Math.max(y + h, y2 ?? 0);
  const kids = o['layers'];
  if (Array.isArray(kids)) for (const c of kids as Layer[]) bottom = Math.max(bottom, subtreeBottom(c));
  return bottom;
}

/** A full-cover backdrop: the painted ground of the preset. It must span the
 *  final box after compression, or the shrunken bg leaves an unpainted strip. */
function isBackdrop(l: Layer, X: number, Y: number, W: number, extent: number): boolean {
  const o = l as unknown as Record<string, unknown>;
  const type = String(o['type'] ?? '');
  if (type !== 'rect' && type !== 'image') return false;
  const x = Number(o['x']) || 0, y = Number(o['y']) || 0;
  const w = Number(o['width']) || 0, h = Number(o['height']) || 0;
  return x <= X + W * 0.02 && y <= Y + extent * 0.02 && w >= W * 0.95 && h >= extent * 0.9;
}

/** Compress a built preset into the height the model explicitly declared.
 *  No declared height, or content that already fits, returns the layer as-is. */
export function fitPresetToBox(sh: ShorthandLayer, layer: Layer, preset: string): Layer {
  if (!FITTABLE.has(preset)) return layer;
  if ((sh as unknown as Record<string, unknown>)['__fixedCanvas'] !== true) return layer;
  const boxH = declaredBoxHeight(sh);
  if (boxH === undefined) return layer;
  const o = layer as unknown as Record<string, unknown>;
  if (o['type'] !== 'group' || !Array.isArray(o['layers'])) return layer;

  const X = Number(o['x']) || 0, Y = Number(o['y']) || 0;
  const W = Number(o['width']) || 0;
  const claimed = Number(o['height']) || 0;
  const extent = Math.round(Math.max(claimed, subtreeBottom(layer) - Y));
  if (extent <= boxH + 2 || extent <= 0 || W <= 0) return layer;

  const need = boxH / extent;
  const k = Math.max(PRESET_FIT_MIN_SCALE, need);
  const dx = (W - W * k) / 2;
  const kids = o['layers'] as Layer[];
  const backdrops = kids.filter(l => isBackdrop(l, X, Y, W, extent));

  for (const c of kids) scaleSubtree(c, k, X, Y, dx);
  for (const b of backdrops) {
    const bo = b as unknown as Record<string, unknown>;
    bo['x'] = X; bo['y'] = Y; bo['width'] = W; bo['height'] = boxH;
  }
  o['height'] = boxH;

  const overflow = Math.max(0, Math.round(extent * k - boxH));
  const scale = Math.round(k * 100) / 100;
  const note = overflow > 0
    ? `${preset} "${o['id']}": content needs ${extent}px at width ${W}; the declared box is ${boxH}px. Compressed to the ${PRESET_FIT_MIN_SCALE}× legibility floor and it STILL overflows by ${overflow}px — cut content (fewer blocks/items, shorter copy) or give it ${extent}px of height.`
    : `${preset} "${o['id']}": content needed ${extent}px at width ${W} but the declared box is ${boxH}px — compressed ${scale}× to fit. Type is ${Math.round(scale * 100)}% of its natural size; splitting the content across two pages reads better than compressing this far.`;
  reports.push({ id: String(o['id'] ?? preset), preset, natural_height: extent, box_height: boxH, scale, overflow, note });
  return layer;
}

/** The height a preset of this type NEEDS at a given width — the per-preset
 *  minimum canvas the shorthand guide quotes, derived from the same natural
 *  aspect the builders produce rather than a hand-maintained table. */
export function presetMinHeight(preset: string, width: number): number | undefined {
  const ratio = MIN_ASPECT[preset];
  return ratio === undefined ? undefined : Math.round(width * ratio);
}

/** Natural height ÷ width for the presets whose content grows vertically.
 *  Measured from the builders' own layouts at a typical content load. */
export const MIN_ASPECT: Record<string, number> = {
  sections: 1.05, infographic: 1.05, document: 1.05, report_poster: 1.05,
  versus: 0.8, list: 0.82, steps: 0.82, checklist: 0.82, numbered_list: 0.82,
  timeline: 0.81, roadmap: 0.81, history: 0.81, milestones: 0.81,
  stat: 0.6, metric: 0.6, big_number: 0.6,
  feature_grid: 0.9, editorial: 1.0, poster: 1.0, split: 0.75,
  pricing: 0.85, plans: 0.85, tiers: 0.85, price_table: 0.85,
  event: 0.95, flyer: 0.95, hero: 0.95, newsletter: 1.1, bulletin: 1.1, digest: 1.1,
  mindmap: 0.8, mind_map: 0.8, brainstorm: 0.8, concept_map: 0.8, process_cards: 0.8,
  ribbon_cards: 0.85, tip_cards: 0.85, ribbon: 0.85,
  value_list: 0.8, values: 0.8, tips_list: 0.8,
};

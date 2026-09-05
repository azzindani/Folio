// Folio MCP — the layout signature.
//
// CLAUDE.md §0.4's litmus is "if a change makes outputs more uniform, it's
// wrong". The review names the failure it is guarding against: N designs that
// converge on one look, "cute" and "creepy" shipping as the same serif card on
// two background tints. Nothing in the engine could SEE that happening, so
// nothing could say it out loud.
//
// A signature is a fingerprint of a design's STYLE with its CONTENT removed —
// structure, composition, palette, type scale, and deliberately not a single
// word of the copy. Two designs with the same signature are the same design
// with different words, which is exactly the thing to detect.
//
// What this module must NOT do: choose a look. It measures and it reports.
// Given "these two share structure and palette", the MODEL decides how to
// diverge — the engine offering a replacement layout is how you get a
// template-stamping engine, and a more uniform one.
import type { DesignSpec, Layer } from '../schema/types';
import { hexToRgb, luminance, saturation, hue } from './engine/color-math';
import { specOf } from './design-spec';

export interface Signature {
  /** What it is made of: preset types + their block kinds, or bare layer types. */
  structure: string;
  /** Where the mass sits: column occupancy, vertical extent, anchor. */
  composition: string;
  /** Ground, accent and how many hues are in play — never the exact hexes. */
  palette: string;
  /** Headline weight relative to the canvas, and to the body. */
  type_scale: string;
  /** One-line display form, for a listing. */
  id: string;
}

interface Box { x: number; y: number; w: number; h: number }

// ── Walking ─────────────────────────────────────────────────

type L = Layer & {
  layers?: Layer[]; x?: number; y?: number; width?: number | 'auto'; height?: number | 'auto';
  fill?: unknown; stroke?: unknown; color?: unknown;
  style?: { font_size?: number; font_family?: string; color?: string; align?: string };
};

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);

/** Pull every hex out of a fill, which is a string, a {color}, or a gradient
 *  with stops — expanded layers use all three. */
function fillHexes(v: unknown, out: string[]): void {
  if (isHex(v)) { out.push(v.toLowerCase()); return; }
  if (!v || typeof v !== 'object') return;
  const o = v as Record<string, unknown>;
  if (isHex(o['color'])) out.push(String(o['color']).toLowerCase());
  const stops = o['stops'];
  if (Array.isArray(stops)) for (const s of stops) fillHexes(s, out);
}

/** The layer's own font size, from wherever this layer kind keeps it. */
const fontSizeOf = (l: L): number => num(l.style?.font_size);
const fontFamilyOf = (l: L): string | undefined => l.style?.font_family;

function boxOf(l: L): Box {
  return { x: num(l.x), y: num(l.y), w: num(l.width), h: num(l.height) };
}

/** Every layer in the tree, groups included, with their absolute boxes.
 *  Preset children already carry absolute coords (the group applies no
 *  transform), so no offset accumulation is needed. */
function walk(layers: Layer[], out: L[] = [], depth = 0): L[] {
  if (depth > 8) return out;
  for (const l of layers) {
    out.push(l as L);
    const kids = (l as L).layers;
    if (Array.isArray(kids)) walk(kids, out, depth + 1);
  }
  return out;
}

/** The layers a viewer reads as content — not the backdrop, not a spacer. */
const INK = new Set(['text', 'rich_text', 'image', 'icon', 'chart', 'kpi_card', 'code', 'math', 'qrcode', 'table', 'mermaid', 'map', 'interactive_chart', 'interactive_table']);

// ── Structure ───────────────────────────────────────────────

/** What the design is BUILT FROM. The strongest signal of sameness: two posters
 *  built from one `sections` preset with the same block kinds are the same
 *  poster, whatever the copy says. */
export function structureOf(layers: Layer[]): string {
  const parts: string[] = [];
  for (const l of layers) {
    const spec = specOf(l)?.spec as Record<string, unknown> | undefined;
    if (spec && typeof spec['type'] === 'string') {
      const blocks = Array.isArray(spec['blocks'])
        ? (spec['blocks'] as Record<string, unknown>[]).map(b => String(b['kind'] ?? '?'))
        : [];
      const items = Array.isArray(spec['items']) ? `×${(spec['items'] as unknown[]).length}` : '';
      const inner = blocks.length ? `[${[...new Set(blocks)].sort().join(',')}]` : items;
      parts.push(`${String(spec['type'])}${inner}`);
      continue;
    }
    parts.push(String((l as L).type));
  }
  const counts = new Map<string, number>();
  for (const p of parts) counts.set(p, (counts.get(p) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join('+') || 'empty';
}

// ── Composition ─────────────────────────────────────────────

/** Column occupancy, vertical extent, and the horizontal anchor.
 *
 *  It measured a 3×3 cell mask first, which was wrong in a way worth recording:
 *  a block of copy one line longer pushes the flow into a different third, so
 *  two designs identical in every other respect scored as different
 *  compositions. That is content length leaking into a style measure — the
 *  exact failure this module exists to catch — so the vertical axis is now read
 *  coarsely (where the ink band sits) while the horizontal one, which the model
 *  actually chooses, stays precise. */
export function compositionOf(layers: Layer[], W: number, H: number): string {
  const all = walk(layers);
  const content = all.filter(l => INK.has(String(l.type)) && num(l.width) > 0 && num(l.height) > 0);
  const bleed = all.some(l => num(l.width) >= W * 0.9 && num(l.height) >= H * 0.9 && !INK.has(String(l.type)));
  if (content.length === 0) return `000/none/none${bleed ? '/bleed' : ''}`;

  // Which thirds of the WIDTH carry ink: 111 is full-measure, 010 a centred
  // column, 110 a left-anchored two-thirds. This is a layout decision.
  const cw = W / 3;
  const cols = [0, 1, 2].map(c => {
    const covered = content.some(l => {
      const b = boxOf(l);
      return Math.max(0, Math.min(b.x + b.w, (c + 1) * cw) - Math.max(b.x, c * cw)) > cw * 0.25;
    });
    return covered ? '1' : '0';
  }).join('');

  // Where the ink BAND sits, read coarsely so a longer paragraph cannot move it.
  const top = Math.min(...content.map(l => boxOf(l).y));
  const bot = Math.max(...content.map(l => boxOf(l).y + boxOf(l).h));
  const span = (bot - top) / Math.max(1, H);
  const vspan = span > 0.7 ? 'full' : bot < H * 0.6 ? 'top' : top > H * 0.4 ? 'low' : 'mid';

  // Ink-weighted centroid decides the anchor — a centred stack and a
  // left-anchored one can share a column mask but never read the same.
  let sum = 0, wsum = 0;
  for (const l of content) {
    const b = boxOf(l);
    const a = Math.max(1, b.w * b.h);
    sum += (b.x + b.w / 2) * a;
    wsum += a;
  }
  const cx = wsum ? sum / wsum / W : 0.5;
  const anchor = cx < 0.42 ? 'left' : cx > 0.58 ? 'right' : 'center';
  return `${cols}/${vspan}/${anchor}${bleed ? '/bleed' : ''}`;
}

// ── Palette ─────────────────────────────────────────────────

const HUE_NAMES = ['red', 'orange', 'yellow', 'lime', 'green', 'teal', 'cyan', 'azure', 'blue', 'violet', 'magenta', 'rose'];

function hexesIn(l: L): string[] {
  const out: string[] = [];
  fillHexes(l.fill, out);
  fillHexes(l.stroke, out);
  fillHexes(l.color, out);
  if (isHex(l.style?.color)) out.push(String(l.style?.color).toLowerCase());
  return out;
}

/** Ground tone, accent family, and how many hues are working — the things that
 *  make two designs "the same palette" even when no hex matches. */
export function paletteOf(layers: Layer[], W: number, H: number, canvasBg?: string): string {
  const all = walk(layers);
  // The ground: the largest non-content layer, else the canvas background.
  let ground = canvasBg;
  let bestArea = 0;
  for (const l of all) {
    if (INK.has(String(l.type))) continue;
    const b = boxOf(l);
    const area = b.w * b.h;
    const hex = hexesIn(l)[0];
    if (hex && area > bestArea && area >= W * H * 0.5) { bestArea = area; ground = hex; }
  }
  const grgb = ground ? hexToRgb(ground) : null;
  const lum = grgb ? luminance(grgb) : 0.5;
  const tone = lum < 0.25 ? 'dark' : lum > 0.7 ? 'light' : 'mid';
  const gh = grgb && saturation(grgb) > 0.08 ? hue(grgb) : -1;
  const temp = gh < 0 ? 'neutral' : (gh < 90 || gh >= 300) ? 'warm' : 'cool';

  // The accent: the most saturated hue that is not the ground.
  const hues: number[] = [];
  let accent = -1, bestSat = 0;
  for (const l of all) {
    for (const hex of hexesIn(l)) {
      const rgb = hexToRgb(hex);
      if (!rgb) continue;
      const s = saturation(rgb);
      if (s < 0.15) continue;                       // greys carry no hue
      const h = hue(rgb);
      hues.push(Math.round(h / 30) % 12);
      if (s > bestSat && Math.abs(h - gh) > 20) { bestSat = s; accent = h; }
    }
  }
  const acc = accent < 0 ? 'mono' : HUE_NAMES[Math.round(accent / 30) % 12];
  return `${tone}-${temp}/${acc}/${new Set(hues).size}h`;
}

// ── Type scale ──────────────────────────────────────────────

const SIZE_BUCKET = (r: number): string => (r > 0.11 ? 'mega' : r > 0.075 ? 'xl' : r > 0.05 ? 'l' : r > 0.032 ? 'm' : 's');

/** How loud the headline is, and how far it sits above the body. A design whose
 *  headline is 5× its body reads nothing like one where everything is 24px. */
export function typeScaleOf(layers: Layer[], H: number): string {
  const all = walk(layers);
  const sizes = all.map(fontSizeOf).filter(n => n > 0).sort((a, b) => b - a);
  if (sizes.length === 0) return 'none';
  const top = sizes[0];
  const body = sizes.length > 1 ? sizes[Math.floor(sizes.length / 2)] : top;
  const ratio = body > 0 ? top / body : 1;
  const rb = ratio >= 4 ? '4x+' : ratio >= 2.5 ? '3x' : ratio >= 1.6 ? '2x' : 'flat';
  const face = all.find(l => fontSizeOf(l) === top && fontFamilyOf(l))?.style?.font_family;
  return `${SIZE_BUCKET(top / Math.max(1, H))}/${rb}${face ? `/${face.split(',')[0].trim()}` : ''}`;
}

// ── The signature ───────────────────────────────────────────

/** Everything on the design's surfaces, flattened. A deck signs as one design —
 *  the question is whether the DECK looks like another deck. */
function allSurfaces(design: DesignSpec): { layers: Layer[]; W: number; H: number } {
  const W = design.document?.width ?? 1080;
  const H = design.document?.height ?? 1080;
  if (design.pages?.length) {
    return { layers: design.pages.flatMap(p => p.layers ?? []), W, H };
  }
  return { layers: design.layers ?? [], W, H };
}

export function designSignature(design: DesignSpec): Signature {
  const { layers, W, H } = allSurfaces(design);
  const bg = (design as unknown as { background?: string }).background;
  // Structure and composition come from the FIRST surface: every page shares
  // one 0..H coordinate space, so flattening a deck would stack six covers on
  // top of each other and report a mask nothing actually looks like. Palette
  // and type read across the whole design, where they genuinely are global.
  const first = design.pages?.length ? (design.pages[0].layers ?? []) : layers;
  const structure = structureOf(first);
  const composition = compositionOf(first, W, H);
  const palette = paletteOf(layers, W, H, bg);
  const type_scale = typeScaleOf(layers, H);
  return { structure, composition, palette, type_scale, id: `${structure} | ${composition} | ${palette} | ${type_scale}` };
}

// ── Comparing ───────────────────────────────────────────────

export interface Similarity {
  /** 0 = the same design with different words, 1 = unrelated. */
  distance: number;
  /** Which traits the two share — the actionable half. */
  shared: string[];
  differs: string[];
  verdict: 'duplicate' | 'sibling' | 'distinct';
}

/** Weights, and why they are ordered this way: two designs built from the same
 *  preset with the same blocks are the same design however you recolour them,
 *  so structure dominates. Type scale moves last because a font swap is the
 *  change people reach for when they want to LOOK like they varied something. */
const W_STRUCTURE = 0.40, W_COMPOSITION = 0.30, W_PALETTE = 0.20, W_TYPE = 0.10;

function jaccard(a: string, b: string): number {
  const sa = new Set(a.split('+')), sb = new Set(b.split('+'));
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return 1 - inter / (sa.size + sb.size - inter);
}

/** cols / vspan / anchor, weighted by how much of a design decision each is. */
function compositionDistance(a: string, b: string): number {
  const [ca, va, aa] = a.split('/'), [cb, vb, ab] = b.split('/');
  let cols = 0;
  if (ca?.length === 3 && cb?.length === 3) {
    for (let i = 0; i < 3; i++) if (ca[i] !== cb[i]) cols++;
    cols /= 3;
  } else cols = ca === cb ? 0 : 1;
  return 0.5 * cols + 0.25 * (va === vb ? 0 : 1) + 0.25 * (aa === ab ? 0 : 1);
}

function fieldDistance(a: string, b: string): number {
  const fa = a.split('/'), fb = b.split('/');
  const n = Math.max(fa.length, fb.length);
  let diff = 0;
  for (let i = 0; i < n; i++) if (fa[i] !== fb[i]) diff++;
  return n ? diff / n : 0;
}

/** How alike two designs LOOK, and — the part that matters — in what way.
 *
 *  `shared` is what the caller acts on: knowing two posters share structure and
 *  palette tells a model exactly which axis is still free. The engine stops
 *  there on purpose; picking the replacement look is the model's job (§0.4). */
export function compareSignatures(a: Signature, b: Signature): Similarity {
  const ds = jaccard(a.structure, b.structure);
  const dc = compositionDistance(a.composition, b.composition);
  const dp = fieldDistance(a.palette, b.palette);
  const dt = fieldDistance(a.type_scale, b.type_scale);
  const distance = W_STRUCTURE * ds + W_COMPOSITION * dc + W_PALETTE * dp + W_TYPE * dt;

  const shared: string[] = [], differs: string[] = [];
  (ds < 0.25 ? shared : differs).push('structure');
  (dc < 0.25 ? shared : differs).push('composition');
  (dp < 0.34 ? shared : differs).push('palette');
  (dt < 0.34 ? shared : differs).push('type');

  const verdict = distance < 0.12 ? 'duplicate' : distance < 0.30 ? 'sibling' : 'distinct';
  return { distance: Math.round(distance * 100) / 100, shared, differs, verdict };
}

/** The nearest prior design, if any is close enough to be worth mentioning. */
export function nearest<T extends { signature: Signature }>(
  sig: Signature, others: T[],
): { match: T; similarity: Similarity } | null {
  let best: { match: T; similarity: Similarity } | null = null;
  for (const o of others) {
    const similarity = compareSignatures(sig, o.signature);
    if (!best || similarity.distance < best.similarity.distance) best = { match: o, similarity };
  }
  return best && best.similarity.verdict !== 'distinct' ? best : null;
}

// diagnose_design {review:true} — how each page spends its canvas.
//
// Renders every page twice at a small size — the ground alone, then the whole
// page — and measures the difference (layout-measure.ts): how much is covered,
// where the big empty areas are, where the visual weight sits, and how large
// each component and the type are next to the canvas. Numbers and places only;
// what to do about them is the model's call (CLAUDE.md §0.4).
//
// Found live (2026-09-20, a 1920×1080 build): "so much dead space" and "the
// last slide is not in the middle" were caught by the user, never by a check.

import type { DesignSpec, Layer } from '../../schema/types';
import { renderToSVGString } from './svg-export';
import { rasterizeSync } from '../../utils/resvg-isolate';
import { resvgFontOption } from './fonts';
import { cullUnseenClips } from '../../export/frame-cull';
import { animationDuration } from '../../export/gif-frames';
import { IDENTITY, poseAffine, compose, mapBox, type Affine } from './layout-pose';
import { drawnBox } from '../../export/frame-geometry';
import { seenTexts, textMask, textOnGround, legibilityNotes, hardToRead, type TextOnGround } from './layout-legibility';
import {
  inkGrid, occupancy, emptyRects, balance, thirds, contentBox, round2,
  type Rect, type Balance,
} from './layout-measure';

export interface Box { x: number; y: number; width: number; height: number }
export interface Component { id: string; type: string; box: Box; share: { w: number; h: number; area: number } }

export interface PageLayout {
  page?: string;
  canvas: string;
  /** Share of the canvas painted over the ground. */
  ink: number;
  /** Share the content spans — ink plus the small gaps inside it. */
  occupied: number;
  content_box: (Box & { margins: { left: number; right: number; top: number; bottom: number } }) | null;
  empty: Array<Box & { share: number }>;
  balance: Balance | null;
  thirds: number[][];
  components: Component[];
  type_scale: { max_px: number; max_share_of_height: number; median_px: number; sizes: number } | null;
  /** Texts too close to the ground behind them to read (layout-legibility.ts). */
  legibility?: TextOnGround[];
  notes: string[];
}

const REVIEW_EDGE = 480;   // px of the longest edge the page is measured at
/** Text is read finer: at 480 a 30px subtitle's strokes are under a pixel. */
const LEGIBILITY_EDGE = 960;
/** A page as seen, finer, with its glyph mask. */
type Seen = { full: Uint8Array; mask: Uint8Array; w: number; h: number };
const CELL_PX = 10;        // one grid cell at that size (40 px on a 1920 canvas)
const GROUNDABLE = new Set(['rect', 'image', 'path', 'ellipse', 'circle', 'polygon', 'shape', 'svg', 'gradient']);

type Geo = { x: number; y: number; w: number; h: number };

function geo(l: Layer): Geo | null {
  const p = (l as { pos?: unknown }).pos;
  const [x, y, w, h] = Array.isArray(p) && p.length >= 4 ? p : [l.x, l.y, l.width, l.height];
  return [x, y, w, h].every(v => typeof v === 'number') ? { x: x as number, y: y as number, w: w as number, h: h as number } : null;
}

const kids = (l: Layer): Layer[] | null => {
  const k = (l as { layers?: unknown }).layers;
  return Array.isArray(k) ? (k as Layer[]) : null;
};

const fullBleed = (g: Geo | null, W: number, H: number): boolean =>
  !!g && g.x <= 2 && g.y <= 2 && g.x + g.w >= W - 2 && g.y + g.h >= H - 2;

const paintOrder = (layers: Layer[]): Layer[] => [...layers].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

/**
 * The layers that ARE the ground: full-bleed fills at the bottom of the paint
 * order, looking inside a full-bleed group (a preset's own backdrop) — the
 * first thing that is not ground ends it.
 */
export function groundLayers(layers: Layer[], W: number, H: number): Layer[] {
  const out: Layer[] = [];
  for (const l of paintOrder(layers)) {
    const inner = kids(l);
    if (inner && fullBleed(geo(l), W, H)) {
      const g = groundLayers(inner, W, H);
      if (g.length) out.push({ ...l, layers: g } as Layer);
      break;
    }
    if (!fullBleed(geo(l), W, H) || !GROUNDABLE.has(l.type)) break;
    out.push(l);
  }
  return out;
}

/** What the page is built from: top-level layers, and the members of any
 *  full-canvas container (a preset group spans the page; its cards are the
 *  components). Largest first. */
/** A component, with the split_text source it belongs to (merged before it is reported). */
type Part = Component & { of?: string };

/** Layers too faint to see: a glitch ghost waiting at opacity 0 is not on screen. */
const UNSEEN = 0.02;

export function components(layers: Layer[], W: number, H: number, ground: Set<Layer>, depth = 0, at: Affine = IDENTITY, alpha = 1): Component[] {
  const out: Part[] = [];
  for (const l of layers) {
    if (ground.has(l)) continue;
    const o = l as unknown as { opacity?: unknown; visible?: unknown; split_of?: unknown };
    const a = alpha * (typeof o.opacity === 'number' ? o.opacity : 1);
    if (o.visible === false || a <= UNSEEN) continue;
    // Measured where it is SEEN: a posed layer (a camera, a moving group)
    // carries its children with it.
    const pose = poseAffine(l);
    const here = pose ? compose(at, pose) : at;
    const authored = seenGeo(l);
    const g = authored ? mapBox(here, authored) : null;
    const inner = kids(l);
    if (inner && depth < 3 && (!g || (g.w * g.h) / (W * H) >= 0.85)) {
      out.push(...(components(inner, W, H, ground, depth + 1, here, a) as Part[]));
      continue;
    }
    if (!g || g.w <= 0 || g.h <= 0 || fullBleed(g, W, H)) continue;
    if (g.x >= W || g.y >= H || g.x + g.w <= 0 || g.y + g.h <= 0) continue;   // not on this canvas
    out.push({
      id: l.id, type: l.type, box: { x: Math.round(g.x), y: Math.round(g.y), width: Math.round(g.w), height: Math.round(g.h) },
      share: { w: round2(g.w / W), h: round2(g.h / H), area: round2((g.w * g.h) / (W * H)) },
      ...(typeof o.split_of === 'string' ? { of: o.split_of } : {}),
    });
  }
  if (depth) return out;
  return mergeSplits(out, W, H).sort((a, b) => b.share.area - a.share.area).slice(0, 6);
}

/**
 * The letters of a split headline are ONE thing to a reader. Counted apart,
 * a 13-letter title animated by op:text reported as "title_c1, 1% of the
 * canvas" while two invisible ghosts topped the list (one-shot benchmark r2).
 */
function mergeSplits(parts: Part[], W: number, H: number): Component[] {
  const groups = new Map<string, Part[]>();
  const out: Component[] = [];
  for (const p of parts) {
    if (p.of === undefined) { out.push({ id: p.id, type: p.type, box: p.box, share: p.share }); continue; }
    groups.set(p.of, [...(groups.get(p.of) ?? []), p]);
  }
  for (const [id, ps] of groups) {
    const x = Math.min(...ps.map(p => p.box.x)), y = Math.min(...ps.map(p => p.box.y));
    const r = Math.max(...ps.map(p => p.box.x + p.box.width)), b = Math.max(...ps.map(p => p.box.y + p.box.height));
    out.push({ id, type: 'text', box: { x, y, width: r - x, height: b - y },
      share: { w: round2((r - x) / W), h: round2((b - y) / H), area: round2(((r - x) * (b - y)) / (W * H)) } });
  }
  return out;
}

function fontSizes(layers: Layer[], out: number[] = []): number[] {
  for (const l of layers) {
    const inner = kids(l);
    if (inner) { fontSizes(inner, out); continue; }
    const fs = l.type === 'text' ? (l as { style?: { font_size?: number } }).style?.font_size
      : l.type === 'rich_text' ? (l as { font_size?: number }).font_size : undefined;
    if (typeof fs === 'number' && fs > 0) out.push(fs);
  }
  return out;
}

export function typeScale(layers: Layer[], H: number): PageLayout['type_scale'] {
  const s = fontSizes(layers).sort((a, b) => a - b);
  if (!s.length) return null;
  const max = s[s.length - 1] ?? 0;
  return { max_px: max, max_share_of_height: round2(max / H), median_px: s[Math.floor(s.length / 2)] ?? 0, sizes: new Set(s).size };
}

const pct = (v: number): string => `${Math.round(v * 100)}%`;
/** Backdrop shapes: a big one is a panel, not an oversized component. */
const PANEL = new Set(['rect', 'ellipse', 'circle', 'path', 'polygon', 'background', 'shape', 'line']);
/** Edge facts need a box that IS what the layer draws. A plain text layer is
 *  measured by its drawn lines (textBox), so it qualifies; rich text is still
 *  its box — short copy in a wide box reaches no edge. */
const BOX_IS_INK = (type: string): boolean => type !== 'rich_text' && !PANEL.has(type);

/** A text layer where its glyphs are — the renderer's wrap and anchor — else its box. */
function seenGeo(l: Layer): Geo | null {
  if (l.type !== 'text') return geo(l);
  const b = drawnBox(l);
  return b ? { x: b.x, y: b.y, w: b.width, h: b.height } : geo(l);
}

/** Facts worth a sentence — where the page crosses a line a viewer notices. */
export function layoutNotes(p: Omit<PageLayout, 'notes'>): string[] {
  const out: string[] = [];
  const big = p.empty[0];
  if (big && big.share >= 0.2) out.push(`${pct(big.share)} of the canvas is one empty area: x ${big.x}–${big.x + big.width}, y ${big.y}–${big.y + big.height}.`);
  const b = p.balance;
  if (b && Math.abs(b.offset.x) >= 0.08) out.push(`Visual weight sits ${pct(Math.abs(b.offset.x))} ${b.offset.x > 0 ? 'right' : 'left'} of centre (left/right ${b.left_right[0]}/${b.left_right[1]}).`);
  if (b && Math.abs(b.offset.y) >= 0.08) out.push(`Visual weight sits ${pct(Math.abs(b.offset.y))} ${b.offset.y > 0 ? 'below' : 'above'} centre (top/bottom ${b.top_bottom[0]}/${b.top_bottom[1]}).`);
  const [W, H] = p.canvas.split('×').map(Number);
  for (const c of p.components) {
    if (PANEL.has(c.type)) continue;
    if (c.share.area >= 0.4) out.push(`"${c.id}" (${c.type}) covers ${pct(c.share.area)} of the canvas.`);
    if (!BOX_IS_INK(c.type)) continue;
    if (c.share.area < 0.4 && c.share.w >= 0.94) out.push(`"${c.id}" (${c.type}) runs edge to edge: ${c.box.width} of ${W} px wide.`);
    const b = c.box;
    if (W && H && (b.x < 0 || b.y < 0 || b.x + b.width > W || b.y + b.height > H)) {
      out.push(`"${c.id}" (${c.type}) is cut by the canvas edge: x ${b.x}–${b.x + b.width}, y ${b.y}–${b.y + b.height}.`);
    }
  }
  if (p.content_box && W && p.content_box.width / W < 0.6) out.push(`Content spans ${pct(p.content_box.width / W)} of the width.`);
  return out;
}

/** Measure one page from its two renders. */
export function measurePage(full: Uint8Array, ground: Uint8Array, rw: number, rh: number, W: number, H: number, layers: Layer[], groundSet: Set<Layer>, page?: string, seen?: Seen): PageLayout {
  const cols = Math.max(1, Math.round(rw / CELL_PX)), rows = Math.max(1, Math.round(rh / CELL_PX));
  const g = inkGrid(full, ground, rw, rh, cols, rows);
  const occ = occupancy(g, 1);
  const toBox = (r: Rect): Box => ({ x: Math.round((r.x * W) / cols), y: Math.round((r.y * H) / rows), width: Math.round((r.w * W) / cols), height: Math.round((r.h * H) / rows) });
  const cb = contentBox(occ, cols, rows);
  const box = cb ? toBox(cb) : null;
  const base = {
    ...(page ? { page } : {}),
    canvas: `${W}×${H}`,
    ink: round2(g.ink.reduce((s, v) => s + v, 0) / g.ink.length),
    occupied: round2(occ.reduce((s, v) => s + v, 0) / occ.length),
    content_box: box ? { ...box, margins: { left: box.x, right: W - box.x - box.width, top: box.y, bottom: H - box.y - box.height } } : null,
    empty: emptyRects(occ, cols, rows).map(r => ({ ...toBox(r), share: round2((r.w * r.h) / (cols * rows)) })),
    balance: balance(g),
    thirds: thirds(occ, cols, rows),
    components: components(layers, W, H, groundSet),
    type_scale: typeScale(layers, H),
  };
  const read = seen ? textOnGround(seen.full, seen.mask, seen.w, seen.h, W, H, seenTexts(layers)) : [];
  const hard = read.filter(hardToRead);
  return { ...base, ...(hard.length ? { legibility: hard } : {}), notes: [...layoutNotes(base), ...legibilityNotes(read)] };
}

function flatten(layers: Layer[], out = new Set<Layer>()): Set<Layer> {
  for (const l of layers) { out.add(l); const k = kids(l); if (k) flatten(k, out); }
  return out;
}

/** A layer list to measure — a page, or a page posed at some moment. */
export interface Entry { id?: string; layers: Layer[]; /** Judge text legibility (the text-free render) — off for a moving page seen at no moment. */ legible?: boolean }

/** Render and measure each entry. Both renders of every entry go to the
 *  rasteriser in ONE batch — one child process, not two per entry. */
export function measureEntries(spec: DesignSpec, entries: Entry[], projectDir: string): PageLayout[] {
  const W = spec.document?.width ?? 0, H = spec.document?.height ?? 0;
  if (W <= 0 || H <= 0 || !entries.length) return [];
  const scale = REVIEW_EDGE / Math.max(W, H);
  const opts = { fitTo: { mode: 'zoom' as const, value: scale }, background: '#ffffff', font: resvgFontOption(projectDir) };
  // What cannot reach the canvas is left out first — a clip parked far off it
  // aborts resvg (frame-cull.ts), and it draws no pixel either way.
  const svgOf = (layers: Layer[]): string =>
    renderToSVGString({ ...spec, layers: cullUnseenClips(layers, W, H), pages: undefined } as DesignSpec);
  const grounds = entries.map(e => groundLayers(e.layers, W, H));
  // Four renders each: the page and its ground to measure space; the page
  // again, finer, with its glyph mask, to read the text as seen (layout-legibility).
  const legOpts = { ...opts, fitTo: { mode: 'zoom' as const, value: LEGIBILITY_EDGE / Math.max(W, H) } };
  const rasters = rasterizeSync(entries.flatMap((e, i) => [
    { svg: svgOf(e.layers), opts, want: 'pixels' as const },
    { svg: svgOf(grounds[i] ?? []), opts, want: 'pixels' as const },
    { svg: svgOf(e.legible === false ? [] : e.layers), opts: legOpts, want: 'pixels' as const },
    { svg: svgOf(e.legible === false ? [] : textMask(e.layers)), opts: legOpts, want: 'pixels' as const },
  ]));
  return entries.map((e, i) => {
    const full = rasters[i * 4], ground = rasters[i * 4 + 1], fine = rasters[i * 4 + 2], mask = rasters[i * 4 + 3];
    if (!full || !ground || full.width !== ground.width || full.height !== ground.height) {
      return { ...(e.id ? { page: e.id } : {}), canvas: `${W}×${H}`, ink: 0, occupied: 0, content_box: null, empty: [], balance: null, thirds: [], components: [], type_scale: null, notes: ['Could not render this to measure it.'] };
    }
    const seen = e.legible !== false && fine && mask && fine.width === mask.width && fine.height === mask.height
      ? { full: new Uint8Array(fine.pixels), mask: new Uint8Array(mask.pixels), w: fine.width, h: fine.height } : undefined;
    return measurePage(new Uint8Array(full.pixels), new Uint8Array(ground.pixels), full.width, full.height, W, H, e.layers, flatten(grounds[i] ?? []), e.id, seen);
  });
}

/** The pages of a design (or the one asked for) as entries. */
export function pageEntries(spec: DesignSpec, pageId?: string): Array<Entry & { world: boolean }> {
  return spec.pages?.length
    ? spec.pages.filter(p => !pageId || p.id === pageId).map(p => ({ id: p.id, layers: p.layers ?? [], world: !!(p as { world?: unknown }).world }))
    : [{ layers: spec.layers ?? [], world: !!(spec as { world?: unknown }).world }];
}

/** Review every page (or one) of a design as authored. */
export function reviewLayout(spec: DesignSpec, projectDir: string, pageId?: string): PageLayout[] {
  // A page that moves is read at its shots' rests (motion.shots); as authored,
  // texts timed to different moments all show at once and read against
  // grounds they never sit on (a camera-world reel, benchmark r1).
  const pages = pageEntries(spec, pageId).map(p => ({ ...p, legible: animationDuration(p.layers) <= 0 }));
  return measureEntries(spec, pages, projectDir).map((m, i) => {
    // A world is seen through the camera, so the authored frame is not a shot.
    if (pages[i]?.world) m.notes.push('This page is a camera world: measured at the authored frame (the world\'s top-left), not at any shot — its `motion.shots` measure what the viewer sees.');
    return m;
  });
}

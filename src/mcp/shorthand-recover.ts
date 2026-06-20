// Folio shorthand parser — preset recovery, bleed/flow fitting, carousel/deck canvas. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer } from '../schema/types';

import { hexToRgb, luminance } from './engine/reference';

import { asHex, ShorthandLayer } from './shorthand-helpers';

import { lenientParseLayers, coerceShorthandLayers } from './shorthand-expand';

export const PRESET_TYPES = new Set([
  'feature_grid', 'editorial', 'poster', 'split', 'list', 'steps', 'checklist',
  'numbered_list', 'stat', 'metric', 'big_number', 'event', 'flyer', 'hero',
  'sections', 'infographic', 'document', 'report_poster', 'decor', 'marble_bg',
  'backdrop', 'timeline', 'roadmap', 'history', 'milestones', 'pricing', 'plans',
  'tiers', 'price_table', 'versus', 'compare', 'comparison', 'vs',
]);

// Did coercion yield at least one real preset layer? Used to tell a parsed-OK
// preset shorthand from junk a malformed string degraded into (e.g. a lone text
// layer holding the whole blob) — so add_layers can reject the junk instead of
// silently shipping a blank poster.

export function hasPresetType(layers: ShorthandLayer[]): boolean {
  return layers.some(l => {
    const r = l as Record<string, unknown>;
    return (typeof r['type'] === 'string' && PRESET_TYPES.has(r['type']))
      || (typeof r['preset'] === 'string' && PRESET_TYPES.has(r['preset']));
  });
}

// Does a decoded object look like a Folio PRESET payload (not arbitrary JSON a
// poster might legitimately display)? The signal must be specific so a code
// snippet showing JSON is never hijacked: a known preset `type`/`preset`, or a
// `blocks` array (the sections grammar), or an `items` array paired with a
// title/kicker (the feature_grid grammar).
// The sections grammar a model sometimes emits with each block kind as a KEY
// (stats/bars/heading_text/callout) instead of a `blocks:[]` array. True when ≥2
// such keys appear, or ≥1 alongside a kicker/title — specific enough that a code
// snippet showing JSON isn't mistaken for one.

export const FIELD_BLOCK_KEYS = ['stats', 'bars', 'heading_text', 'callout', 'takeaway', 'list', 'steps', 'kpis', 'metrics', 'quote', 'source'];

export function hasFieldKeyedBlocks(r: Record<string, unknown>): boolean {
  const present = FIELD_BLOCK_KEYS.filter(k => r[k] != null);
  return present.length >= 2 || (present.length >= 1 && (r['kicker'] != null || r['title'] != null || r['subtitle'] != null));
}
// Build a `blocks[]` array from field-keyed sections content, in editorial order.

export function fieldKeyedToBlocks(r: Record<string, unknown>): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const stats = r['stats'] ?? r['kpis'] ?? r['metrics'];
  if (Array.isArray(stats)) blocks.push({ type: 'stats', items: stats });
  const ht = r['heading_text'];
  if (Array.isArray(ht)) for (const h of ht) { if (h && typeof h === 'object') blocks.push({ type: 'heading_text', ...(h as Record<string, unknown>) }); }
  else if (ht && typeof ht === 'object') blocks.push({ type: 'heading_text', ...(ht as Record<string, unknown>) });
  if (Array.isArray(r['bars'])) blocks.push({ type: 'bars', items: r['bars'] });
  const list = r['list'] ?? r['steps'];
  if (Array.isArray(list)) blocks.push({ type: 'list', items: list });
  const quote = r['quote'];
  if (typeof quote === 'string') blocks.push({ type: 'quote', text: quote });
  else if (quote && typeof quote === 'object') blocks.push({ type: 'quote', ...(quote as Record<string, unknown>) });
  const co = r['callout'] ?? r['takeaway'];
  if (typeof co === 'string') blocks.push({ type: 'callout', text: co });
  else if (co && typeof co === 'object') blocks.push({ type: 'callout', ...(co as Record<string, unknown>) });
  if (typeof r['source'] === 'string') blocks.push({ type: 'source', text: r['source'] });
  return blocks;
}

export function looksLikePreset(o: unknown): boolean {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
  const r = o as Record<string, unknown>;
  if (typeof r['type'] === 'string' && PRESET_TYPES.has(r['type'])) return true;
  if (typeof r['preset'] === 'string' && PRESET_TYPES.has(r['preset'])) return true;
  if (Array.isArray(r['blocks'])) return true;
  if (Array.isArray(r['items']) && (r['title'] != null || r['kicker'] != null)) return true;
  // A single-key wrapper {"sections": {…}} (the key is a preset type, value an obj).
  const keys = Object.keys(r);
  if (keys.length === 1 && PRESET_TYPES.has(keys[0] ?? '') && r[keys[0] ?? ''] && typeof r[keys[0] ?? ''] === 'object') return true;
  // Field-keyed sections content (bars/stats/heading_text/callout as keys).
  if (hasFieldKeyedBlocks(r)) return true;
  return false;
}

// Normalize a decoded preset blob into a canonical shorthand layer: unwrap a
// single-key {"sections": {…}} wrapper, default a typeless blocks/field-keyed
// object to sections, and synthesize a blocks[] from field-keyed content.

export function normalizePresetBlob(o: unknown): unknown {
  if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
  let r = o as Record<string, unknown>;
  const keys = Object.keys(r);
  if (keys.length === 1 && PRESET_TYPES.has(keys[0] ?? '') && r[keys[0] ?? ''] && typeof r[keys[0] ?? ''] === 'object' && !Array.isArray(r[keys[0] ?? ''])) {
    r = { type: keys[0], ...(r[keys[0] ?? ''] as Record<string, unknown>) };
  }
  if (r['type'] == null && r['preset'] == null && (Array.isArray(r['blocks']) || hasFieldKeyedBlocks(r))) {
    r = { ...r, type: 'sections' };
  }
  if ((r['type'] === 'sections' || r['preset'] === 'sections') && !Array.isArray(r['blocks'])) {
    const blocks = fieldKeyedToBlocks(r);
    if (blocks.length) r = { ...r, blocks };
  }
  return r;
}

// The dominant blank-poster cause on weak models: instead of passing the preset
// as layers_shorthand, the model JSON-stringifies the WHOLE payload and drops it
// into a single text layer's `content.value` (array form `[{type:"sections",…}]`
// or bare object `{…,"blocks":[…]}` with the type omitted). The engine then
// renders one unreadable JSON wall → a design that looks blank. Detect that blob,
// decode it leniently, and hand back a real ShorthandLayer[] so add_layers can
// re-expand it through the normal preset pipeline — same silent-drop class as a
// stringified layers_shorthand (#42), on the text-layer path. Returns null when
// no text layer carries a preset blob (the common, healthy case).

export function recoverStringifiedPreset(layers: Layer[]): ShorthandLayer[] | null {
  for (const l of layers) {
    if (!l || l.type !== 'text') continue;
    const raw = (l as Layer & { content?: string | { value?: string } }).content;
    const s = (typeof raw === 'string' ? raw : raw?.value ?? '').trim();
    if (!(s.startsWith('{') || s.startsWith('['))) continue;
    const parsed = lenientParseLayers(s);
    if (!parsed) continue;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    if (!items.some(looksLikePreset)) continue;
    // Unwrap a {"sections": {…}} wrapper, default a typeless blocks/field-keyed
    // object to sections, and synthesize blocks[] from field-keyed content — so
    // coerceShorthandLayers treats it as one real preset layer, not an {id:layer}
    // dict or an empty section. (Live blind-30B find: the model stringified the
    // whole sections payload wrapped as {"sections": {bars,stats,heading_text…}}.)
    const normalized = items.map(normalizePresetBlob);
    const sh = coerceShorthandLayers(normalized);
    if (sh.length) return sh;
  }
  return null;
}

// Generic container words a model invents to wrap a poster's real layers. None
// are preset types, so a {type:"page", layers:[…]} (or a typeless {bg, layers})
// is a transparent wrapper, not content.

export const WRAPPER_TYPES = new Set(['', 'group', 'page', 'container', 'frame', 'root', 'canvas', 'wrapper', 'layout', 'artboard']);
// Page-level style keys a model puts on a wrapper, meant to cascade onto the
// PRESET children it holds (presets consume bg/accent/palette/text_color; leaf
// text/icon layers carry their own color, so cascading to them only adds
// "unrecognized field" noise). Excludes font_heading/font_body — no layer reads
// them, so they would just trip the diagnostics.

export const CASCADE_KEYS = ['bg', 'background', 'accent', 'palette', 'theme', 'mood', 'text_color'];

// Is this a BARE container — a dimensionless wrapper with a nested layers/children
// array and no own geometry or flow hints? Such a wrapper carries page intent,
// not a real group; inferLayerType would make it a `group` with no width → reject.

export function isBareContainer(r: Record<string, unknown>): boolean {
  const kids = r['layers'] ?? r['children'];
  if (!Array.isArray(kids) || kids.length === 0) return false;
  // Any own geometry → a real, intentional group; leave it alone.
  if (r['pos'] !== undefined || r['x'] !== undefined || r['y'] !== undefined
    || r['width'] !== undefined || r['height'] !== undefined) return false;
  // Layout hints → auto_layout flexbox; the engine flows its children.
  if (r['direction'] !== undefined || r['gap'] !== undefined || r['justify'] !== undefined
    || r['wrap'] !== undefined || r['padding'] !== undefined) return false;
  const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
  return WRAPPER_TYPES.has(t) && !PRESET_TYPES.has(t);
}

// Does some child already paint the full canvas (a preset fills its own bg, or a
// full-bleed rect/image sits at the origin)? Gates the synthesized bg rect.

export function childPaintsCanvas(kids: ShorthandLayer[], docW: number, docH: number): boolean {
  return kids.some(c => {
    const r = c as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (PRESET_TYPES.has(t)) return true;
    if (t === 'rect' || t === 'image' || t === 'circle' || t === 'ellipse') {
      const p = r['pos'];
      const [x, y, w, h] = Array.isArray(p) && p.length === 4
        ? (p as number[])
        : [Number(r['x'] ?? 0), Number(r['y'] ?? 0), Number(r['width'] ?? 0), Number(r['height'] ?? 0)];
      if (x <= docW * 0.02 && y <= docH * 0.02 && w >= docW * 0.96 && h >= docH * 0.96) return true;
    }
    return false;
  });
}

// A weak model often wraps the real poster in a page/document CONTAINER it
// invented: a typeless object carrying page-level bg/accent/fonts and a nested
// `layers:[…]` of absolutely-positioned children. inferLayerType turns that into
// a `group`, but with no pos/width/height add_layers rejects it ("group needs a
// positive width") → the model loops and ships a blank poster (live blind-30B
// find: every add_layers ok=false, three empty designs sealed as "done"). Detect
// a bare wrapper and HOIST its children to the page: cascade the wrapper's page
// style onto children that omit it, and synthesize a full-bleed bg rect when the
// wrapper set `bg` and no child already paints the canvas. Recurses (a wrapper
// may nest a wrapper); real groups (pos+dims) and auto_layout are left untouched.

export function unwrapBareContainers(
  layers: ShorthandLayer[], docW: number, docH: number,
): { layers: ShorthandLayer[]; unwrapped: number } {
  let unwrapped = 0;
  const out: ShorthandLayer[] = [];
  const visit = (items: ShorthandLayer[], depth: number): void => {
    for (const it of items) {
      const r = it as Record<string, unknown>;
      if (depth < 6 && it && typeof it === 'object' && !Array.isArray(it) && isBareContainer(r)) {
        unwrapped++;
        const kids = (r['layers'] ?? r['children']) as ShorthandLayer[];
        const cascade: Record<string, unknown> = {};
        for (const k of CASCADE_KEYS) if (r[k] !== undefined) cascade[k] = r[k];
        const childArr = kids.map(c => {
          if (!c || typeof c !== 'object') return c;
          const cr = { ...(c as Record<string, unknown>) } as ShorthandLayer;
          // Only presets (or a typeless child that will infer one) read page-style
          // keys; leaf layers keep their own styling untouched.
          const ct = typeof cr['type'] === 'string' ? (cr['type'] as string).toLowerCase() : '';
          if (ct === '' || PRESET_TYPES.has(ct)) {
            for (const [k, v] of Object.entries(cascade)) if (cr[k] === undefined) cr[k] = v;
          }
          return cr;
        });
        const bg = r['bg'] ?? r['background'];
        if (typeof bg === 'string' && bg && !childPaintsCanvas(childArr, docW, docH)) {
          out.push({ type: 'rect', id: 'bg', pos: [0, 0, docW, docH], fill: bg, z: 0 } as ShorthandLayer);
        }
        visit(childArr, depth + 1);
      } else {
        out.push(it);
      }
    }
  };
  visit(layers, 0);
  return { layers: out, unwrapped };
}

// Full-bleed layout presets whose builder HONORS an explicit height box and
// composes its background to fill it. Sized to the page they cover the canvas.
// (sections/infographic/document/report_poster are deliberately omitted — they
// are FLOW presets, content-sized so the doc can auto-fit to them, and ignore an
// injected height; the covering-backdrop guard protects those from blanking.)

export const BLEED_PRESETS = new Set([
  'feature_grid', 'editorial', 'poster', 'event', 'flyer', 'hero', 'split',
  'decor', 'marble_bg', 'backdrop', 'timeline', 'roadmap', 'history', 'milestones',
  'pricing', 'plans', 'tiers', 'price_table', 'versus', 'compare', 'comparison', 'vs',
]);

// A full-bleed preset added as a page layer WITHOUT an explicit box defaults to
// a hardcoded square (feature_grid 1080², sections 1080×1920) — on a portrait
// carousel page (e.g. 1080×1350) that leaves a dead strip the model then "fixes"
// by stamping a full-canvas rect ON TOP, blanking the slide (live carousel find:
// 4 of 6 slides rendered empty). Size a boxless top-level preset to the page so
// it lays itself out across the whole canvas. Mutates in place; returns count.

export function fillBleedPresetDims(layers: ShorthandLayer[], docW: number, docH: number): number {
  let filled = 0;
  for (const sh of layers) {
    if (!sh || typeof sh !== 'object' || Array.isArray(sh)) continue;
    const r = sh as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (!BLEED_PRESETS.has(t)) continue;
    const pos = Array.isArray(r['pos']) && (r['pos'] as unknown[]).length >= 4 ? (r['pos'] as number[]) : null;
    const hasBox = pos !== null
      || typeof r['x'] === 'number' || typeof r['y'] === 'number'
      || typeof r['width'] === 'number' || typeof r['height'] === 'number';
    if (!hasBox) { r['pos'] = [0, 0, docW, docH]; filled++; continue; }
    // A full-bleed preset IS the poster — so a clearly-wrong box (a thrashing model
    // gave x=-459, 1539² on a 1080 canvas) means it fumbled the position/size, not
    // that it wants a smaller region. Snap an off-canvas / oversized box to the page
    // so the preset lays out correctly (and origin-stacked dupes can then be deduped).
    const bx = pos ? Number(pos[0]) : (typeof r['x'] === 'number' ? r['x'] as number : 0);
    const by = pos ? Number(pos[1]) : (typeof r['y'] === 'number' ? r['y'] as number : 0);
    const bw = pos ? Number(pos[2]) : (typeof r['width'] === 'number' ? r['width'] as number : docW);
    const bh = pos ? Number(pos[3]) : (typeof r['height'] === 'number' ? r['height'] as number : docH);
    const wrong = bx < -docW * 0.05 || by < -docH * 0.05
      || bw > docW * 1.1 || bh > docH * 1.3
      || (bx + bw) > docW * 1.1 || (by + bh) > docH * 1.1;
    if (wrong) {
      r['pos'] = [0, 0, docW, docH];
      delete r['x']; delete r['y']; delete r['width']; delete r['height'];
      filled++;
    }
  }
  return filled;
}

// Flow/list presets that size themselves to their content (so a poster can
// auto-fit). On a fixed CAROUSEL page that content-sizing leaves an empty lower
// band — hand them the page box so they fill + center it instead.
// Content presets that, on a fixed slide, should FILL the page (not size-to-
// content) so there's no unpainted strip / dead band below the content. buildList
// AND buildSections both honor the private `__fillPage` marker: fill the page
// height, compose the bg across it, and vertically center the content block.

export const FLOW_PAGE_PRESETS = new Set([
  'list', 'steps', 'checklist', 'numbered_list',
  'sections', 'infographic', 'document', 'report_poster',
]);

export function fillFlowPresetsToPage(layers: ShorthandLayer[], docW: number, docH: number): number {
  let filled = 0;
  for (const sh of layers) {
    if (!sh || typeof sh !== 'object' || Array.isArray(sh)) continue;
    const r = sh as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (!FLOW_PAGE_PRESETS.has(t)) continue;
    const hasBox = (Array.isArray(r['pos']) && (r['pos'] as unknown[]).length === 4)
      || typeof r['x'] === 'number' || typeof r['y'] === 'number'
      || typeof r['width'] === 'number' || typeof r['height'] === 'number';
    if (hasBox) continue;
    r['pos'] = [0, 0, docW, docH];
    r['__fillPage'] = true; // FILL+center the page, not size-to-content
    filled++;
  }
  return filled;
}

// Poster variant of the above: snap ONLY a clearly-WRONG box (off-canvas /
// oversized / offset from the origin), never a boxless preset. A poster's boxless
// flow preset must keep content-sizing so the doc auto-fits to it (filling it
// would stretch sparse content + leave a dead band) — but a mispositioned one
// (the signup-flow thrash: sections at x=-459 / y=400 content-sizes tall → steps
// off the page → blank) must snap to the origin and fill so its content lands
// on-canvas. After the snap, origin-stacked dupes dedupe via dropStackedPresets.

export function snapWrongFlowPresets(layers: ShorthandLayer[], docW: number, docH: number): number {
  let snapped = 0;
  for (const sh of layers) {
    if (!sh || typeof sh !== 'object' || Array.isArray(sh)) continue;
    const r = sh as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (!FLOW_PAGE_PRESETS.has(t)) continue;
    const pos = Array.isArray(r['pos']) && (r['pos'] as unknown[]).length >= 4 ? (r['pos'] as number[]) : null;
    const hasBox = pos !== null
      || typeof r['x'] === 'number' || typeof r['y'] === 'number'
      || typeof r['width'] === 'number' || typeof r['height'] === 'number';
    if (!hasBox) continue; // boxless on a poster → leave it to content-size + auto-fit
    const bx = pos ? Number(pos[0]) : (typeof r['x'] === 'number' ? r['x'] as number : 0);
    const by = pos ? Number(pos[1]) : (typeof r['y'] === 'number' ? r['y'] as number : 0);
    const bw = pos ? Number(pos[2]) : (typeof r['width'] === 'number' ? r['width'] as number : docW);
    const bh = pos ? Number(pos[3]) : (typeof r['height'] === 'number' ? r['height'] as number : docH);
    const wrong = bx < -docW * 0.05 || by < -docH * 0.05 || bx > docW * 0.06 || by > docH * 0.06
      || bw > docW * 1.1 || bh > docH * 1.3 || (bx + bw) > docW * 1.1 || (by + bh) > docH * 1.1;
    if (!wrong) continue;
    delete r['x']; delete r['y']; delete r['width']; delete r['height'];
    r['pos'] = [0, 0, docW, docH];
    r['__fillPage'] = true;
    snapped++;
  }
  return snapped;
}

// Is this an OPAQUE rectangle covering (essentially) the whole canvas? A solid
// or gradient fill at the origin spanning the page — the shape a model stamps as
// a "background". Noise/image overlays and anything <0.95 opacity (a scrim) are
// deliberately NOT covers and are left where the model put them.

export function isFullCanvasOpaqueRect(l: Layer, docW: number, docH: number): boolean {
  const a = l as unknown as Record<string, unknown>;
  if (a['type'] !== 'rect') return false;
  if (typeof a['opacity'] === 'number' && (a['opacity'] as number) < 0.95) return false;
  const num = (v: unknown): number => (typeof v === 'number' ? v : 0);
  const x = num(a['x']), y = num(a['y']), w = num(a['width']), h = num(a['height']);
  if (!(x <= docW * 0.02 && y <= docH * 0.02 && w >= docW * 0.96 && h >= docH * 0.96)) return false;
  const f = a['fill'];
  if (f == null) return false;
  if (typeof f === 'string') {
    const s = f.trim();
    return s !== '' && s !== 'none' && !/rgba?\([^)]*,\s*0?\.\d+\s*\)|hsla/i.test(s);
  }
  if (typeof f === 'object') {
    const ft = (f as { type?: string }).type;
    return ft === 'solid' || ft === 'linear' || ft === 'radial' || ft === undefined;
  }
  return false;
}

// When add_layers drops a full-canvas opaque rect onto a page that ALREADY has
// content, array order would paint it over everything (the renderer sorts by z,
// stable — a new z:0 rect appended after a z:0 group wins the tie and covers it).
// Demote each such rect strictly below every existing/incoming layer so it sinks
// to the back: a redundant "background" becomes harmless instead of destructive.
// Returns the count demoted. No-op when the target is empty (a real first bg).

export function demoteCoveringBackdrops(existing: Layer[], incoming: Layer[], docW: number, docH: number): number {
  if (!existing.length) return 0;
  const zOf = (l: Layer): number => (typeof (l as { z?: unknown }).z === 'number' ? (l as { z: number }).z : 0);
  let minZ = Infinity;
  for (const l of existing) minZ = Math.min(minZ, zOf(l));
  for (const l of incoming) minZ = Math.min(minZ, zOf(l));
  let demoted = 0;
  for (const l of incoming) {
    if (isFullCanvasOpaqueRect(l, docW, docH)) {
      (l as { z: number }).z = minZ - 1 - demoted;
      demoted++;
    }
  }
  return demoted;
}

// Page-LAYOUT presets (the ones that paint a full slide canvas) — the cohesion
// lock applies to these. Backgrounds (decor/marble_bg/backdrop) and small
// content blocks (list/stat) are deliberately excluded.

export const PAGE_PRESETS = new Set([
  'feature_grid', 'sections', 'infographic', 'document', 'report_poster',
  'editorial', 'poster', 'event', 'flyer', 'hero', 'split',
  'timeline', 'roadmap', 'history', 'milestones', 'pricing', 'plans', 'tiers',
  'price_table', 'versus', 'compare', 'comparison', 'vs',
]);

export const DARK_LUM = 0.42; // matches buildFeatureGrid's bgDark threshold

export function fillHex(fill: unknown): string | null {
  if (typeof fill === 'string') return asHex(fill);
  if (fill && typeof fill === 'object') {
    const f = fill as { color?: unknown; stops?: Array<{ color?: unknown }> };
    if (typeof f.color === 'string') return asHex(f.color);
    if (Array.isArray(f.stops) && f.stops.length) return asHex(f.stops[0]?.color);
  }
  return null;
}

// The canvas base color of an already-expanded page: the first group's first
// rect child (its *_bg), else a top-level full-canvas rect.

export function pageCanvasColor(page: { layers?: Layer[] }): string | null {
  for (const l of page?.layers ?? []) {
    const r = l as unknown as Record<string, unknown>;
    if (r['type'] === 'group' && Array.isArray(r['layers'])) {
      for (const c of r['layers'] as Record<string, unknown>[]) {
        if (c['type'] === 'rect') { const hex = fillHex(c['fill']); if (hex) return hex; }
      }
    }
    if (r['type'] === 'rect') { const hex = fillHex(r['fill']); if (hex) return hex; }
  }
  return null;
}

// The heading font of an already-expanded page: a *_title text layer's family.

export function pageHeadingFont(page: { layers?: Layer[] }): string | null {
  const walk = (layers: unknown[]): string | null => {
    for (const l of layers ?? []) {
      const r = l as Record<string, unknown>;
      const id = typeof r['id'] === 'string' ? r['id'] : '';
      if (r['type'] === 'text' && /_title$/.test(id)) {
        const st = r['style'] as { font_family?: unknown } | undefined;
        if (st && typeof st.font_family === 'string' && st.font_family) return st.font_family;
      }
      if (Array.isArray(r['layers'])) { const f = walk(r['layers']); if (f) return f; }
    }
    return null;
  };
  return walk(page?.layers ?? []);
}

// Carousel cohesion lock. A blind model composes each slide in a separate call
// and drifts — slide 4 comes back near-black in an otherwise-cream deck, the
// heading font flips serif↔sans — so the set reads like seven designers each did
// one slide (live cold-brew find: 3 of 7 slides flipped dark). Establish the
// deck's look from the FIRST page (canvas luminance class + heading font) and,
// for an incoming page-layout preset that FLIPS light↔dark or changes the
// heading font, snap it back. Only flips are touched — same-class hue/shade
// variation is left alone. Returns counts for the progress note.

export function lockCarouselCanvas(
  pages: Array<{ layers?: Layer[] }>, incoming: ShorthandLayer[],
): { bg: number; font: number } {
  if (!pages.length) return { bg: 0, font: 0 };
  let refHex: string | null = null, refFont: string | null = null;
  for (const p of pages) {
    if (!refHex) refHex = pageCanvasColor(p);
    if (!refFont) refFont = pageHeadingFont(p);
    if (refHex && refFont) break;
  }
  if (!refHex) return { bg: 0, font: 0 };
  const refRgb = hexToRgb(refHex);
  const refDark = refRgb ? luminance(refRgb) < DARK_LUM : false;
  let bg = 0, font = 0;
  for (const sh of incoming) {
    if (!sh || typeof sh !== 'object' || Array.isArray(sh)) continue;
    const r = sh as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (!PAGE_PRESETS.has(t)) continue;
    const bgHex = asHex(r['bg']);
    if (bgHex) {
      const rgb = hexToRgb(bgHex);
      const dark = rgb ? luminance(rgb) < DARK_LUM : false;
      if (dark !== refDark) {
        // Snap to the deck canvas + a guaranteed-readable text color, and drop
        // the content-seeded mood keys so cards never go light-on-light.
        r['bg'] = refHex;
        r['text_color'] = refDark ? '#FAFAFA' : '#1A1A1A';
        delete r['palette']; delete r['bg_style'];
        bg++;
      }
    }
    if (refFont) {
      const f = r['font'] ?? r['font_family'];
      if (typeof f === 'string' && f && f !== refFont) { r['font'] = refFont; delete r['font_family']; font++; }
    }
  }
  return { bg, font };
}

// Carousel cohesion, the COMMON case: a weak model appends each slide as a bare
// `{type:"sections"}` with NO bg/font, expecting the engine to style it. The
// engine's seededDefaults then seeds a mood from each slide's DISTINCT content
// (the slide titles) → every page a different palette+font (the lockCarousel
// snap can't help — there is no explicit bg to detect a flip). Stamp a stable
// `__deckseed` (the design identity) on every bg-less page preset so all slides
// resolve to ONE shared mood. A page that DOES carry its own bg is left alone.

export function stampDeckSeed(layers: ShorthandLayer[], seed: string): number {
  if (!seed) return 0;
  let n = 0;
  for (const sh of layers) {
    if (!sh || typeof sh !== 'object' || Array.isArray(sh)) continue;
    const r = sh as Record<string, unknown>;
    const t = typeof r['type'] === 'string' ? (r['type'] as string).toLowerCase() : '';
    if (!PAGE_PRESETS.has(t)) continue;
    if (typeof r['bg'] === 'string' && (r['bg'] as string).trim() !== '') continue;
    r['__deckseed'] = seed;
    n++;
  }
  return n;
}

// Small models name fields after the *verbose* output schema (content,
// font_size, symbol, url) rather than the terse shorthand vocabulary
// (text, size, icon, src). Without this, a model that sends
// {type:'text', content:'Morning Coffee', font_size:80} renders blank — the
// expander only reads `text`/`size`, so the copy and size are silently
// dropped. Map the aliases onto the canonical fields. The canonical field
// always wins when both are present; this never overwrites it.

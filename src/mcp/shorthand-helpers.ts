// Folio shorthand parser — shared helpers, value types & low-level expanders. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer, Fill } from '../schema/types';

import { hexToRgb, luminance } from './engine/reference';
import { pickMoodVariant, proceduralBgStyle, type Mood } from './engine/mood-bank';

export function asHex(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}

export function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return 21;
  const la = luminance(ra), lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Keep `prefer` if it's legible on `on`; otherwise flip to near-black/near-white. */

export function readableOn(on: string, prefer: string): string {
  const onRgb = hexToRgb(on);
  if (!onRgb) return prefer;
  if (asHex(prefer) && contrastRatio(prefer, on) >= 3) return prefer;
  return luminance(onRgb) > 0.5 ? '#1A1A1A' : '#FAFAFA';
}
/**
 * Resolve a readable (text, muted) pair for content sitting on `bg`. Honors an
 * explicit hex when it already contrasts; otherwise flips to a light pair on a
 * dark canvas (or a dark pair on a light one). A vision-less model that sets a
 * dark bg but leaves text at a light-canvas default ($text / #1A1A1A) would
 * otherwise render invisible — the engine guarantees legibility it can't see.
 * A non-hex explicit (a `$token`) is treated as "unset" so the bg drives it.
 */

export function readablePair(bg: string, explicitText?: unknown, explicitMuted?: unknown): { text: string; muted: string } {
  const rgb = hexToRgb(asHex(bg) ?? '#FAF5EC');
  const dark = rgb ? luminance(rgb) < 0.42 : false;
  const text = readableOn(bg, asHex(explicitText) ?? (dark ? '#FAFAFA' : '#1A1A1A'));
  const muted = readableOn(bg, asHex(explicitMuted) ?? (dark ? '#B8B2A8' : '#6E5F4A'));
  return { text, muted };
}
/**
 * Seeded default art-direction for a preset whose model call OMITTED `bg`. A
 * vision-less 30B reliably drops bg/accent/bg_style (it sends only structure), so
 * every preset would otherwise fall to one hard-coded default → the "same
 * template" look. Seeding a mood from the design's own CONTENT (title + body)
 * gives two different topics two different looks even when neither carried a
 * color, and lanes match the content words ("abyssal"→teal, "volcano"→midnight).
 * Returns null when an explicit bg was given — that is always honored.
 */

export function seededDefaults(r: Record<string, unknown>, seedParts: unknown[]): Mood | null {
  if (typeof r['bg'] === 'string' && (r['bg'] as string).trim() !== '') return null;
  // Match the palette LANE on the prose parts (title/subtitle/kicker — the
  // topic), NOT the bulky body arrays (blocks/items/details). A generic stat
  // label like "market value" inside blocks must not hijack the whole palette to
  // the finance lane. The FULL content still seeds the hash so unmatched topics
  // spread across the bank instead of collapsing onto one default.
  const all = seedParts.map(p => (typeof p === 'string' ? p : JSON.stringify(p ?? ''))).join(' ');
  const topic = seedParts.filter((p): p is string => typeof p === 'string').join(' ').trim();
  // `__variant` (stamped by addLayers for a design that is the Nth member of a
  // sibling variant SET — "give me N options of one topic") steps to the Nth
  // DISTINCT curated art-direction. A weak model passes variant to enrich_brief but
  // DROPS the returned bg/accent/font here, so all N same-content designs would
  // otherwise fall to ONE seeded mood and render IDENTICALLY. variant 0 (a lone
  // design, the default) == pickMood → byte-identical to before.
  const variant = Math.max(0, Math.floor(Number(r['__variant']) || 0));
  // CAROUSEL COHESION: a deck's pages are appended in separate calls, each with
  // DIFFERENT content (slide titles "Simplicity"/"Typography"/…). Seeding the
  // mood from per-page content gives every slide a different palette+font — the
  // set reads like six designers. When appendPage stamps a stable `__deckseed`
  // (the design identity), lock the PALETTE/FONT to it so every slide shares one
  // mood; the per-page content still salts the bg GEOMETRY so slides aren't
  // pixel-identical. No deck seed (a normal poster) → byte-identical to before.
  const deck = typeof r['__deckseed'] === 'string' && (r['__deckseed'] as string).trim() !== ''
    ? (r['__deckseed'] as string) : '';
  const mood = deck
    ? pickMoodVariant(deck, deck, variant)
    : pickMoodVariant(topic || all, all, variant);
  // Keep the mood's curated COLOUR/font/treatment, but compose the GEOMETRY
  // procedurally from the content so two decks in the same colour mood don't
  // share a background (the "same background" complaint). 100+ distinct recipes.
  // Salt the geometry seed by the variant too, so two options never share a bg.
  const rgb = hexToRgb(mood.bg);
  const dark = rgb ? luminance(rgb) < 0.5 : true;
  const geoSeed = deck ? `${deck}#${all}` : (variant ? `${all}#v${variant}` : all);
  return { ...mood, bg_style: proceduralBgStyle(geoSeed, dark) };
}

// Parametric shapes the engine expands into a `path` layer (absolute coords).

export const SHAPE_NAMES = new Set<string>([
  'star', 'burst', 'seal', 'blob', 'wave', 'arc', 'ring', 'donut',
  'bubble', 'speech_bubble', 'heart', 'lightning', 'bolt', 'shield',
  'gear', 'cog', 'arrow', 'cross_shape', 'plus_shape',
]);

/**
 * Semantic Shorthand Parser
 *
 * LLM generates compact shorthand YAML, this module expands it to full verbose YAML.
 * Expansion levels from CLAUDE.md Section 7.3:
 *   Level 1: template + slots only (~50-150 tokens)
 *   Level 2: semantic shorthand with token refs (~300-600 tokens)
 *   Level 3: full verbose YAML (engine output, never LLM-generated)
 */

export interface ShorthandLayer {
  // id/type are optional: small models often omit them. expandShorthandLayers
  // infers a type from the fields present and auto-assigns a unique id.
  id?: string;
  type?: string;
  z?: number;
  pos?: [number, number, number, number];
  x?: number;
  y?: number;
  width?: number | 'auto';
  height?: number | 'auto';
  opacity?: number;
  rotation?: number;
  flip_h?: boolean;
  flip_v?: boolean;
  visible?: boolean;
  locked?: boolean;
  fill?: string | Fill;
  stroke?: string | { color: string; width: number };
  radius?: number;
  text?: string;
  font?: string;
  size?: number;
  weight?: number;
  color?: string;
  align?: string;
  line_height?: number;
  letter_spacing?: number;
  src?: string;
  icon?: string;
  icon_size?: number;
  // Verbose-schema aliases small models reach for instead of the terse
  // shorthand names above. normalizeShorthandAliases maps these onto text /
  // size / icon / src so the content the model provided isn't dropped.
  content?: string | { value?: string };
  font_size?: number;
  fontSize?: number;
  symbol?: string;
  glyph?: string;
  url?: string;
  href?: string;
  link?: string;
  d?: string;
  sides?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  definition?: string;
  code?: string;
  language?: string;
  expression?: string;
  layers?: ShorthandLayer[];
  // Auto-layout (flexbox) container fields. type "row"/"column"/"stack"/"grid"
  // is normalized to auto_layout with the right direction/wrap.
  direction?: 'row' | 'column';
  gap?: number;
  padding?: number | { top: number; right: number; bottom: number; left: number };
  justify?: string;
  wrap?: boolean;
  // Repeat this layer: a count (N identical copies) or an array of data
  // objects (one copy per item, with {{key}} tokens substituted from the item).
  repeat?: number | Record<string, unknown>[];
  [key: string]: unknown;
}

// ── Expand position shorthand ───────────────────────────────

export function expandPosition(sh: ShorthandLayer): Partial<Layer> {
  if (sh.pos) {
    return { x: sh.pos[0], y: sh.pos[1], width: sh.pos[2], height: sh.pos[3] };
  }
  const result: Partial<Layer> = {};
  if (sh.x !== undefined) result.x = sh.x;
  if (sh.y !== undefined) result.y = sh.y;
  if (sh.width !== undefined) result.width = sh.width;
  if (sh.height !== undefined) result.height = sh.height;
  return result;
}

// ── Expand fill shorthand ───────────────────────────────────
// Models pipe/comma-join a gradient keyword and its colors —
// "gradient|#3E2723|#FFCC80", "linear|#a|#b|#c", or just "#a,#b". Collect the
// hex stops (evenly spaced) into a real gradient. Returns null when it isn't
// one (a lone "#fff" or an rgba() with no second color stays solid).

export function parseDelimitedGradient(s: string): Fill | null {
  const t = s.trim();
  const hexes = t.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
  const startsKeyword = /^(gradient|linear|radial)\b/i.test(t);
  const hasSep = /[|,;]/.test(t);
  if (hexes.length < 2 || !(startsKeyword || hasSep)) return null;
  const radial = /^radial\b/i.test(t);
  const stops = hexes.map((color, i) => ({ color, position: Math.round((i / (hexes.length - 1)) * 100) }));
  return (radial
    ? { type: 'radial', stops }
    : { type: 'linear', angle: 135, stops }) as unknown as Fill;
}

export const PATTERN_NAMES = new Set([
  'dots', 'dot_grid', 'grid', 'graph_paper', 'isometric', 'stripes',
  'diagonal_stripes', 'crosshatch', 'checkerboard', 'chevron', 'zigzag',
  'triangles', 'waves', 'scallop', 'plus', 'cross', 'scatter', 'confetti',
  'halftone', 'blueprint', 'carbon', 'houndstooth', 'brick',
]);

// Parse a compact pattern string: "pattern:halftone", "halftone/#1a1a1a",
// "dots/#222 on #faf5ec". Returns null when it isn't a pattern string.

export function parsePatternString(s: string): Fill | null {
  let t = s.trim();
  const pfx = /^pattern:\s*/i.exec(t);
  if (pfx) t = t.slice(pfx[0].length).trim();
  const onSplit = t.split(/\s+on\s+/i);
  const head = onSplit[0].trim();
  const bg = onSplit[1]?.trim();
  const [nameRaw, fg] = head.split('/').map(p => p.trim());
  const name = nameRaw.toLowerCase().replace(/[\s-]+/g, '_');
  if (!PATTERN_NAMES.has(name)) return null;
  const f: Record<string, unknown> = { type: 'pattern', pattern: name, fg: fg || '$text' };
  if (bg) f['bg'] = bg;
  return f as unknown as Fill;
}

// Normalize a loose pattern/image fill object (fg/foreground/color, bg/background).

export function normalizePatternFill(fill: Fill): Fill {
  const f = fill as unknown as Record<string, unknown>;
  const t = typeof f['type'] === 'string' ? (f['type'] as string).toLowerCase() : '';
  if (t === 'pattern') {
    const name = String(f['pattern'] ?? f['name'] ?? 'dots').toLowerCase().replace(/[\s-]+/g, '_');
    const fg = (f['fg'] ?? f['foreground'] ?? f['color'] ?? '$text') as string;
    const out: Record<string, unknown> = { type: 'pattern', pattern: PATTERN_NAMES.has(name) ? name : 'dots', fg };
    for (const k of ['bg', 'scale', 'angle', 'weight', 'opacity']) if (f[k] !== undefined) out[k] = f[k];
    if (out['bg'] === undefined && f['background'] !== undefined) out['bg'] = f['background'];
    return out as unknown as Fill;
  }
  if (t === 'image') {
    const out: Record<string, unknown> = { type: 'image', src: f['src'] ?? f['url'] ?? f['href'] ?? '' };
    for (const k of ['mode', 'tile_size', 'opacity']) if (f[k] !== undefined) out[k] = f[k];
    return out as unknown as Fill;
  }
  return fill;
}

export function expandFill(fill: string | Fill): Fill {
  if (typeof fill === 'string') {
    const pat = parsePatternString(fill);
    if (pat) return pat;
    const css = parseCssGradient(fill);
    if (css) return css;
    const delim = parseDelimitedGradient(fill);
    if (delim) return delim;
    // A bare keyword ("gradient"/"linear"/"radial") with no colors — a model
    // saying "make it a gradient" without specifying one. Render a sensible
    // theme-token gradient instead of an invalid solid color (which is black).
    const bare = fill.trim().toLowerCase();
    if (bare === 'gradient' || bare === 'linear' || bare === 'linear-gradient') {
      return { type: 'linear', angle: 135, stops: [{ color: '$primary', position: 0 }, { color: '$surface', position: 100 }] } as unknown as Fill;
    }
    if (bare === 'radial' || bare === 'radial-gradient') {
      return { type: 'radial', stops: [{ color: '$primary', position: 0 }, { color: '$surface', position: 100 }] } as unknown as Fill;
    }
    return { type: 'solid', color: fill };
  }
  const fr = fill as unknown as Record<string, unknown>;
  const ft = typeof fr['type'] === 'string' ? (fr['type'] as string).toLowerCase() : '';
  if (ft === 'pattern' || ft === 'image') return normalizePatternFill(fill);
  return normalizeGradientFill(fill);
}

// Parse a CSS gradient string — small models write fills like
// "linear-gradient(to right, #f5c6a5, #e0a96d)" — into the schema's
// {type:'linear', angle, stops} form. Returns null for non-gradient strings.

export function parseCssGradient(s: string): Fill | null {
  const m = s.trim().match(/^(linear|radial|conic)-gradient\s*\((.*)\)\s*$/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  // Split on top-level commas (don't split inside rgb()/hsl()).
  const parts = m[2].split(/,(?![^(]*\))/).map(p => p.trim()).filter(Boolean);
  let angle = 135;
  const colorTokens: string[] = [];
  for (const p of parts) {
    const d = p.toLowerCase();
    if (/deg\s*$/.test(d)) { angle = parseFloat(d); continue; }
    if (/^(to|at|circle|ellipse|closest|farthest|from)\b/.test(d)) {
      if (d.includes('right') && d.includes('bottom')) angle = 135;
      else if (d.includes('right') && d.includes('top')) angle = 45;
      else if (d.includes('left') && d.includes('bottom')) angle = 225;
      else if (d.includes('left') && d.includes('top')) angle = 315;
      else if (d.includes('right')) angle = 90;
      else if (d.includes('left')) angle = 270;
      else if (d.includes('bottom')) angle = 180;
      else if (d.includes('top')) angle = 0;
      continue;
    }
    colorTokens.push(p);
  }
  if (colorTokens.length < 2) return null;
  const stops = colorTokens.map((c, i) => {
    const mm = c.match(/^(.+?)\s+(\d+(?:\.\d+)?)%$/); // "#abc 50%"
    const color = mm ? mm[1].trim() : c.split(/\s+/)[0];
    const position = mm ? Math.round(Number(mm[2])) : Math.round((i / (colorTokens.length - 1)) * 100);
    return { color, position };
  });
  if (kind === 'linear') return { type: 'linear', angle, stops } as unknown as Fill;
  return { type: kind === 'radial' ? 'radial' : 'conic', stops } as unknown as Fill;
}

// The validator accepts solid/linear/radial/conic/noise/multi/none — NOT the
// natural word "gradient" small models (and older guide examples) reach for,
// and it wants stops as {color, position:0-100}, not {color, pos:0-1}. Map both
// so a model's instinctive gradient survives export instead of hard-failing.

export function normalizeGradientFill(fill: Fill): Fill {
  const f = fill as unknown as Record<string, unknown>;
  const t = typeof f['type'] === 'string' ? (f['type'] as string).toLowerCase() : '';
  const isGrad = /^(gradient|linear|radial|conic)/.test(t) || t === 'linear-gradient';
  if (!isGrad || !Array.isArray(f['stops'])) return fill;
  const kind: 'linear' | 'radial' | 'conic' = t.startsWith('radial') ? 'radial' : t.startsWith('conic') ? 'conic' : 'linear';
  const raw = (f['stops'] as Record<string, unknown>[]).map(s => ({
    color: typeof s['color'] === 'string' ? s['color'] : '#000000',
    position: Number(s['position'] ?? s['pos'] ?? s['offset'] ?? s['stop'] ?? 0),
  }));
  const maxP = raw.reduce((m, s) => Math.max(m, Number.isFinite(s.position) ? s.position : 0), 0);
  const scale = maxP > 0 && maxP <= 1 ? 100 : 1; // {pos:0..1} → {position:0..100}
  const stops = raw.map(s => ({ color: s.color, position: Math.max(0, Math.min(100, Math.round((Number.isFinite(s.position) ? s.position : 0) * scale))) }));
  if (kind === 'linear') return { type: 'linear', angle: typeof f['angle'] === 'number' ? f['angle'] : 135, stops } as unknown as Fill;
  const out: Record<string, unknown> = { type: kind, stops };
  if (typeof f['cx'] === 'number') out['cx'] = f['cx'];
  if (typeof f['cy'] === 'number') out['cy'] = f['cy'];
  if (kind === 'radial' && typeof f['radius'] === 'number') out['radius'] = f['radius'];
  return out as unknown as Fill;
}

// ── Expand stroke shorthand ─────────────────────────────────

export function expandStroke(stroke: string | { color: string; width: number }): { color: string; width: number } {
  if (typeof stroke === 'string') {
    return { color: stroke, width: 2 };
  }
  return stroke;
}

// Map loose align/justify words a model uses onto the schema's enums.

export function mapAlignItems(v: string): 'start' | 'center' | 'end' | 'stretch' {
  const s = v.toLowerCase();
  if (s === 'center' || s === 'middle') return 'center';
  if (s === 'end' || s === 'right' || s === 'bottom') return 'end';
  if (s === 'stretch' || s === 'fill') return 'stretch';
  return 'start';
}

export function mapJustify(v: string): 'start' | 'center' | 'end' | 'space-between' | 'space-around' {
  const s = v.toLowerCase().replace(/[_\s]/g, '-');
  if (s === 'center' || s === 'middle') return 'center';
  if (s === 'end' || s === 'right' || s === 'bottom') return 'end';
  if (s.includes('between')) return 'space-between';
  if (s.includes('around') || s === 'evenly' || s === 'space-evenly') return 'space-around';
  return 'start';
}

// Build a minimal Vega-Lite spec from compact chart shorthand. A model writes
// {chart:"bar", data:[{x,y}...]} and gets a real spec; a raw `spec` passes
// through. Rows are normalized so label/value (and friends) map to x/y.

export interface BgCtx { bg: string; accent: string; text: string; palette: string[]; image?: string; }

/** Blend two hex colors (t=0 → a, t=1 → b). Returns #rrggbb, or `a` if unparsable. */

export function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const k = Math.max(0, Math.min(1, t));
  const m = ra.map((c, i) => Math.round(c + (rb[i] - c) * k));
  return '#' + m.map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

export function defaultBgStyle(bg: string): string {
  const rgb = hexToRgb(asHex(bg) ?? '#FAF5EC');
  const dark = rgb ? luminance(rgb) < 0.42 : false;
  return dark ? 'glow:top + grain' : 'gradient:vert + curve:bl + grain';
}

// Map terse typographic aliases a model reaches for onto the TextStyle fields:
// transform/uppercase, italic, decoration/underline, variable-font `variation`,
// OpenType `features`, text `outline`, `highlight` marker, `curve` (text-on-path).

export function textTypography(sh: ShorthandLayer): Record<string, unknown> {
  const r = sh as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const transform = r['transform'] ?? r['text_transform'] ?? (r['uppercase'] === true ? 'uppercase' : undefined);
  if (typeof transform === 'string') out['text_transform'] = transform;
  if (r['italic'] === true) out['font_style'] = 'italic';
  else if (typeof r['font_style'] === 'string') out['font_style'] = r['font_style'];
  if (typeof r['word_spacing'] === 'number') out['word_spacing'] = r['word_spacing'];
  const deco = r['decoration'] ?? r['text_decoration'] ?? (r['underline'] === true ? 'underline' : undefined);
  if (typeof deco === 'string') out['text_decoration'] = deco;
  const variation = r['variation'] ?? r['font_variation_settings'];
  if (variation && typeof variation === 'object') out['font_variation_settings'] = variation;
  const features = r['features'] ?? r['font_feature_settings'];
  if (features && (typeof features === 'object' || typeof features === 'string')) out['font_feature_settings'] = features;
  const outline = r['outline'] ?? r['text_stroke'];
  if (typeof outline === 'string') out['stroke'] = { color: outline, width: 2 };
  else if (outline && typeof outline === 'object') {
    const o = outline as Record<string, unknown>;
    out['stroke'] = { color: String(o['color'] ?? '#000'), width: typeof o['width'] === 'number' ? o['width'] : 2 };
  } else if (typeof r['outline_color'] === 'string') {
    out['stroke'] = { color: r['outline_color'], width: typeof r['outline_width'] === 'number' ? r['outline_width'] : 2 };
  }
  if (typeof r['highlight'] === 'string') out['highlight'] = r['highlight'];
  const curve = r['curve'] ?? r['text_path'];
  if (typeof curve === 'string') out['text_path'] = { d: curve };
  else if (curve && typeof curve === 'object') {
    const c = curve as Record<string, unknown>;
    if (typeof c['d'] === 'string') out['text_path'] = { d: c['d'], side: c['side'], start_offset: c['start_offset'] ?? c['offset'] };
  }
  return out;
}

// Estimate wrapped-text height (matches the renderer's ~0.54×fontSize char width).

export function estTextHeight(text: string, fontSize: number, widthPx: number, lh = 1.3, charFactor = 0.54): number {
  const cpl = Math.max(1, Math.floor(widthPx / (fontSize * charFactor)));
  // WORD-AWARE greedy wrap — the renderer breaks at word boundaries, so a
  // char-count estimate (ceil(len/cpl)) under-counts lines whenever words don't
  // pack evenly (e.g. a 4-word ALL-CAPS title at 1 word/line). Under-counting a
  // title's lines pushes whatever sits below INTO it — a collision diagnose
  // can't see (it's inside the preset group). Greedily pack words exactly as the
  // renderer does so the reserved height matches what's actually drawn.
  let lines = 0;
  for (const seg of text.split('\n')) {
    const words = seg.split(/\s+/).filter(Boolean);
    if (!words.length) { lines += 1; continue; }
    let cur = 0, segLines = 1;
    for (const w of words) {
      if (cur === 0) cur = w.length;
      else if (cur + 1 + w.length <= cpl) { cur += 1 + w.length; continue; }
      else { segLines += 1; cur = w.length; }
      if (w.length > cpl) { segLines += Math.ceil(w.length / cpl) - 1; cur = w.length % cpl || cpl; }
    }
    lines += segLines;
  }
  return Math.ceil(lines * fontSize * lh);
}
// Per-font average glyph advance (÷ fontSize). Condensed display faces (Anton,
// Bebas) pack tight; monospace runs wide; serif/sans sit in the middle.

export function fontCharFactor(font?: string): number {
  if (!font) return 0.54;
  const f = font.toLowerCase();
  if (/mono|courier|consol/.test(f)) return 0.6;
  if (/bebas|anton|oswald|archivo narrow|condensed/.test(f)) return 0.42;
  return 0.54;
}
// Shrink a headline so its LONGEST WORD fits the column. A word can't wrap, so an
// oversized single word (e.g. "CONFERENCE" in a large serif) bleeds off the right
// edge — drop the size until it fits, floored at 0.45× so it never collapses.

export function fitTitleSize(text: string, baseSize: number, widthPx: number, font?: string, caps = false): number {
  const longest = text.split(/\s+/).reduce((a, w) => (w.length > a.length ? w : a), '');
  if (!longest) return baseSize;
  // Uppercase geometric letters (C/O/N/M/W) run much wider than the lowercase
  // average, so caps needs a heavier factor or a long word still bleeds off-edge.
  // Leave a 3% safety margin and err toward shrinking — clipping looks worse.
  const cf = fontCharFactor(font) * (caps ? 1.32 : 1.05);
  const target = widthPx * 0.97;
  const wordW = longest.length * baseSize * cf;
  if (wordW <= target) return baseSize;
  return Math.max(Math.floor(baseSize * (target / wordW)), Math.round(baseSize * 0.42));
}
export const shStr = (v: unknown, d = ''): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (typeof o['text'] === 'string') return o['text']; if (typeof o['value'] === 'string') return o['value']; }
  return d;
};

export function shBox(sh: ShorthandLayer, dw = 1080, dh = 1350): { X: number; Y: number; W: number; H: number } {
  return {
    X: sh.pos?.[0] ?? (typeof sh.x === 'number' ? sh.x : 0),
    Y: sh.pos?.[1] ?? (typeof sh.y === 'number' ? sh.y : 0),
    W: sh.pos?.[2] ?? (typeof sh.width === 'number' ? sh.width : dw),
    H: sh.pos?.[3] ?? (typeof sh.height === 'number' ? sh.height : dh),
  };
}

export function txt(id: string, z: number, x: number, y: number, w: number, h: number, value: string, style: Record<string, unknown>): Layer {
  return { id, type: 'text', z, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), content: { type: 'plain', value }, style } as unknown as Layer;
}

// Editorial text-forward poster — kicker · rule · big headline · deck · body ·
// footer, left-anchored with a held margin and ONE accent. The art-directed
// composition the guide preaches, laid out by the engine in ONE layer.

export interface ListItem { title: string; desc: string; icon: string; }

export interface SecCtx { accent: string; text: string; muted: string; bg: string; W: number; palette?: string[]; align?: 'left' | 'center'; statCols?: number; }

// A short, measure-like token that belongs in a stat's BIG figure slot —
// "30%", "$500B", "1.0 TW", "2.3s", "12M". Used to detect/repair a model that
// swapped a stat's label and value (the long caption must not render huge).

export interface Box { x: number; y: number; w: number; h: number }

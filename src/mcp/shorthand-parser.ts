import yaml from 'js-yaml';
import type { Layer, Fill, TextContent, TextStyle } from '../schema/types';
import { resolveIconName } from '../renderer/lucide-icons';
import { shapePath, type ShapeName, type ShapeBox } from '../engine/shape-paths';
import { hexToRgb, luminance } from './engine/reference';
import { pickMoodVariant, proceduralBgStyle, pickSecLayout, type Mood } from './engine/mood-bank';

/** A concrete hex string (not a token/gradient/Fill object), else null. */
function asHex(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : null;
}
function contrastRatio(a: string, b: string): number {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return 21;
  const la = luminance(ra), lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
/** Keep `prefer` if it's legible on `on`; otherwise flip to near-black/near-white. */
function readableOn(on: string, prefer: string): string {
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
function readablePair(bg: string, explicitText?: unknown, explicitMuted?: unknown): { text: string; muted: string } {
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
function seededDefaults(r: Record<string, unknown>, seedParts: unknown[]): Mood | null {
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
function expandPosition(sh: ShorthandLayer): Partial<Layer> {
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
function parseDelimitedGradient(s: string): Fill | null {
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

const PATTERN_NAMES = new Set([
  'dots', 'dot_grid', 'grid', 'graph_paper', 'isometric', 'stripes',
  'diagonal_stripes', 'crosshatch', 'checkerboard', 'chevron', 'zigzag',
  'triangles', 'waves', 'scallop', 'plus', 'cross', 'scatter', 'confetti',
  'halftone', 'blueprint', 'carbon', 'houndstooth', 'brick',
]);

// Parse a compact pattern string: "pattern:halftone", "halftone/#1a1a1a",
// "dots/#222 on #faf5ec". Returns null when it isn't a pattern string.
function parsePatternString(s: string): Fill | null {
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
function normalizePatternFill(fill: Fill): Fill {
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

function expandFill(fill: string | Fill): Fill {
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
function parseCssGradient(s: string): Fill | null {
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
function normalizeGradientFill(fill: Fill): Fill {
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
function expandStroke(stroke: string | { color: string; width: number }): { color: string; width: number } {
  if (typeof stroke === 'string') {
    return { color: stroke, width: 2 };
  }
  return stroke;
}

// Map loose align/justify words a model uses onto the schema's enums.
function mapAlignItems(v: string): 'start' | 'center' | 'end' | 'stretch' {
  const s = v.toLowerCase();
  if (s === 'center' || s === 'middle') return 'center';
  if (s === 'end' || s === 'right' || s === 'bottom') return 'end';
  if (s === 'stretch' || s === 'fill') return 'stretch';
  return 'start';
}
function mapJustify(v: string): 'start' | 'center' | 'end' | 'space-between' | 'space-around' {
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
function buildChartSpec(sh: ShorthandLayer): Record<string, unknown> {
  const raw = (sh as Record<string, unknown>)['spec'];
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  const kind = typeof sh.chart === 'string' ? sh.chart.toLowerCase() : 'bar';
  const rows = Array.isArray((sh as Record<string, unknown>)['data'])
    ? ((sh as Record<string, unknown>)['data'] as Record<string, unknown>[]) : [];
  const values = (rows.length ? rows : [{ x: 'A', y: 1 }]).map(r => {
    const x = r['x'] ?? r['label'] ?? r['name'] ?? r['category'] ?? r['key'] ?? '';
    const yr = r['y'] ?? r['value'] ?? r['count'] ?? r['amount'] ?? r['v'] ?? 0;
    return { x, y: typeof yr === 'number' ? yr : Number(yr) || 0 };
  });
  if (kind === 'pie' || kind === 'donut') {
    return {
      mark: { type: 'arc', innerRadius: kind === 'donut' ? 60 : 0 },
      encoding: { theta: { field: 'y', type: 'quantitative' }, color: { field: 'x', type: 'nominal' } },
      data: { values },
    };
  }
  return {
    mark: kind === 'line' ? 'line' : kind === 'area' ? 'area' : 'bar',
    encoding: { x: { field: 'x', type: 'nominal' }, y: { field: 'y', type: 'quantitative' } },
    data: { values },
  };
}

// Compile a `feature_grid` preset into a fully-positioned layer tree. The model
// supplies ONLY content (title, subtitle, items[{icon,title,desc}]) + optional
// colors; the engine owns every coordinate, size and z — so a model that can't
// reliably place a row of cards by hand still gets a correct layout. Sizes are
// derived from the box, defaulting to a 1080² canvas.
function buildFeatureGrid(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const X = sh.pos?.[0] ?? (typeof sh.x === 'number' ? sh.x : 0);
  const Y = sh.pos?.[1] ?? (typeof sh.y === 'number' ? sh.y : 0);
  const W = sh.pos?.[2] ?? (typeof sh.width === 'number' ? sh.width : 1080);
  const H = sh.pos?.[3] ?? (typeof sh.height === 'number' ? sh.height : 1080);
  // Accept a string, or {text}/{value} (models sometimes wrap a field).
  const str = (v: unknown, d = ''): string => {
    if (typeof v === 'string') return v;
    if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (typeof o['text'] === 'string') return o['text']; if (typeof o['value'] === 'string') return o['value']; }
    return d;
  };
  // bg from `bg`, or a `bg_gradient` color list / {colors:[…]} the model sends.
  let bgFill: string | Fill | undefined = r['bg'] as string | Fill | undefined;
  if (bgFill === undefined && r['bg_gradient'] !== undefined) {
    const g = r['bg_gradient'];
    const colors = Array.isArray(g) ? g : (g && typeof g === 'object' && Array.isArray((g as Record<string, unknown>)['colors']) ? (g as Record<string, unknown>)['colors'] as unknown[] : []);
    const hex = colors.filter(c => typeof c === 'string') as string[];
    if (hex.length >= 2) bgFill = `linear-gradient(135deg, ${hex.join(', ')})`;
  }
  // No bg from the model → seed a topic-apt mood from the card content so two
  // different feature posters don't both fall to the same default canvas.
  const m = seededDefaults(r, [str(r['title']), str(r['subtitle']), r['items'] ?? r['cards'] ?? r['features']]);
  if (bgFill === undefined && m) bgFill = m.bg;
  const cardFill  = str(r['card_fill'], '$surface');
  const accent    = str(r['accent'], m?.accent ?? '$primary');
  const textColor = str(r['text_color'] ?? r['color'], m?.text_color ?? '$text');
  const muted     = str(r['muted'], textColor);
  const bgStyle   = str(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette   = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  // Card text MUST contrast the CARD fill, not the global canvas. A blind model
  // that picks a dark canvas + light text would otherwise drop that light text
  // onto a light ($surface) card → invisible (the #1 feature_grid failure).
  // Resolve a concrete card surface and pick readable on-card colors.
  const bgHex = asHex(typeof bgFill === 'string' ? bgFill : null);
  const bgRgb = bgHex ? hexToRgb(bgHex) : null;
  const bgDark = bgRgb ? luminance(bgRgb) < 0.42 : false;
  const explicitCard = asHex(r['card_fill']);
  let cardFillResolved: string | Fill = cardFill;
  let cardText = textColor, cardMuted = muted, cardIcon = accent;
  if (explicitCard) {
    cardFillResolved = explicitCard;
    cardText = readableOn(explicitCard, textColor);
    cardMuted = readableOn(explicitCard, muted);
    cardIcon = contrastRatio(accent, explicitCard) >= 2 ? accent : readableOn(explicitCard, accent);
  } else if (bgDark) {
    // Light cards on a dark canvas + dark text — striking AND legible.
    cardFillResolved = '#F4F1EA';
    cardText = '#1A1A1A'; cardMuted = '#5A5650';
    cardIcon = contrastRatio(accent, '#F4F1EA') >= 2 ? accent : '#1A1A1A';
  }
  const rawItems = Array.isArray(r['items']) ? r['items'] : Array.isArray(r['cards']) ? r['cards'] : Array.isArray(r['features']) ? r['features'] : [];
  const items = (rawItems as Record<string, unknown>[]).slice(0, 5).map(it => ({
    icon: str(it['icon'] ?? it['symbol']),
    title: str(it['title'] ?? it['label'] ?? it['name']),
    desc: str(it['desc'] ?? it['description'] ?? it['text'] ?? it['body'] ?? it['benefit']),
  }));
  const N = Math.max(1, items.length);
  const M = Math.round(W * 0.07);
  const gap = Math.round(M * 0.4);
  const rowY = Math.round(H * 0.42), rowH = H - rowY - M;
  const cardW = Math.round((W - 2 * M - (N - 1) * gap) / N);
  const layers: Layer[] = [];
  // Always engine-compose the background. Use the canvas base color (or a dark
  // default — feature_grid reads best on a deep canvas) as the wash base, and
  // when no bg_style was given fall back to a tasteful designed default (glow/
  // sweep + grain) rather than a flat fill — flat reads as a template.
  const base = (typeof bgFill === 'string' ? bgFill : asHex(r['bg'])) ?? (bgHex ?? '#0A0A0A');
  composeBackground(bgStyle || defaultBgStyle(base), id, X, Y, W, H, { bg: base, accent, text: textColor, palette, image: str(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0).forEach(l => layers.push(l));
  // The heading sits on the CANVAS wash, not on a card — so its colors must
  // contrast `base`, not the theme. A blind model that set a dark bg but left
  // text as the theme's dark $text would otherwise render an INVISIBLE title.
  // And MEASURE the wrapped title so a 2–3 line headline shrinks instead of
  // overflowing its fixed box into the subtitle / cards (the bug the vision
  // loop caught on the Hormuz poster).
  const headColor = readableOn(base, textColor);
  const headW = W - 2 * M;
  const headLimit = Y + rowY - Math.round(H * 0.03); // heading must clear the cards row
  let cursorY = Y + Math.round(H * 0.09);
  const title = str(r['title']);
  if (title) {
    let tSizeH = Math.round(W * 0.08);
    let tH = estTextHeight(title, tSizeH, headW, 1.1);
    const maxTH = Math.round(H * 0.22);
    if (tH > maxTH) { tSizeH = Math.max(Math.round(W * 0.045), Math.floor(tSizeH * maxTH / tH)); tH = estTextHeight(title, tSizeH, headW, 1.1); }
    layers.push({ id: `${id}_title`, type: 'text', z: 30, x: X + M, y: cursorY, width: headW, height: tH,
      content: { type: 'plain', value: title }, style: { font_size: tSizeH, font_weight: 800, color: headColor, align: 'center', line_height: 1.1, font_family: str(r['font'] ?? r['font_family'], m?.font ?? '') || undefined } } as unknown as Layer);
    cursorY += tH + Math.round(H * 0.012);
  }
  const subtitle = str(r['subtitle']);
  if (subtitle && cursorY < headLimit) {
    const sSize = Math.round(W * 0.03);
    const sH = Math.min(estTextHeight(subtitle, sSize, headW, 1.25), Math.max(sSize, headLimit - cursorY));
    layers.push({ id: `${id}_subtitle`, type: 'text', z: 30, opacity: 0.8, x: X + M, y: cursorY, width: headW, height: sH,
      content: { type: 'plain', value: subtitle }, style: { font_size: sSize, color: headColor, align: 'center', line_height: 1.25 } } as unknown as Layer);
  }
  // Scale type + MEASURE wrapped heights so long titles/descs never overflow the
  // card or collide (narrow cards → smaller type). Fixed heights overflowed before.
  const pad = 28, innerW = Math.max(40, cardW - 2 * pad);
  const iconSz = Math.max(40, Math.min(60, Math.round(cardW * 0.3)));
  // Also fit the longest UNBREAKABLE token (wrap only breaks on spaces, so a long
  // word like "Zero-Downtime" can't split) — without this a many-card / narrow
  // layout lets long titles bleed past the card edges (diagnose can't see it).
  const longTok = (key: 'title' | 'desc'): number => Math.max(1, ...items.map(it => Math.max(1, ...String(it[key] ?? '').split(/\s+/).map(t => t.length))));
  const tSize = Math.max(14, Math.floor(Math.min(30, cardW * 0.145, (innerW * 0.98) / (longTok('title') * 0.55))));
  const dSize = Math.max(12, Math.floor(Math.min(21, cardW * 0.1, (innerW * 0.98) / (longTok('desc') * 0.52))));
  const cards: Layer[] = items.map((it, i) => {
    const kids: Layer[] = [];
    if (it.icon) kids.push({ id: `${id}_c${i}_icon`, type: 'icon', z: 0, x: 0, y: 0, width: iconSz, height: iconSz, name: it.icon, size: iconSz, color: cardIcon } as unknown as Layer);
    if (it.title) kids.push({ id: `${id}_c${i}_title`, type: 'text', z: 1, x: 0, y: 0, width: innerW, height: estTextHeight(it.title, tSize, innerW, 1.15),
      content: { type: 'plain', value: it.title }, style: { font_size: tSize, font_weight: 700, color: cardText, align: 'center', line_height: 1.15 } } as unknown as Layer);
    if (it.desc) kids.push({ id: `${id}_c${i}_desc`, type: 'text', z: 2, x: 0, y: 0, width: innerW, height: estTextHeight(it.desc, dSize, innerW, 1.4),
      content: { type: 'plain', value: it.desc }, style: { font_size: dSize, color: cardMuted, align: 'center', line_height: 1.4 } } as unknown as Layer);
    return { id: `${id}_card${i}`, type: 'auto_layout', z: i, x: 0, y: 0, width: cardW, height: rowH, direction: 'column',
      gap: 16, padding: pad, align_items: 'center', justify_content: 'center', radius: 18,
      fill: expandFill(cardFillResolved), layers: kids } as unknown as Layer;
  });
  layers.push({ id: `${id}_row`, type: 'auto_layout', z: 35, x: X + M, y: Y + rowY, width: W - 2 * M, height: rowH,
    direction: 'row', gap, justify_content: 'space-between', align_items: 'stretch', layers: cards } as unknown as Layer);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// ── Marble backdrop preset ──────────────────────────────────
// ONE shorthand layer → a full decorative background: soft radial-gradient
// "marble" blobs clustered in the chosen corners (each fades to the canvas
// color at its rim, so text on top stays readable), plus optional veins, rings
// and dots. Collapses the ~15-25 hand-placed shapes models reliably get wrong
// (off-canvas, dropped fills, killed contrast) into a single, balanced intent.
function buildDecor(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const num = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
  const X = sh.pos?.[0] ?? num(sh.x, 0);
  const Y = sh.pos?.[1] ?? num(sh.y, 0);
  const W = sh.pos?.[2] ?? num(sh.width, 1080);
  const H = sh.pos?.[3] ?? num(sh.height, 1350);
  const bg     = typeof r['bg'] === 'string' ? (r['bg'] as string) : '#F3EEF6';
  const accent = typeof r['accent'] === 'string' ? (r['accent'] as string) : '#6231C9';
  const palRaw = (Array.isArray(r['palette']) ? r['palette'] : []).filter(c => typeof c === 'string') as string[];
  const pal    = palRaw.length ? palRaw : ['#B9C4F0', '#C9B6EC', '#A6DAE8', '#F6CBA6'];
  const corners = (Array.isArray(r['corners']) ? r['corners'] : ['tr', 'bl'])
    .filter(c => ['tl', 'tr', 'bl', 'br'].includes(c as string)) as string[];
  const intensity = Math.max(0.2, Math.min(1, num(r['intensity'], 0.7)));
  const veins = r['veins'] !== false;
  const rings = Math.max(0, Math.round(num(r['rings'], 1)));
  const dots  = Math.max(0, Math.round(num(r['dots'], 1)));
  const style = typeof r['style'] === 'string' ? (r['style'] as string) : 'marble';

  const solid  = (color: string): Fill => ({ type: 'solid', color } as unknown as Fill);
  const radial = (color: string): Fill => ({ type: 'radial', stops: [{ color, position: 0 }, { color: bg, position: 100 }] } as unknown as Fill);
  const layers: Layer[] = [
    { id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: solid(bg) } as unknown as Layer,
  ];

  if (style === 'mesh') {
    // gradient-mesh wash: a few big soft radial gradients spread near the edges
    // (no veins/rings) — a calmer, more abstract backdrop than marble.
    const spots: [number, number][] = [[0.16, 0.12], [0.86, 0.22], [0.26, 0.82], [0.80, 0.84]];
    spots.forEach(([fx, fy], i) => {
      const s = Math.round(W * 0.62);
      layers.push({ id: `${id}_m${i}`, type: 'ellipse', z: i + 1, x: Math.round(X + fx * W - s / 2), y: Math.round(Y + fy * H - s / 2),
        width: s, height: s, fill: radial(pal[i % pal.length]), opacity: +(intensity * 0.5).toFixed(2) } as unknown as Layer);
    });
    return { id, type: 'group', z, x: 0, y: 0, width: W, height: H, layers } as unknown as Layer;
  }

  // style "marble" (default): organic corner clusters + veins/rings/dots.
  // [cornerX, cornerY, inwardX, inwardY] per corner key
  const ANCHOR: Record<string, [number, number, number, number]> = {
    tl: [X, Y, 1, 1], tr: [X + W, Y, -1, 1], bl: [X, Y + H, 1, -1], br: [X + W, Y + H, -1, -1],
  };
  let zc = 1;
  for (const cn of corners) {
    const [ax, ay, dx, dy] = ANCHOR[cn];
    const inset = Math.round(W * 0.05), step = Math.round(W * 0.10), base = Math.round(W * 0.42);
    for (let i = 0; i < 4; i++) {                          // 4 overlapping blobs marching inward
      const s = base - i * Math.round(W * 0.055);
      const cx = ax + dx * (inset + i * step), cy = ay + dy * (inset + i * step);
      layers.push({ id: `${id}_${cn}b${i}`, type: 'ellipse', z: zc++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2),
        width: s, height: s, fill: radial(pal[i % pal.length]), opacity: +(intensity * (0.95 - i * 0.13)).toFixed(2) } as unknown as Layer);
    }
    if (veins) for (let v = 0; v < 2; v++) {               // diagonal veins across the cluster
      layers.push({ id: `${id}_${cn}v${v}`, type: 'line', z: zc++,
        x1: Math.round(ax + dx * Math.round(W * 0.03)), y1: Math.round(ay + dy * Math.round(W * (0.10 + v * 0.16))),
        x2: Math.round(ax + dx * Math.round(W * (0.30 + v * 0.10))), y2: Math.round(ay + dy * Math.round(W * 0.02)),
        stroke: { color: accent, width: 2 }, opacity: +(intensity * 0.3).toFixed(2) } as unknown as Layer);
    }
    for (let k = 0; k < rings; k++) {                      // outline rings
      const s = Math.round(W * (0.36 - k * 0.30)), cx = ax + dx * (inset + Math.round(W * 0.02)), cy = ay + dy * (inset + Math.round(W * 0.02));
      layers.push({ id: `${id}_${cn}r${k}`, type: 'ellipse', z: zc++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2),
        width: s, height: s, stroke: { color: accent, width: 3 }, opacity: +(intensity * 0.5).toFixed(2) } as unknown as Layer);
    }
    for (let d = 0; d < dots; d++) {                       // accent dots (kept inside the corner triangle, off any footer text)
      const s = 18 + d * 14, cx = ax + dx * Math.round(W * (0.13 + d * 0.06)), cy = ay + dy * Math.round(W * (0.13 + d * 0.05));
      layers.push({ id: `${id}_${cn}d${d}`, type: 'ellipse', z: zc++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2),
        width: s, height: s, fill: solid(d % 2 ? pal[0] : accent), opacity: 0.85 } as unknown as Layer);
    }
  }
  return { id, type: 'group', z, x: 0, y: 0, width: W, height: H, layers } as unknown as Layer;
}

// ── Rich background composition ─────────────────────────────
// A blind model can't safely stack a separate decorative layer UNDER a content
// preset (off-canvas, wrong z, killed contrast). So every flow preset takes a
// `bg_style` string and the ENGINE composes a layered, collision-proof
// background BEHIND the content: a base wash (solid/gradient/mesh/marble) +
// optional corner "curved-gradient" sweeps / glow / edge bands + a faint pattern
// texture overlay. Tokens combine with "+": "gradient + dots + curve", "mesh +
// halftone", "marble", "gradient:vert + band". Lives inside the preset group, so
// diagnose (top-level only) can't false-flag the intentionally-soft decor.
interface BgCtx { bg: string; accent: string; text: string; palette: string[]; image?: string; }

/** Blend two hex colors (t=0 → a, t=1 → b). Returns #rrggbb, or `a` if unparsable. */
function mixHex(a: string, b: string, t: number): string {
  const ra = hexToRgb(a), rb = hexToRgb(b);
  if (!ra || !rb) return a;
  const k = Math.max(0, Math.min(1, t));
  const m = ra.map((c, i) => Math.round(c + (rb[i] - c) * k));
  return '#' + m.map(c => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0')).join('');
}

function parseBgSpec(spec: string): { base: string; baseArg: string; sweeps: string[]; overlays: string[] } {
  let base = 'solid', baseArg = '';
  const sweeps: string[] = [], overlays: string[] = [];
  for (const raw of spec.toLowerCase().split('+')) {
    const tk = raw.trim(); if (!tk) continue;
    const [nm0, arg = ''] = tk.split(':').map(s => s.trim());
    const nm = nm0.replace(/[\s-]+/g, '_');
    if (nm === 'solid' || nm === 'flat') base = 'solid';
    else if (nm === 'gradient' || nm === 'linear') { base = 'gradient'; baseArg = arg; }
    else if (nm === 'radial') { base = 'radial'; baseArg = arg; }
    else if (nm === 'mesh' || nm === 'marble') base = nm;
    else if (nm === 'photo' || nm === 'image' || nm === 'cover') base = 'photo';
    // sweeps keep their placement arg (e.g. curve:bl, glow:bottom) after the ':'.
    else if (nm === 'curve' || nm === 'curved' || nm === 'curved_gradient' || nm === 'corner' || nm === 'sweep') sweeps.push('curve:' + (arg || 'tr'));
    else if (nm === 'glow' || nm === 'spotlight') sweeps.push('glow:' + (arg || 'top'));
    else if (nm === 'band' || nm === 'band_left' || nm === 'sidebar') sweeps.push('band_left');
    else if (nm === 'band_top' || nm === 'topbar') sweeps.push('band_top');
    else if (nm === 'grain' || nm === 'noise' || nm === 'film') sweeps.push('grain');
    else if (nm === 'vignette' || nm === 'vignet') sweeps.push('vignette');
    // Bold GEOMETRIC sweeps (non-circular) — the anti-"AI circle" vocabulary.
    else if (nm === 'tri' || nm === 'triangle' || nm === 'wedge') sweeps.push('tri:' + (arg || 'br'));
    else if (nm === 'blocks' || nm === 'bauhaus' || nm === 'block') sweeps.push('blocks:' + (arg || 'mix'));
    else if (nm === 'rings' || nm === 'concentric' || nm === 'target') sweeps.push('rings:' + (arg || 'tr'));
    else if (nm === 'arcs' || nm === 'scallop_arc' || nm === 'orbit') sweeps.push('arcs:' + (arg || 'bottom'));
    else if (nm === 'diag' || nm === 'diagonal' || nm === 'slash') sweeps.push('diag:' + (arg || 'tr'));
    else if (nm === 'wave' || nm === 'waveband' || nm === 'ribbon') sweeps.push('wave:' + (arg || 'bottom'));
    else if (nm === 'shards' || nm === 'confetti_shapes' || nm === 'scatter_shapes') sweeps.push('shards:' + (arg || 'mix'));
    else if (nm === 'pattern') { const p = arg.replace(/[\s-]+/g, '_'); overlays.push(PATTERN_NAMES.has(p) ? p : 'dots'); }
    else if (PATTERN_NAMES.has(nm)) overlays.push(nm);
  }
  return { base, baseArg, sweeps, overlays };
}

/** Compose a layered background (base + sweeps + texture) behind content. */
function composeBackground(spec: string, idp: string, X: number, Y: number, W: number, H: number, ctx: BgCtx, z0 = 0): Layer[] {
  const { base, baseArg, sweeps, overlays } = parseBgSpec(spec);
  const { bg, accent, text } = ctx;
  const bgHex = asHex(bg) ?? '#FAF5EC';
  const bgRgb = hexToRgb(bgHex);
  const dark = bgRgb ? luminance(bgRgb) < 0.42 : false;
  const pal = ctx.palette.length >= 2 ? ctx.palette : [accent, mixHex(bgHex, accent, 0.5), mixHex(bgHex, text, 0.3)];
  const p0 = pal[0] ?? accent, p1 = pal[1] ?? accent, p2 = pal[2] ?? p1;
  const layers: Layer[] = [];
  let z = z0;
  const radialTo = (c: string): Fill => ({ type: 'radial', stops: [{ color: c, position: 0 }, { color: bgHex, position: 100 }] } as unknown as Fill);
  const blob = (id: string, cx: number, cy: number, s: number, c: string, op: number): void => {
    layers.push({ id, type: 'ellipse', z: z++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2), width: s, height: s, fill: radialTo(c), opacity: +op.toFixed(2) } as unknown as Layer);
  };
  // Resolve a placement keyword (corner/edge/center) to an anchor point.
  const anchor = (a: string): [number, number] => {
    switch (a) {
      case 'tl': return [X, Y]; case 'tr': return [X + W, Y]; case 'bl': return [X, Y + H]; case 'br': return [X + W, Y + H];
      case 'top': return [X + W * 0.5, Y]; case 'bottom': return [X + W * 0.5, Y + H];
      case 'left': return [X, Y + H * 0.5]; case 'right': return [X + W, Y + H * 0.5];
      case 'center': case 'centre': case 'middle': return [X + W * 0.5, Y + H * 0.5];
      default: return [X + W, Y];
    }
  };

  // BASE WASH
  if (base === 'photo' && ctx.image) {
    // Full-bleed image (renders in editor/HTML; resvg can't fetch remote URLs,
    // so PNG preview shows the scrim+layout). A solid legibility veil keeps text
    // readable — dark veil under light text, light veil under dark text.
    layers.push({ id: `${idp}_photo`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'image', src: ctx.image, mode: 'cover' } as unknown as Fill } as unknown as Layer);
    const tRgb = hexToRgb(asHex(text) ?? '#1A1A1A');
    const veil = tRgb && luminance(tRgb) > 0.5 ? '#0A0A0A' : '#FFFFFF';
    layers.push({ id: `${idp}_scrim`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'solid', color: veil }, opacity: 0.5 } as unknown as Layer);
  } else if (base === 'gradient' || base === 'radial') {
    const ang = /^\d+$/.test(baseArg) ? Number(baseArg) : baseArg === 'vert' ? 180 : baseArg === 'horiz' ? 90 : 135;
    // Palette-driven multi-hue wash (tinted toward bg so text stays legible),
    // else a subtle two-tone bg→accent.
    // A radial that drops the SATURATED palette colour at the dead centre reads as
    // an "over-processed glow blob" (user feedback). For radial, keep the canvas
    // colour at the centre (position 0) and let only a FAINT tint reach the edge —
    // and mix gentler on a light canvas so the wash never turns into a colour spot.
    const isRadial = base === 'radial';
    // Gentler on light canvases: a 0.38 mix turned the wash into a muddy two-tone
    // field (user: "over-processed background"). Keep light gradients subtle so a
    // bg stays a backdrop, not a colour event; dark canvases tolerate more.
    const mixK = isRadial ? (dark ? 0.34 : 0.1) : (dark ? 0.46 : 0.2);
    // A bg → SINGLE-tint two-stop wash. A multi-hue 3–4 stop ramp (bg→blue→gold→…)
    // reads as a muddy two-tone field with a hard perceptual seam; one tint keeps
    // the gradient a quiet backdrop. mesh/marble bases still use the full palette.
    const tintTo = ctx.palette[0] ?? accent;
    const stops = [{ color: bgHex, position: 0 }, { color: mixHex(bgHex, tintTo, mixK), position: 100 }];
    const grad: Fill = isRadial
      ? { type: 'radial', stops } as unknown as Fill   // bg at centre, faint tint at edge — no saturated centre blob
      : { type: 'linear', angle: ang, stops } as unknown as Fill;
    layers.push({ id: `${idp}_bg`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: grad } as unknown as Layer);
  } else {
    layers.push({ id: `${idp}_bg`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: expandFill(bg) } as unknown as Layer);
    if (base === 'mesh') {
      // A SUBTLE tonal mesh, not an "AI gradient mesh": 3 soft blobs (down from 4)
      // tinted TOWARD the bg (full-saturation palette hues read as over-processed
      // glow — user feedback) using at most TWO hues so it's quiet depth, not a
      // rainbow wash, at low opacity (0.4→0.26 dark).
      const spots: [number, number][] = [[0.16, 0.12], [0.85, 0.2], [0.78, 0.86]];
      const hues = [pal[0] ?? accent, pal[1] ?? pal[0] ?? accent];
      spots.forEach(([fx, fy], i) => blob(`${idp}_mesh${i}`, X + fx * W, Y + fy * H, Math.round(W * 0.5), mixHex(bgHex, hues[i % hues.length], dark ? 0.55 : 0.4), dark ? 0.26 : 0.16));
    } else if (base === 'marble') {
      const cs: [number, number, number, number][] = [[X + W, Y, -1, 1], [X, Y + H, 1, -1]];
      cs.forEach(([ax, ay, dx, dy], ci) => {
        const inset = Math.round(W * 0.05), step = Math.round(W * 0.1), bse = Math.round(W * 0.4);
        for (let i = 0; i < 3; i++) blob(`${idp}_mb${ci}_${i}`, ax + dx * (inset + i * step), ay + dy * (inset + i * step), bse - i * Math.round(W * 0.06), pal[i % pal.length], (dark ? 0.55 : 0.4) * (0.95 - i * 0.18));
      });
    }
  }

  // SWEEPS — curved-gradient sweep / glow (both placement-aware) / edge band /
  // grain / vignette (built-in shapes only, so everything rasterizes in PNG).
  for (const sw of sweeps) {
    const [kind, place] = sw.split(':');
    if (kind === 'curve') { const [cx, cy] = anchor(place || 'tr'); blob(`${idp}_curve`, cx, cy, Math.round(W * 0.85), mixHex(bgHex, accent, dark ? 0.46 : 0.2), dark ? 0.5 : 0.4); }
    else if (kind === 'glow') { const [cx, cy] = anchor(place || 'top'); blob(`${idp}_glow`, cx, cy, Math.round(W * 0.72), mixHex(bgHex, accent, dark ? 0.42 : 0.18), dark ? 0.32 : 0.22); }
    else if (kind === 'band_left') layers.push({ id: `${idp}_band`, type: 'rect', z: z++, x: X, y: Y, width: Math.max(6, Math.round(W * 0.022)), height: H, fill: { type: 'solid', color: accent } } as unknown as Layer);
    else if (kind === 'band_top') layers.push({ id: `${idp}_band`, type: 'rect', z: z++, x: X, y: Y, width: W, height: Math.max(5, Math.round(W * 0.016)), fill: { type: 'solid', color: accent } } as unknown as Layer);
    else if (kind === 'grain') layers.push({ id: `${idp}_grain`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'noise', frequency: 0.9, octaves: 2, opacity: dark ? 0.06 : 0.045 } as unknown as Fill } as unknown as Layer);
    else if (kind === 'vignette') {
      // Edge-framing: dark radial blobs centred just BEYOND each corner so only
      // the outer edge darkens (the bright centre is left clear) and they fade to
      // the canvas color. Opaque stops → rasterizes everywhere. Subtle on light.
      const dk = mixHex(bgHex, '#000000', dark ? 0.6 : 0.28), s = Math.round(Math.max(W, H) * 0.52);
      const o = Math.round(s * 0.18); // push centre outward past the corner
      ([['tl', X - o, Y - o], ['tr', X + W + o, Y - o], ['bl', X - o, Y + H + o], ['br', X + W + o, Y + H + o]] as [string, number, number][])
        .forEach(([c, cx, cy]) => blob(`${idp}_vig_${c}`, cx, cy, s, dk, dark ? 0.55 : 0.32));
    }
    // ── GEOMETRIC sweeps (rect / triangle / ring / arc / diagonal / wave /
    // scattered polygons) — the NON-circular vocabulary so styles stop looking
    // like the same radial-blob template. All built from primitives that
    // rasterize in PNG. Colors blend toward bg so text over them stays legible.
    else if (kind === 'tri') {
      const x2 = X + W, y2 = Y + H, T = Math.round(W * 0.6);
      const triD = (k: string): string =>
        k === 'tr' ? `M${x2 - T} ${Y}L${x2} ${Y}L${x2} ${Y + T}Z`
          : k === 'tl' ? `M${X} ${Y}L${X + T} ${Y}L${X} ${Y + T}Z`
          : k === 'bl' ? `M${X} ${y2 - T}L${X} ${y2}L${X + T} ${y2}Z`
          : `M${x2 - T} ${y2}L${x2} ${y2}L${x2} ${y2 - T}Z`;
      const c1 = place || 'br', c2 = c1 === 'br' ? 'tl' : c1 === 'tl' ? 'br' : c1 === 'tr' ? 'bl' : 'tr';
      layers.push({ id: `${idp}_tri0`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: triD(c1), fill: { type: 'solid', color: mixHex(bgHex, p0, dark ? 0.5 : 0.55) }, opacity: dark ? 0.3 : 0.28 } as unknown as Layer);
      layers.push({ id: `${idp}_tri1`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: triD(c2), fill: { type: 'solid', color: mixHex(bgHex, p1, 0.45) }, opacity: dark ? 0.2 : 0.16 } as unknown as Layer);
    }
    else if (kind === 'diag') {
      // A diagonal color field (one big triangle across a diagonal) — a flat,
      // hard-edged wash instead of a soft circular gradient.
      const x2 = X + W, y2 = Y + H, d = place === 'tl'
        ? `M${X} ${Y}L${x2} ${Y}L${X} ${y2}Z` : `M${x2} ${Y}L${x2} ${y2}L${X} ${y2}Z`;
      layers.push({ id: `${idp}_diag`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d, fill: { type: 'solid', color: mixHex(bgHex, p0, dark ? 0.42 : 0.5) }, opacity: dark ? 0.26 : 0.2 } as unknown as Layer);
    }
    else if (kind === 'blocks') {
      // Bauhaus/Swiss offset rectangles — strong rectilinear character.
      const specs: [number, number, number, number, string][] = [
        [0.0, 0.0, 0.16, 1.0, p0], [0.74, 0.62, 0.26, 0.38, p1], [0.55, 0.0, 0.45, 0.12, p2],
      ];
      specs.forEach(([fx, fy, fw, fh, c], i) => layers.push({ id: `${idp}_blk${i}`, type: 'rect', z: z++,
        x: Math.round(X + fx * W), y: Math.round(Y + fy * H), width: Math.round(fw * W), height: Math.round(fh * H),
        fill: { type: 'solid', color: mixHex(bgHex, c, dark ? 0.4 : 0.5) }, opacity: dark ? 0.28 : 0.2 } as unknown as Layer));
    }
    else if (kind === 'rings') {
      // Concentric OUTLINED ovals (stroke, no fill) near a corner — round, but a
      // different feel than the solid blob: airy, technical.
      const [cx, cy] = anchor(place || 'tr');
      for (let i = 0; i < 3; i++) { const r = Math.round(W * (0.5 - i * 0.13));
        layers.push({ id: `${idp}_ring${i}`, type: 'ellipse', z: z++, x: Math.round(cx - r), y: Math.round(cy - r), width: r * 2, height: r * 2, stroke: { color: mixHex(bgHex, p0, dark ? 0.55 : 0.6), width: Math.max(2, Math.round(W * 0.006)) }, opacity: dark ? 0.32 : 0.26 } as unknown as Layer); }
    }
    else if (kind === 'arcs') {
      // A big sweeping arc band at an edge (open stroke).
      const band = Math.round(W * 0.5), atBottom = (place || 'bottom') !== 'top';
      const by = atBottom ? Y + H - band : Y - band;
      const box: ShapeBox = { x: X - Math.round(W * 0.15), y: by, w: Math.round(W * 1.3), h: band * 2 };
      const arc = shapePath('arc', box, { start: atBottom ? 180 : 0, end: atBottom ? 360 : 180 });
      layers.push({ id: `${idp}_arc`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: arc.d, stroke: { color: mixHex(bgHex, p0, dark ? 0.55 : 0.55), width: Math.max(8, Math.round(W * 0.05)) }, opacity: dark ? 0.28 : 0.24 } as unknown as Layer);
    }
    else if (kind === 'wave') {
      // A wavy ribbon band along one edge — organic but hard-rendered (no circle).
      const band = Math.round(H * 0.22), atBottom = (place || 'bottom') !== 'top';
      const wy = atBottom ? Y + H - band : Y;
      const box: ShapeBox = { x: X - 2, y: wy, w: W + 4, h: band };
      const wv = shapePath('wave', box, { amplitude: Math.round(band * 0.45), cycles: 3 });
      layers.push({ id: `${idp}_wave`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: wv.d, fill: { type: 'solid', color: mixHex(bgHex, p0, dark ? 0.42 : 0.5) }, opacity: dark ? 0.28 : 0.22 } as unknown as Layer);
    }
    else if (kind === 'shards') {
      // Scattered GEOMETRIC confetti (triangles + squares + a plus) in palette —
      // playful, editorial, decidedly not dots.
      const shards: [number, number, number, number][] = [
        [0.12, 0.08, 0.07, 0], [0.9, 0.14, 0.05, 1], [0.84, 0.78, 0.08, 2],
        [0.08, 0.86, 0.06, 0], [0.93, 0.5, 0.045, 1], [0.06, 0.46, 0.05, 2],
      ];
      shards.forEach(([fx, fy, fs, kindIdx], i) => {
        const cx = X + fx * W, cy = Y + fy * H, s2 = Math.round(fs * W), c = mixHex(bgHex, [p0, p1, p2][i % 3] ?? p0, dark ? 0.5 : 0.6);
        if (kindIdx === 0) layers.push({ id: `${idp}_sh${i}`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: `M${Math.round(cx)} ${Math.round(cy - s2)}L${Math.round(cx + s2)} ${Math.round(cy + s2)}L${Math.round(cx - s2)} ${Math.round(cy + s2)}Z`, fill: { type: 'solid', color: c }, opacity: dark ? 0.32 : 0.28 } as unknown as Layer);
        else if (kindIdx === 1) layers.push({ id: `${idp}_sh${i}`, type: 'rect', z: z++, x: Math.round(cx - s2), y: Math.round(cy - s2), width: s2 * 2, height: s2 * 2, rotation: 18, fill: { type: 'solid', color: c }, opacity: dark ? 0.32 : 0.28 } as unknown as Layer);
        else layers.push({ id: `${idp}_sh${i}`, type: 'rect', z: z++, x: Math.round(cx - s2 * 1.4), y: Math.round(cy - s2 * 0.4), width: Math.round(s2 * 2.8), height: Math.round(s2 * 0.8), fill: { type: 'solid', color: c }, opacity: dark ? 0.32 : 0.28 } as unknown as Layer);
      });
    }
  }

  // OVERLAY — whisper-faint pattern texture (no tile bg → the base shows
  // through). Kept VERY low-contrast + sparse so it reads as a premium paper
  // grain, never as a crowded screen. (Tuned down from fg .7/.4 · op .12/.07 ·
  // scale 1.8 — user feedback: backgrounds were over-processed and crowded.)
  for (const ov of overlays) {
    const fg = dark ? mixHex(bgHex, text, 0.4) : mixHex(bgHex, text, 0.22);
    layers.push({ id: `${idp}_tex`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'pattern', pattern: ov, fg, opacity: dark ? 0.055 : 0.035, scale: 2.6 } as unknown as Fill } as unknown as Layer);
  }
  return layers;
}

// When a preset is given NO bg_style, the OLD fallback was a flat solid rect —
// which reads as a template, the #1 "AI-generated" tell and the gap between a
// diagnose-clean poster and the hand-art-directed peak. Default instead to a
// tasteful, collision-proof designed background: a faint accent glow/sweep + a
// premium grain, tuned by bg luminance. Subtle enough never to fight the text,
// it's what turns a flat number-on-cream into a designed poster. A model that
// genuinely wants flat can still pass bg_style:"solid".
function defaultBgStyle(bg: string): string {
  const rgb = hexToRgb(asHex(bg) ?? '#FAF5EC');
  const dark = rgb ? luminance(rgb) < 0.42 : false;
  return dark ? 'glow:top + grain' : 'gradient:vert + curve:bl + grain';
}

// Map terse typographic aliases a model reaches for onto the TextStyle fields:
// transform/uppercase, italic, decoration/underline, variable-font `variation`,
// OpenType `features`, text `outline`, `highlight` marker, `curve` (text-on-path).
function textTypography(sh: ShorthandLayer): Record<string, unknown> {
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
function fontCharFactor(font?: string): number {
  if (!font) return 0.54;
  const f = font.toLowerCase();
  if (/mono|courier|consol/.test(f)) return 0.6;
  if (/bebas|anton|oswald|archivo narrow|condensed/.test(f)) return 0.42;
  return 0.54;
}
// Shrink a headline so its LONGEST WORD fits the column. A word can't wrap, so an
// oversized single word (e.g. "CONFERENCE" in a large serif) bleeds off the right
// edge — drop the size until it fits, floored at 0.45× so it never collapses.
function fitTitleSize(text: string, baseSize: number, widthPx: number, font?: string, caps = false): number {
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
const shStr = (v: unknown, d = ''): string => {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') { const o = v as Record<string, unknown>; if (typeof o['text'] === 'string') return o['text']; if (typeof o['value'] === 'string') return o['value']; }
  return d;
};
function shBox(sh: ShorthandLayer, dw = 1080, dh = 1350): { X: number; Y: number; W: number; H: number } {
  return {
    X: sh.pos?.[0] ?? (typeof sh.x === 'number' ? sh.x : 0),
    Y: sh.pos?.[1] ?? (typeof sh.y === 'number' ? sh.y : 0),
    W: sh.pos?.[2] ?? (typeof sh.width === 'number' ? sh.width : dw),
    H: sh.pos?.[3] ?? (typeof sh.height === 'number' ? sh.height : dh),
  };
}
function txt(id: string, z: number, x: number, y: number, w: number, h: number, value: string, style: Record<string, unknown>): Layer {
  return { id, type: 'text', z, x: Math.round(x), y: Math.round(y), width: Math.round(w), height: Math.round(h), content: { type: 'plain', value }, style } as unknown as Layer;
}

// Editorial text-forward poster — kicker · rule · big headline · deck · body ·
// footer, left-anchored with a held margin and ONE accent. The art-directed
// composition the guide preaches, laid out by the engine in ONE layer.
function buildEditorial(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['label']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const subtitle = shStr(r['subtitle'] ?? r['lede'] ?? r['deck']);
  const body = shStr(r['body'] ?? r['desc']);
  const footer = shStr(r['footer']);
  // Seed the mood from the essay's own words when the model gave no bg.
  const m = seededDefaults(r, [title, subtitle, body, kicker]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  const M = Math.round(W * 0.08);
  const cW = W - 2 * M, cX = X + M;
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  let cy = Y + Math.round(H * 0.13), k = layers.length;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += Math.round(H * 0.035);
  }
  layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: cW, height: 3, fill: { type: 'solid', color: textColor } } as unknown as Layer);
  cy += Math.round(H * 0.025);
  if (title) {
    const edFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
    const ts = fitTitleSize(title, Math.round(W * 0.085), cW, edFont), th = estTextHeight(title, ts, cW, 1.04);
    layers.push(txt(`${id}_title`, z + k++, cX, cy, cW, th, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.04, font_family: edFont }));
    cy += th + Math.round(H * 0.025);
  }
  if (subtitle) {
    const ss = Math.round(W * 0.032), sh2 = estTextHeight(subtitle, ss, cW, 1.35);
    layers.push(txt(`${id}_sub`, z + k++, cX, cy, cW, sh2, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.35 }));
    cy += sh2 + Math.round(H * 0.025);
  }
  if (body) {
    const bs = Math.round(W * 0.022), bh = estTextHeight(body, bs, cW, 1.55);
    layers.push(txt(`${id}_body`, z + k++, cX, cy, cW, bh, body, { font_size: bs, font_weight: 400, color: textColor, line_height: 1.55 }));
  }
  if (footer) {
    const fy = Y + H - Math.round(H * 0.09);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: fy, width: cW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(txt(`${id}_footer`, z + k++, cX, fy + 16, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Two-panel editorial split — a color/pattern block on one side, kicker + big
// headline + deck vertically centered on the other. ratio = panel fraction
// (number, or "golden" = 0.382). The engine owns every coordinate.
function buildSplit(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh, 1080, 1080);
  const side = shStr(r['side'], 'left') === 'right' ? 'right' : 'left';
  let ratio = typeof r['ratio'] === 'number' ? r['ratio'] : (r['ratio'] === 'golden' ? 0.382 : 0.5);
  ratio = Math.max(0.25, Math.min(0.7, ratio));
  const bg = shStr(r['bg'], '#FAF5EC');
  const accent = shStr(r['accent'], '#B8543C');
  const panelFill = r['panel'] ?? r['panel_fill'] ?? accent;
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'], r['muted']);
  const panelText = shStr(r['panel_text'], '#FAF5EC');
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['label']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const subtitle = shStr(r['subtitle'] ?? r['lede'] ?? r['deck'] ?? r['body']);
  const panelLabel = shStr(r['panel_label'] ?? r['big']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment']);
  const palette = (Array.isArray(r['palette']) ? r['palette'] : []).filter((c): c is string => typeof c === 'string');

  const PW = Math.round(W * ratio);
  const panelX = side === 'left' ? X : X + W - PW;
  const contentX = side === 'left' ? X + PW : X;
  const Mcol = Math.round((W - PW) * 0.1);
  const cW = (W - PW) - 2 * Mcol, cX = contentX + Mcol;

  // Full-canvas background (rich engine-composed when bg_style is set), then the
  // opaque panel covers its side and the content reads over the other side.
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  const panelZ = layers.length;
  layers.push({ id: `${id}_panel`, type: 'rect', z: panelZ, x: panelX, y: Y, width: PW, height: H, fill: expandFill(panelFill as string | Fill) } as unknown as Layer);
  let k = panelZ + 1;
  if (panelLabel) {
    layers.push(txt(`${id}_plabel`, k++, panelX, Y + H / 2 - Math.round(PW * 0.18), PW, Math.round(PW * 0.4), panelLabel, { font_size: Math.round(PW * 0.28), font_weight: 800, color: panelText, align: 'center', line_height: 1.0 }));
  }
  // Measure the content block, then vertically center it.
  const ts = Math.round(cW * 0.16), ss = Math.round(cW * 0.058);
  const titleH = title ? estTextHeight(title, ts, cW, 1.05) : 0;
  const subH = subtitle ? estTextHeight(subtitle, ss, cW, 1.4) : 0;
  const kickH = kicker ? Math.round(H * 0.05) : 0;
  const total = kickH + (title ? titleH + Math.round(H * 0.02) : 0) + subH;
  let cy = Y + Math.max(Math.round(H * 0.12), (H - total) / 2);
  if (kicker) {
    layers.push(txt(`${id}_kick`, k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(cW * 0.04), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += kickH;
  }
  if (title) {
    layers.push(txt(`${id}_title`, k++, cX, cy, cW, titleH, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.05 }));
    cy += titleH + Math.round(H * 0.02);
  }
  if (subtitle) {
    layers.push(txt(`${id}_sub`, k++, cX, cy, cW, subH, subtitle, { font_size: ss, font_weight: 400, color: muted, line_height: 1.4 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Numbered / stepped LIST — the most common poster structure ("5 tips", "3
// steps", "7 reasons") and the one with no other preset. Engine MEASURES every
// item's wrapped title + description and stacks them with a distributed rhythm
// (slack spread between items, never a dead bottom), an accent marker in the
// left gutter, a held margin, and an auto-sized headline. Removes the hand-
// placed-list failure mode (overflow + collision) entirely. ONE layer in.
interface ListItem { title: string; desc: string; icon: string; }
function readListItems(v: unknown): ListItem[] {
  if (!Array.isArray(v)) return [];
  return v.map((it) => {
    const o = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    return {
      title: shStr(o['title'] ?? o['name'] ?? o['label'] ?? o['heading'] ?? (typeof it === 'string' ? it : '')),
      desc: shStr(o['desc'] ?? o['description'] ?? o['text'] ?? o['subtitle'] ?? o['body']),
      icon: shStr(o['icon']),
    };
  }).filter((i) => i.title || i.desc);
}

function buildList(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const footer = shStr(r['footer']);
  const marker = shStr(r['marker'], 'number'); // number | bullet | icon | none
  const items = readListItems(r['items']);
  // Seed the mood from the list's own items when the model gave no bg.
  const m = seededDefaults(r, [title, kicker, items]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);

  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  // Did the carousel page-fill hand this list the full page rect (private
  // __fillPage marker)? Then FILL that height and center the content — a
  // content-sized group on a fixed slide left an empty lower band (the dead
  // "black strip" a carousel list slide showed). A poster list (even one the
  // model gave an explicit pos) still sizes to content so the doc auto-fits.
  const boxed = r['__fillPage'] === true;
  const M = Math.round(W * 0.08), cX = X + M, contentW = W - 2 * M;
  // Content is laid out into its own array first so the final height is known
  // before the background is composed (composeBackground must span the whole
  // page, not just the measured content).
  const content: Layer[] = [];
  const layers: Layer[] = [];
  let k = 1, cy = Y + Math.round(W * 0.085);

  if (kicker) {
    content.push(txt(`${id}_kick`, z + k++, cX, cy, contentW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += Math.round(W * 0.05);
  }
  if (title) {
    const ts = Math.round(W * 0.07), th = estTextHeight(title, ts, contentW, 1.04);
    content.push(txt(`${id}_title`, z + k++, cX, cy, contentW, th, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.04 }));
    cy += th + Math.round(W * 0.02);
    content.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: contentW, height: 3, fill: { type: 'solid', color: textColor } } as unknown as Layer);
    content.push({ id: `${id}_tick`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy) - 2, width: Math.round(W * 0.13), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
    cy += Math.round(W * 0.05);
  }

  const gutter = marker === 'none' ? 0 : Math.round(W * 0.085);
  const tX = cX + gutter, tW = contentW - gutter;
  const its = Math.round(W * 0.032), ds = Math.round(W * 0.0205), gapTD = Math.round(its * 0.4);
  const itemGap = Math.round(W * 0.03);     // fixed inter-item rhythm — content sizes the page
  items.forEach((it, i) => {
    const tH = estTextHeight(it.title, its, tW, 1.12);
    const dH = it.desc ? estTextHeight(it.desc, ds, tW, 1.4) : 0;
    if (marker === 'number') {
      const ms = Math.round(W * 0.042);
      content.push(txt(`${id}_n${i}`, z + k++, cX, cy - Math.round(ms * 0.08), gutter, ms * 1.3, String(i + 1).padStart(2, '0'), { font_size: ms, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -1 }));
    } else if (marker === 'bullet') {
      content.push({ id: `${id}_d${i}`, type: 'ellipse', z: z + k++, x: cX, y: Math.round(cy + tH * 0.28), width: Math.round(W * 0.018), height: Math.round(W * 0.018), fill: { type: 'solid', color: accent } } as unknown as Layer);
    } else if (marker === 'icon' && it.icon) {
      content.push({ id: `${id}_i${i}`, type: 'icon', z: z + k++, x: cX, y: Math.round(cy), width: Math.round(W * 0.05), height: Math.round(W * 0.05), icon: it.icon, color: accent } as unknown as Layer);
    }
    content.push(txt(`${id}_t${i}`, z + k++, tX, cy, tW, tH, it.title, { font_size: its, font_weight: 700, color: textColor, line_height: 1.12 }));
    if (it.desc) content.push(txt(`${id}_b${i}`, z + k++, tX, cy + tH + gapTD, tW, dH, it.desc, { font_size: ds, font_weight: 400, color: muted, line_height: 1.4 }));
    cy += tH + (it.desc ? gapTD + dH : 0) + itemGap;
  });
  if (items.length) cy -= itemGap;          // drop the trailing gap after the last item

  if (footer) {
    cy += Math.round(W * 0.05);
    content.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: contentW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    cy += 14;
    content.push(txt(`${id}_footer`, z + k++, cX, Math.round(cy), contentW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
    cy += 30;
  }

  // Natural content height (clamped sane). A boxless POSTER list uses this so the
  // canvas fits the content; a BOXED carousel page list FILLS the given page
  // height and centers the content block (no empty lower band / dead strip).
  const naturalH = Math.min(Math.round(W * 3.6), Math.max(Math.round(W * 0.5), Math.round(cy + W * 0.07 - Y)));
  const finalH = boxed ? Math.max(naturalH, H) : naturalH;
  const yOff = finalH > naturalH ? Math.round((finalH - naturalH) / 2) : 0;
  if (yOff) for (const l of content) { const ly = l as unknown as { y: number }; ly.y = ly.y + yOff; }
  // Compose a real background sized to the FULL page (texture/depth, not a flat
  // fill — buildList was the one preset that skipped this), then lay content on top.
  const bgLayers = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, finalH, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  content.forEach((l, i) => { (l as unknown as { z: number }).z = 30 + i; });
  layers.push(...bgLayers, ...content);
  return { id, type: 'group', z, x: X, y: Y, width: W, height: finalH, layers } as unknown as Layer;
}

// Single-statistic focal poster — a huge dominant number (the ONE accent
// moment), a small kicker above, a one-line caption below, optional footer.
// Engine sizes the number to dominate and measures the caption, so the focal
// hierarchy is guaranteed. Removes the hand-placed big-number flail (the model
// can't see that its giant number overflowed or collided with the caption).
function buildStat(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['label'] ?? r['eyebrow']);
  const stat = shStr(r['stat'] ?? r['value'] ?? r['number'] ?? r['title'] ?? r['text'], '0');
  const caption = shStr(r['caption'] ?? r['subtitle'] ?? r['desc'] ?? r['body'] ?? r['context'] ?? r['note'] ?? r['summary'] ?? r['lead'] ?? r['blurb'] ?? r['detail']);
  const footer = shStr(r['footer'] ?? r['source'] ?? r['credit']);
  // Seed the mood from the stat's caption when the model gave no bg (else every
  // stat poster is the same near-black + vermillion default).
  const m = seededDefaults(r, [caption, kicker, stat]);
  const bg = shStr(r['bg'], m?.bg ?? '#0A0A0A');
  const accent = shStr(r['accent'], m?.accent ?? '#FF3D00');
  // Caption + kicker + footer sit ON the bg. readablePair flips text to a legible
  // tone for the actual canvas — a vision-less model cannot see text vanish.
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const capColor = textColor;
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  const M = Math.round(W * 0.08), cX = X + M, cW = W - 2 * M;
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);

  // Size the number to dominate: fit-to-width, capped, never tiny.
  const len = Math.max(2, stat.replace(/\s/g, '').length);
  const numSize = Math.max(Math.round(W * 0.12), Math.min(Math.round(W * 0.42), Math.round(cW / (len * 0.58))));
  const numH = estTextHeight(stat, numSize, cW, 1.0);
  const capSize = Math.round(W * 0.034);
  const capH = caption ? estTextHeight(caption, capSize, cW, 1.4) : 0;
  const kickH = kicker ? Math.round(H * 0.045) : 0;
  const gap = Math.round(H * 0.028);
  const total = kickH + numH + (caption ? gap + capH : 0);
  let cy = Y + Math.max(Math.round(H * 0.16), (H - total) / 2 - Math.round(H * 0.03));
  let k = layers.length;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: muted, letter_spacing: 2, text_transform: 'uppercase' }));
    cy += kickH;
  }
  layers.push(txt(`${id}_stat`, z + k++, cX, cy, cW, numH, stat, { font_size: numSize, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -2, font_family: shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined }));
  cy += numH + (caption ? gap : 0);
  if (caption) {
    layers.push({ id: `${id}_caprule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy) - Math.round(gap * 0.4), width: Math.round(W * 0.13), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    layers.push(txt(`${id}_cap`, z + k++, cX, cy + 14, cW, capH, caption, { font_size: capSize, font_weight: 400, color: capColor, line_height: 1.4 }));
  }
  if (footer) {
    const fy = Y + H - Math.round(H * 0.07);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: fy, width: cW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(txt(`${id}_footer`, z + k++, cX, fy + 14, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Event / flyer poster — a BIG auto-sized title, a stack of detail lines
// (date / venue / time) below it, optional engine-placed accent bars in the
// margin, footer. The whole block is vertically centered so it fills the canvas.
// Removes the hand-placed bold-poster flail (title collides with the details;
// decor lands invisible or scattered) — the blind model can't see any of that.
// A short, date-like detail line ("Sat July 18 · 8 PM", "June 15-16, 2026",
// "07/18") — the one the event poster should hero as a big accent moment instead
// of burying in the uniform mono stack. A month name or a numeric date pattern in
// a short line qualifies; a long sentence or a time-only line ("9:00 AM") does not.
const EVENT_MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
const EVENT_NUMDATE_RE = /\b\d{1,4}[\/.-]\d{1,2}(?:[\/.-]\d{1,4})?\b/;
function isDateLine(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 34) return false;
  return EVENT_MONTH_RE.test(t) || EVENT_NUMDATE_RE.test(t);
}

function readDetailLines(r: Record<string, unknown>): string[] {
  const d = r['details'] ?? r['lines'] ?? r['info'];
  if (Array.isArray(d)) return d.filter((x): x is string => typeof x === 'string');
  const out: string[] = [];
  for (const key of ['date', 'venue', 'location', 'place', 'time', 'when', 'where']) {
    const v = r[key];
    if (typeof v === 'string' && v.trim()) out.push(v);
  }
  return out;
}
function buildEvent(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text'], 'EVENT');
  const footer = shStr(r['footer']);
  const details = readDetailLines(r);
  // Seed the mood from the event's title/details when the model gave no bg.
  const m = seededDefaults(r, [title, kicker, details]);
  const bg = shStr(r['bg'], m?.bg ?? '#0A0A0A');
  const accent = shStr(r['accent'], m?.accent ?? '#FF3D00');
  const { text: textColor, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');

  const M = Math.round(W * 0.08), cX = X + M, cW = W - 2 * M;
  const bgHex = asHex(bg);
  // Decor bar colors must contrast the canvas (don't repeat the invisible-decor bug).
  const palRaw = (Array.isArray(r['palette']) ? r['palette'] : []).filter((c): c is string => typeof c === 'string');
  let bars = (palRaw.length ? palRaw : [accent]).filter(c => !bgHex || contrastRatio(c, bgHex) >= 1.5);
  if (!bars.length) bars = [contrastRatio(accent, bgHex ?? '#000') >= 1.5 ? accent : textColor];

  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text: textColor, palette: palRaw, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  let k = layers.length;
  // Measure the centered content block (kicker + title + details). The title is
  // ALL-CAPS sans and the details ALL-CAPS mono — both wrap WIDER than the 0.54
  // default, so measure with caps-aware factors (0.60 / 0.66) to match the
  // renderer. Without this a title that wraps to 3 caps lines under-budgets and
  // the details overlap its last line (diagnose can't see inside the preset).
  const eventFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  // Shrink the (often very large) caps title so its longest word fits the width.
  const ts = fitTitleSize(title, Math.round(W * 0.15), cW, eventFont, true), titleH = estTextHeight(title, ts, cW, 1.0, 0.60);
  // Hero the date — pull the first date-like line out of the stack and render it
  // big in the accent (the prominent "JULY 18" an event poster wants), leaving the
  // venue/meta lines in the calm mono stack below it.
  let heroDate = ''; const restDetails: string[] = [];
  for (const line of details) { if (!heroDate && isDateLine(line)) heroDate = line.trim(); else restDetails.push(line); }
  const hs = heroDate ? fitTitleSize(heroDate, Math.round(W * 0.062), cW, eventFont, true) : 0;
  const heroH = heroDate ? estTextHeight(heroDate, hs, cW, 1.0, 0.6) : 0;
  const heroGap = heroDate ? Math.round(H * 0.022) : 0;
  const ds = Math.round(W * 0.026), lineGap = Math.round(H * 0.012);
  const detailH = restDetails.reduce((a, l) => a + estTextHeight(l, ds, cW, 1.25, 0.66) + lineGap, 0);
  const kickH = kicker ? Math.round(H * 0.05) : 0;
  const total = kickH + titleH + Math.round(H * 0.03) + heroH + heroGap + detailH;
  const top = Y + Math.max(Math.round(H * 0.12), (H - total) / 2 - Math.round(H * 0.02));

  // Accent bars in the far-left margin, staggered, vertically spanning the block.
  bars.slice(0, 3).forEach((c, i) => {
    layers.push({ id: `${id}_bar${i}`, type: 'rect', z: z + k++, x: Math.round(X + W * 0.018 + i * W * 0.022), y: Math.round(top + i * H * 0.03), width: Math.round(W * 0.012), height: Math.round((titleH + heroH + detailH) * (0.95 - i * 0.12)), fill: { type: 'solid', color: c } } as unknown as Layer);
  });

  let cy = top;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: accent, letter_spacing: 2, text_transform: 'uppercase' }));
    cy += kickH;
  }
  layers.push(txt(`${id}_title`, z + k++, cX, cy, cW, titleH, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.0, letter_spacing: -1, text_transform: 'uppercase', font_family: eventFont }));
  cy += titleH + Math.round(H * 0.03);
  if (heroDate) {
    layers.push(txt(`${id}_hero`, z + k++, cX, cy, cW, heroH, heroDate, { font_size: hs, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -1, text_transform: 'uppercase', font_family: eventFont }));
    cy += heroH + heroGap;
  }
  restDetails.forEach((line, i) => {
    const lh = estTextHeight(line, ds, cW, 1.25, 0.66);
    // With a hero date carrying the accent, the meta lines stay calm; without one,
    // the last line keeps the accent highlight (often the date/CTA).
    const accentLine = !heroDate && i === restDetails.length - 1;
    layers.push(txt(`${id}_d${i}`, z + k++, cX, cy, cW, lh, line, { font_family: 'IBM Plex Mono', font_size: ds, font_weight: 600, color: accentLine ? accent : textColor, letter_spacing: 1, text_transform: 'uppercase' }));
    cy += lh + lineGap;
  });
  if (footer) {
    // Anchor the footer to the bottom margin, OR just below the detail stack when
    // long (wrapped) detail lines overran past it — never on top of it. A fixed
    // bottom y collided the footer with the last detail line (blind-30B: a "hosted
    // by…" footer printed over the "Free · All ages…" meta line).
    const fy = Math.max(Y + H - Math.round(H * 0.07), Math.round(cy) + lineGap);
    layers.push(txt(`${id}_footer`, z + k++, cX, fy, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Rich multi-section "infographic / report" poster. The blind-model unlock for
// CONTENT-DENSE, professional layouts: the model supplies an ordered list of
// typed blocks (heading · text · stats row · list · callout · quote · divider)
// and the engine MEASURES each and flows them top-to-bottom with editorial
// rhythm, an accent system, held margins and a footer — so a dense, organized,
// human-designer-level composition is one call instead of dozens of colliding
// hand-placed layers.
interface SecCtx { accent: string; text: string; muted: string; bg: string; W: number; palette?: string[]; align?: 'left' | 'center'; statCols?: number; }

// A short, measure-like token that belongs in a stat's BIG figure slot —
// "30%", "$500B", "1.0 TW", "2.3s", "12M". Used to detect/repair a model that
// swapped a stat's label and value (the long caption must not render huge).
function figureLike(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 14) return false;
  return /^[+\-]?[$€£¥]?\d[\d.,:]*\s?(?:%|[KMBT]|[kKMG]?Wh?|TW|GW|MW|x|×|s|hrs?|bn|m|k|°[CF]?)?\+?$/.test(t);
}

function renderSectionBlock(b: Record<string, unknown>, idp: string, z0: number, x: number, y: number, w: number, ctx: SecCtx): { layers: Layer[]; height: number } {
  const { accent, text, muted, bg, W } = ctx;
  const kind = shStr(b['kind'] ?? b['type'], 'text');
  const layers: Layer[] = [];
  let z = z0;
  // The item array is the #1 alias gap: a model names it items / rows / data /
  // values / stats / bars interchangeably. Reading only b['items'] silently
  // drops the whole block (caught a "By the numbers" slide rendering blank).
  const arrField = (...keys: string[]): Record<string, unknown>[] => {
    for (const k of keys) if (Array.isArray(b[k])) return b[k] as Record<string, unknown>[];
    return [];
  };

  if (kind === 'heading' || kind === 'subhead' || kind === 'section') {
    const t = shStr(b['text'] ?? b['title'] ?? b['heading'] ?? b['content']);
    const size = Math.round(W * (kind === 'subhead' ? 0.032 : 0.044));
    layers.push({ id: `${idp}_tick`, type: 'rect', z: z++, x, y, width: Math.round(W * 0.055), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    const th = estTextHeight(t, size, w, 1.1);
    layers.push(txt(`${idp}_h`, z++, x, y + 20, w, th, t, { font_size: size, font_weight: 800, color: text, line_height: 1.1, letter_spacing: -0.5 }));
    return { layers, height: 20 + th };
  }
  // A subhead PLUS its body, the common "heading_text" block weak models emit
  // (heading in `sub_theme`/`heading`, body in `text`/`subtitles`). Without this
  // it fell to the generic fallback → the body rendered as a bare floating line
  // with no hierarchy (the g_energy "Cost Reductions / Job Creation" case).
  if (kind === 'heading_text' || kind === 'titled_text' || kind === 'section_block' || kind === 'subsection') {
    let head = shStr(b['heading'] ?? b['sub_theme'] ?? b['subhead'] ?? b['title'] ?? b['name']);
    const subs = Array.isArray(b['subtitles']) ? (b['subtitles'] as unknown[]).map(s => shStr(s)).filter(Boolean).join(' ') : '';
    let body = subs || shStr(b['body'] ?? b['subtitle'] ?? b['desc'] ?? b['text'] ?? b['content']);
    if (!head) { head = body; body = ''; }   // only one string given → it's the heading
    // A model that wants a single-stat poster often writes the FIGURE as the
    // heading_text heading ("$1.7 trillion" / "$250B") + a caption, instead of a
    // stats block — and the figure then renders at a timid ~35px. When the heading
    // IS a figure (a compact token, or a number + a scale word) and a caption
    // follows, render it as a HERO number (accent, fit-to-width), matching the
    // single-stat stats-block treatment. Recurring student-debt / creator-economy.
    const ht = head.trim(), hw = ht.split(/\s+/);
    const heroFig = !!body && ht.length <= 20 && (figureLike(ht)
      || (hw.length === 2 && /^[$€£¥]?[+\-]?[\d.,]+$/.test(hw[0])
        && /^(trillion|billion|million|thousand|percent|hours?|hrs?|days?|years?|weeks?|months?|minutes?|seconds?)$/i.test(hw[1])));
    if (heroFig) {
      const maxTok = Math.max(1, ...hw.map(t => t.length));
      const vSize = Math.max(40, Math.round(Math.min(W * 0.13, (w * 0.92) / (maxTok * 0.58))));
      const vh = estTextHeight(head, vSize, w, 1.04);
      layers.push({ id: `${idp}_tick`, type: 'rect', z: z++, x, y, width: Math.round(W * 0.055), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_hh`, z++, x, y + 22, w, vh, head, { font_size: vSize, font_weight: 800, color: accent, line_height: 1.04, letter_spacing: -1 }));
      let total = 22 + vh;
      const bSize = Math.round(W * 0.026), bh = estTextHeight(body, bSize, w, 1.45);
      layers.push(txt(`${idp}_hb`, z++, x, y + total + 16, w, bh, body, { font_size: bSize, font_weight: 400, color: text, line_height: 1.45 }));
      total += 16 + bh;
      return { layers, height: total };
    }
    const hSize = Math.round(W * 0.032);
    layers.push({ id: `${idp}_tick`, type: 'rect', z: z++, x, y, width: Math.round(W * 0.055), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    const hh = estTextHeight(head, hSize, w, 1.15);
    layers.push(txt(`${idp}_hh`, z++, x, y + 20, w, hh, head, { font_size: hSize, font_weight: 800, color: text, line_height: 1.15, letter_spacing: -0.4 }));
    let total = 20 + hh;
    if (body) {
      const bSize = Math.round(W * 0.0225);
      const bh = estTextHeight(body, bSize, w, 1.5);
      layers.push(txt(`${idp}_hb`, z++, x, y + total + 10, w, bh, body, { font_size: bSize, font_weight: 400, color: muted, line_height: 1.5 }));
      total += 10 + bh;
    }
    return { layers, height: total };
  }
  if (kind === 'text' || kind === 'paragraph' || kind === 'body' || kind === 'intro') {
    const t = shStr(b['text'] ?? b['body'] ?? b['value'] ?? b['content']);
    const size = Math.round(W * (kind === 'intro' ? 0.026 : 0.0225));
    const th = estTextHeight(t, size, w, 1.5);
    layers.push(txt(`${idp}_t`, z++, x, y, w, th, t, { font_size: size, font_weight: 400, color: kind === 'intro' ? text : muted, line_height: 1.5 }));
    return { layers, height: th };
  }
  if (kind === 'stats' || kind === 'stat_row' || kind === 'kpis' || kind === 'metrics') {
    const items = arrField('items', 'rows', 'stats', 'values', 'data', 'metrics', 'kpis').slice(0, 4);
    const lSize = Math.round(W * 0.016);
    // Resolve each figure FIRST — split a merged "58% hybrid" / "$250B market"
    // into value + label so the figure stays narrow.
    const resolved = items.map(it => {
      let val = shStr(it['value'] ?? it['stat'] ?? it['number'] ?? it['title']);
      let lab = shStr(it['label'] ?? it['desc'] ?? it['text']);
      const merged = (!lab && val) ? val : (!val && lab) ? lab : '';
      if (merged) {
        const m = merged.trim().match(/^([+\-]?[$€£¥]?[\d.,]+\s*(?:%|[KMBkmb×x])?)\s+(.+)$/);
        if (m) { val = m[1].trim(); lab = m[2].trim(); }
      }
      // A weak model often SWAPS the pair — figure into `label`, caption into
      // `value` (e.g. label:"30%", value:"Share of … renewables") — so the big
      // number renders the long prose and the caption shrinks to "30%". Correct
      // it: the short measure-like token is the figure; the prose is the label.
      if (val && lab && figureLike(lab) && !figureLike(val) && (val.length > 12 || /\s/.test(val.trim()))) {
        [val, lab] = [lab, val];
      }
      // A figure cell whose VALUE carries no digit (a weak model wrote the unit or a
      // word — "minutes", "fast" — where the number belongs) renders as a giant fake
      // number next to the real digits. Demote it into the label so the big-number
      // slot stays numeric; a digit-less, all-caption stats block is handled below.
      if (val && !/[\d∞]/.test(val) && val.trim().length <= 14) { lab = lab ? `${val} · ${lab}` : val; val = ''; }
      return { val, lab };
    });
    // A stats block with NO figures — the model gave captions but no numbers
    // (g_color) — must NOT render as empty big-number slots. Keep only cells that
    // HAVE a figure; if none do, render the (real) caption copy as one compact
    // line so the content still shows instead of vanishing.
    const shown = resolved.filter(rr => rr.val.trim() !== '');
    if (!shown.length) {
      const caps = resolved.map(rr => rr.lab.trim()).filter(Boolean);
      if (!caps.length) return { layers, height: 0 };
      const line = caps.join('   ·   ');
      const size = Math.round(W * 0.0205);
      const th = estTextHeight(line, size, w, 1.5);
      layers.push(txt(`${idp}_caps`, z++, x, y, w, th, line, { font_size: size, font_weight: 500, color: muted, line_height: 1.5 }));
      return { layers, height: th };
    }
    const n = shown.length;
    // 4-across row by default, or a 2-column grid when the layout variant asks
    // for it (ctx.statCols) AND there are >2 figures — a structurally different
    // stat block for the same data (the "all designs are the same" fix). The
    // 2-col grid gets wider columns (bigger numbers) and centered cells.
    const cols = (ctx.statCols === 2 && n > 2) ? 2 : n;
    const rows = Math.ceil(n / cols);
    const colGap = Math.round(W * 0.025), rowGap = Math.round(W * 0.03);
    const colW = Math.round((w - (cols - 1) * colGap) / cols);
    const cellCenter = ctx.align === 'center' || cols === 2;
    const valAlign = cellCenter ? { align: 'center' } : {};
    // Size the figure to FIT its column: the longest UNBREAKABLE token of any
    // value must fit colW (a long single-token value like "$0.04/kWh" otherwise
    // overruns the column and collides with the next stat — and diagnose can't
    // see inside this group, so the layout must be collision-proof by construction).
    const maxTok = Math.max(1, ...shown.map(rr => Math.max(1, ...rr.val.split(/\s+/).map(t => t.length))));
    // A LONE figure is the poster's focal point, not a row cell — let it grow into a
    // hero number (a blind model that builds a single-stat poster as a 1-item stats
    // block otherwise gets a timid ~59px figure instead of a dominant one). A
    // multi-stat row keeps the compact cap so columns stay balanced. Still fit-to-
    // column so a long token never overruns.
    const figCap = n === 1 ? W * 0.14 : W * 0.055;
    const vSize = Math.max(22, Math.round(Math.min(figCap, (colW * 0.92) / (maxTok * 0.58))));
    // Measure every cell, then place row-by-row (each row as tall as its tallest
    // cell) so a wrapped label never overlaps the row beneath it.
    const cells = shown.map(({ val, lab }) => {
      const vh = estTextHeight(val, vSize, colW, 1.05);
      const lh = lab ? estTextHeight(lab, lSize, colW, 1.3, 0.66) : 0;
      return { val, lab, vh, lh, h: vh + (lab ? 10 + lh : 0) };
    });
    const rowH = Array.from({ length: rows }, (_, r) => Math.max(0, ...cells.filter((_, i) => Math.floor(i / cols) === r).map(c => c.h)));
    cells.forEach((c, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      const ix = x + col * (colW + colGap);
      const iy = y + rowH.slice(0, row).reduce((a, h) => a + h, 0) + row * rowGap;
      layers.push(txt(`${idp}_v${i}`, z++, ix, iy, colW, c.vh, c.val, { font_size: vSize, font_weight: 800, color: accent, line_height: 1.05, letter_spacing: -1, ...valAlign }));
      if (c.lab) layers.push(txt(`${idp}_l${i}`, z++, ix, iy + c.vh + 10, colW, c.lh, c.lab, { font_family: 'IBM Plex Mono', font_size: lSize, font_weight: 500, color: muted, letter_spacing: 0.5, text_transform: 'uppercase', ...valAlign }));
    });
    const totalH = rowH.reduce((a, h) => a + h, 0) + Math.max(0, rows - 1) * rowGap;
    return { layers, height: totalH };
  }
  // Connected PROCESS FLOW — numbered nodes on a left rail joined by arrows, with
  // measured (collision-free) title + desc to the right. A blind model asked for a
  // "flow" hand-places ellipses + boxes + text that OVERLAP (it can't see wrapping);
  // this engine-owned block lays steps out so they never collide and reads as a real
  // process diagram. Rasterizes (ellipse/rect/path/text — no foreignObject). `steps`
  // routes here (a step list IS a sequence) while plain `list` stays bullets.
  if (kind === 'flow' || kind === 'process' || kind === 'pipeline' || kind === 'workflow' || kind === 'journey' || kind === 'steps' || kind === 'step') {
    const items = arrField('items', 'steps', 'stages', 'nodes', 'phases', 'rows', 'list', 'points', 'data');
    if (!items.length) return { layers, height: 0 };
    const nodeR = Math.round(W * 0.026);
    const railX = x + nodeR;
    const gap = Math.round(W * 0.03);
    const textX = x + 2 * nodeR + Math.round(W * 0.03);
    const textW = w - (textX - x);
    const tSize = Math.round(W * 0.027), dSize = Math.round(W * 0.02);
    const numColor = readableOn(accent, bg);
    const rows = items.map(it => {
      const title = shStr(it['title'] ?? it['name'] ?? it['label'] ?? it['heading'] ?? it['step']);
      const desc = shStr(it['desc'] ?? it['text'] ?? it['description'] ?? it['detail'] ?? it['body']);
      const tH = estTextHeight(title || ' ', tSize, textW, 1.15);
      const dH = desc ? estTextHeight(desc, dSize, textW, 1.4) : 0;
      const rowH = Math.max(2 * nodeR, tH + (desc ? 6 + dH : 0));
      return { title, desc, tH, dH, rowH };
    });
    let yy = y;
    rows.forEach((row, i) => {
      const nodeTop = yy;
      const nodeCY = yy + nodeR;
      // rail + downward arrow to the next node (drawn first → sits behind the node)
      if (i < rows.length - 1) {
        const lineTop = nodeTop + 2 * nodeR;
        const nextTop = yy + row.rowH + gap;
        const lineH = Math.max(0, nextTop - lineTop);
        layers.push({ id: `${idp}_rail${i}`, type: 'rect', z: z++, x: railX - 2, y: lineTop, width: 4, height: lineH, opacity: 0.4, fill: { type: 'solid', color: accent } } as unknown as Layer);
        const my = lineTop + lineH / 2;
        const ah = Math.round(nodeR * 0.5);
        layers.push({ id: `${idp}_arw${i}`, type: 'path', z: z++, x: railX - ah, y: my - ah, width: 2 * ah, height: 2 * ah, d: `M ${railX - ah} ${Math.round(my - ah * 0.4)} L ${railX + ah} ${Math.round(my - ah * 0.4)} L ${railX} ${Math.round(my + ah * 0.75)} Z`, fill: { type: 'solid', color: accent } } as unknown as Layer);
      }
      // node circle + step number
      layers.push({ id: `${idp}_node${i}`, type: 'ellipse', z: z++, x: railX - nodeR, y: nodeTop, width: 2 * nodeR, height: 2 * nodeR, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_nn${i}`, z++, railX - nodeR, Math.round(nodeCY - nodeR * 0.62), 2 * nodeR, Math.round(nodeR * 1.3), String(i + 1), { font_size: Math.round(nodeR * 0.92), font_weight: 800, color: numColor, align: 'center', line_height: 1.0 }));
      // title + desc, top-aligned to the node
      layers.push(txt(`${idp}_ft${i}`, z++, textX, nodeTop, textW, row.tH, row.title, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (row.desc) layers.push(txt(`${idp}_fd${i}`, z++, textX, nodeTop + row.tH + 6, textW, row.dH, row.desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      yy += row.rowH + gap;
    });
    return { layers, height: Math.max(0, yy - y - gap) };
  }
  if (kind === 'list' || kind === 'bullets' || kind === 'checklist') {
    const items = arrField('items', 'rows', 'steps', 'list', 'points', 'data');
    const gutter = Math.round(W * 0.055), tSize = Math.round(W * 0.026), dSize = Math.round(W * 0.02);
    let yy = y;
    items.forEach((it, i) => {
      const title = shStr(it['title'] ?? it['name'] ?? it['label']);
      const desc = shStr(it['desc'] ?? it['text'] ?? it['description']);
      const tH = estTextHeight(title, tSize, w - gutter, 1.15);
      const dH = desc ? estTextHeight(desc, dSize, w - gutter, 1.4) : 0;
      layers.push(txt(`${idp}_n${i}`, z++, x, yy, gutter, tSize * 1.3, String(i + 1).padStart(2, '0'), { font_size: Math.round(tSize * 1.05), font_weight: 800, color: accent, line_height: 1.0 }));
      layers.push(txt(`${idp}_lt${i}`, z++, x + gutter, yy, w - gutter, tH, title, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (desc) layers.push(txt(`${idp}_ld${i}`, z++, x + gutter, yy + tH + 6, w - gutter, dH, desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      yy += tH + (desc ? 6 + dH : 0) + Math.round(W * 0.022);
    });
    return { layers, height: Math.max(0, yy - y - Math.round(W * 0.022)) };
  }
  // Feature/benefit CARDS nested as a sections block — a blind model naturally
  // writes {kind:"feature_grid", title, subtitle, items:[{icon,title,desc}]}
  // inside a sections layer (feature_grid is really a top-level preset, so this
  // kind used to hit the unknown-kind fallback that renders only the title and
  // SILENTLY DROPS every item — the Swell "Key Features" with zero features bug).
  // Render the items as a measured 2-column grid (title + desc per card, accent
  // tick), with the block's own title/subtitle as a sub-heading above.
  if (kind === 'feature_grid' || kind === 'features' || kind === 'feature' || kind === 'cards' || kind === 'grid' || kind === 'benefits') {
    const items = arrField('items', 'cards', 'features', 'rows', 'list', 'data', 'points');
    if (!items.length) return { layers, height: 0 };
    let yy = y;
    const hTitle = shStr(b['title'] ?? b['heading']);
    const hSub = shStr(b['subtitle'] ?? b['subhead'] ?? b['intro']);
    if (hTitle) {
      const hs = Math.round(W * 0.03), hh = estTextHeight(hTitle, hs, w, 1.1);
      layers.push(txt(`${idp}_h`, z++, x, yy, w, hh, hTitle, { font_size: hs, font_weight: 800, color: text, line_height: 1.1 }));
      yy += hh + Math.round(W * 0.012);
    }
    if (hSub) {
      const ss = Math.round(W * 0.022), sh = estTextHeight(hSub, ss, w, 1.35);
      layers.push(txt(`${idp}_sh`, z++, x, yy, w, sh, hSub, { font_size: ss, font_weight: 400, color: muted, line_height: 1.35 }));
      yy += sh + Math.round(W * 0.022);
    }
    const cols = items.length >= 2 ? 2 : 1;
    const colGap = Math.round(W * 0.035), colW = Math.round((w - colGap * (cols - 1)) / cols);
    const tSize = Math.round(W * 0.025), dSize = Math.round(W * 0.0195), tickH = Math.max(3, Math.round(W * 0.006));
    const rowGap = Math.round(W * 0.03);
    let rowTop = yy, rowMax = 0, col = 0;
    items.forEach((it, i) => {
      const cTitle = shStr(it['title'] ?? it['name'] ?? it['label'] ?? it['heading']);
      const cDesc = shStr(it['desc'] ?? it['text'] ?? it['description'] ?? it['detail'] ?? it['body']);
      const cx = x + col * (colW + colGap);
      const tH = estTextHeight(cTitle || ' ', tSize, colW, 1.15);
      const dH = cDesc ? estTextHeight(cDesc, dSize, colW, 1.4) : 0;
      const cellH = tickH + 10 + tH + (cDesc ? 6 + dH : 0);
      layers.push({ id: `${idp}_tk${i}`, type: 'rect', z: z++, x: cx, y: rowTop, width: Math.round(W * 0.045), height: tickH, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_ct${i}`, z++, cx, rowTop + tickH + 10, colW, tH, cTitle, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (cDesc) layers.push(txt(`${idp}_cd${i}`, z++, cx, rowTop + tickH + 10 + tH + 6, colW, dH, cDesc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      rowMax = Math.max(rowMax, cellH);
      col++;
      if (col >= cols || i === items.length - 1) { rowTop += rowMax + rowGap; rowMax = 0; col = 0; }
    });
    return { layers, height: Math.max(0, rowTop - y - rowGap) };
  }
  if (kind === 'callout' || kind === 'highlight' || kind === 'takeaway') {
    const t = shStr(b['text'] ?? b['body'] ?? b['value']);
    const label = shStr(b['label'] ?? b['title']);
    const pad = Math.round(W * 0.035), innerW = w - 2 * pad - 6;
    const lSize = Math.round(W * 0.016), tSize = Math.round(W * 0.026);
    const labH = label ? lSize + 12 : 0;
    const tH = estTextHeight(t, tSize, innerW, 1.45);
    const boxH = pad * 2 + labH + tH;
    layers.push({ id: `${idp}_box`, type: 'rect', z: z++, x, y, width: w, height: boxH, opacity: 0.12, fill: { type: 'solid', color: accent }, radius: 10 } as unknown as Layer);
    layers.push({ id: `${idp}_bar`, type: 'rect', z: z++, x, y, width: 6, height: boxH, fill: { type: 'solid', color: accent } } as unknown as Layer);
    if (label) layers.push(txt(`${idp}_cl`, z++, x + pad, y + pad, innerW, lSize + 6, label, { font_family: 'IBM Plex Mono', font_size: lSize, font_weight: 700, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    layers.push(txt(`${idp}_ct`, z++, x + pad, y + pad + labH, innerW, tH, t, { font_size: tSize, font_weight: 600, color: text, line_height: 1.45 }));
    return { layers, height: boxH };
  }
  if (kind === 'quote' || kind === 'pullquote') {
    const t = shStr(b['text'] ?? b['quote'] ?? b['content']).replace(/^["“”'']+|["“”'']+$/g, '');
    const cite = shStr(b['cite'] ?? b['author'] ?? b['source']);
    const qSize = Math.round(W * 0.036);
    const qH = estTextHeight(t, qSize, w, 1.3);
    layers.push(txt(`${idp}_q`, z++, x, y, w, qH, `“${t}”`, { font_size: qSize, font_weight: 500, font_style: 'italic', color: text, line_height: 1.3 }));
    let hh = qH;
    if (cite) { layers.push(txt(`${idp}_qc`, z++, x, y + qH + 12, w, 34, cite, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: accent, letter_spacing: 1, text_transform: 'uppercase' })); hh += 12 + 34; }
    return { layers, height: hh };
  }
  if (kind === 'bars' || kind === 'bar_chart' || kind === 'chart' || kind === 'ranking') {
    // Native rect bar chart — rasterizes in PNG (unlike foreignObject charts).
    const items = arrField('items', 'data', 'bars', 'values', 'rows', 'series').slice(0, 8);
    const num = (it: Record<string, unknown>): number => {
      const v = it['value'] ?? it['y'] ?? it['count'];
      return typeof v === 'number' ? v : (parseFloat(shStr(v).replace(/[^0-9.\-]/g, '')) || 0);
    };
    const vals = items.map(num);
    const max = Math.max(1, ...vals.map(Math.abs));
    const rowH = Math.round(W * 0.05), rowGap = Math.round(W * 0.02);
    const labelW = Math.round(w * 0.3), barTrack = w - labelW - Math.round(W * 0.1);
    const barH = Math.round(rowH * 0.62);
    items.forEach((it, i) => {
      const yy = y + i * (rowH + rowGap);
      const label = shStr(it['label'] ?? it['title'] ?? it['name'] ?? it['x']);
      const valDisp = shStr(it['value'] ?? it['y'] ?? it['count']);
      const bw = Math.max(4, Math.round(barTrack * (Math.abs(vals[i]) / max)));
      layers.push(txt(`${idp}_bl${i}`, z++, x, yy + Math.round((rowH - barH) / 2) - 2, labelW - 12, barH + 6, label, { font_size: Math.round(W * 0.019), font_weight: 600, color: text, line_height: 1.1 }));
      layers.push({ id: `${idp}_bt${i}`, type: 'rect', z: z++, x: x + labelW, y: yy, width: barTrack, height: barH, opacity: 0.14, fill: { type: 'solid', color: muted }, radius: 4 } as unknown as Layer);
      layers.push({ id: `${idp}_bb${i}`, type: 'rect', z: z++, x: x + labelW, y: yy, width: bw, height: barH, fill: { type: 'solid', color: accent }, radius: 4 } as unknown as Layer);
      if (valDisp) layers.push(txt(`${idp}_bv${i}`, z++, x + labelW + bw + 10, yy + Math.round((barH - Math.round(W * 0.02)) / 2), Math.round(W * 0.12), barH, valDisp, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.018), font_weight: 700, color: muted }));
    });
    return { layers, height: Math.max(0, items.length * (rowH + rowGap) - rowGap) };
  }
  // Native DONUT / PIE share-of-whole — arc paths + a legend with %. Rasterizes
  // (unlike a foreignObject vega chart, which exports BLANK). For a "breakdown /
  // split / composition / X% of the whole" — the share viz `bars` can't express.
  if (kind === 'donut' || kind === 'pie' || kind === 'ring_chart' || kind === 'breakdown' || kind === 'share' || kind === 'composition') {
    const items = arrField('items', 'rows', 'data', 'values', 'slices', 'segments', 'parts');
    if (!items.length) return { layers, height: 0 };
    const valOf = (it: Record<string, unknown>): number => {
      const v = it['value'] ?? it['y'] ?? it['count'] ?? it['percent'] ?? it['share'] ?? it['pct'];
      return typeof v === 'number' ? v : (parseFloat(shStr(v).replace(/[^0-9.\-]/g, '')) || 0);
    };
    const vals = items.map(valOf);
    const total = vals.reduce((a, b) => a + Math.abs(b), 0) || 1;
    const R = Math.round(W * 0.15), rIn = kind === 'pie' ? 0 : Math.round(W * 0.15 * 0.58);
    const cx = x + R, cy = y + R;
    const ramp = (ctx.palette && ctx.palette.length >= 2) ? ctx.palette : [accent, mixHex(accent, text, 0.4), mixHex(accent, muted, 0.55)];
    const sliceColor = (i: number): string => {
      const base = ramp[i % ramp.length] ?? accent;
      const tier = Math.floor(i / ramp.length);
      return tier === 0 ? base : mixHex(base, bg, Math.min(0.5, 0.22 * tier));
    };
    let a0 = -Math.PI / 2;
    items.forEach((_it, i) => {
      const a1 = a0 + (Math.abs(vals[i]) / total) * 2 * Math.PI;
      const la = (a1 - a0) > Math.PI ? 1 : 0;
      const pt = (rad: number, ang: number): string => `${(cx + rad * Math.cos(ang)).toFixed(1)} ${(cy + rad * Math.sin(ang)).toFixed(1)}`;
      const d = rIn > 0
        ? `M ${pt(R, a0)} A ${R} ${R} 0 ${la} 1 ${pt(R, a1)} L ${pt(rIn, a1)} A ${rIn} ${rIn} 0 ${la} 0 ${pt(rIn, a0)} Z`
        : `M ${cx} ${cy} L ${pt(R, a0)} A ${R} ${R} 0 ${la} 1 ${pt(R, a1)} Z`;
      layers.push({ id: `${idp}_arc${i}`, type: 'path', z: z++, x: cx - R, y: cy - R, width: 2 * R, height: 2 * R, d, fill: { type: 'solid', color: sliceColor(i) } } as unknown as Layer);
      a0 = a1;
    });
    const legendX = x + 2 * R + Math.round(W * 0.05);
    const legendW = Math.max(Math.round(W * 0.2), w - (legendX - x));
    const lh = Math.round(W * 0.044), sw = Math.round(W * 0.022), pctW = Math.round(W * 0.07);
    items.forEach((it, i) => {
      const ly = y + i * lh;
      const label = shStr(it['label'] ?? it['name'] ?? it['title'] ?? it['x'] ?? it['category']);
      const pct = Math.round((Math.abs(vals[i]) / total) * 100);
      layers.push({ id: `${idp}_sw${i}`, type: 'rect', z: z++, x: legendX, y: ly + 4, width: sw, height: sw, fill: { type: 'solid', color: sliceColor(i) }, radius: 3 } as unknown as Layer);
      layers.push(txt(`${idp}_ll${i}`, z++, legendX + sw + 12, ly, legendW - sw - pctW - 24, lh, label, { font_size: Math.round(W * 0.02), font_weight: 600, color: text, line_height: 1.15 }));
      layers.push(txt(`${idp}_lp${i}`, z++, legendX + legendW - pctW, ly, pctW, lh, `${pct}%`, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.021), font_weight: 700, color: accent, align: 'right' }));
    });
    return { layers, height: Math.max(2 * R, items.length * lh) };
  }
  // Native LINE / TREND — a polyline over labeled x points + a faint area fill +
  // dots + x-axis labels. Rasterizes (no foreignObject). For "growth/trend over time".
  if (kind === 'line' || kind === 'trend' || kind === 'area' || kind === 'timeseries' || kind === 'line_chart') {
    const items = arrField('items', 'rows', 'data', 'values', 'points', 'series');
    const valOf = (it: Record<string, unknown>): number => {
      const v = it['value'] ?? it['y'] ?? it['count'] ?? it['amount'];
      return typeof v === 'number' ? v : (parseFloat(shStr(v).replace(/[^0-9.\-]/g, '')) || 0);
    };
    const pts = items.map(it => ({ x: shStr(it['label'] ?? it['x'] ?? it['name'] ?? it['year']), y: valOf(it) }));
    if (pts.length >= 2) {
      const ys = pts.map(p => p.y), ymin = Math.min(...ys), ymax = Math.max(...ys), span = (ymax - ymin) || 1;
      const chartH = Math.round(W * 0.26), axisH = Math.round(W * 0.05), plotBot = y + chartH;
      const px = (i: number): number => x + (i / (pts.length - 1)) * w;
      const py = (v: number): number => plotBot - ((v - ymin) / span) * chartH;
      const lineD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${px(i).toFixed(1)} ${py(p.y).toFixed(1)}`).join(' ');
      layers.push({ id: `${idp}_area`, type: 'path', z: z++, x, y, width: w, height: chartH, d: `${lineD} L ${px(pts.length - 1).toFixed(1)} ${plotBot} L ${px(0).toFixed(1)} ${plotBot} Z`, fill: { type: 'solid', color: accent }, opacity: 0.12 } as unknown as Layer);
      layers.push({ id: `${idp}_line`, type: 'path', z: z++, x, y, width: w, height: chartH, d: lineD, stroke: { color: accent, width: Math.max(3, Math.round(W * 0.005)) } } as unknown as Layer);
      const dotR = Math.round(W * 0.009), labW = Math.round(W * 0.12);
      pts.forEach((p, i) => {
        layers.push({ id: `${idp}_dot${i}`, type: 'ellipse', z: z++, x: px(i) - dotR, y: py(p.y) - dotR, width: 2 * dotR, height: 2 * dotR, fill: { type: 'solid', color: accent } } as unknown as Layer);
        if (p.x) { const lx = Math.max(x, Math.min(px(i) - labW / 2, x + w - labW)); layers.push(txt(`${idp}_lx${i}`, z++, lx, plotBot + 8, labW, axisH, p.x, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 600, color: muted, align: 'center', line_height: 1.1 })); }
      });
      return { layers, height: chartH + axisH + 8 };
    }
  }
  // Side-by-side COMPARISON — two option headers + attribute rows (label, A value,
  // B value) split by a center divider, each row measured so nothing overprints.
  // A blind model asked for an "X vs Y" hand-places a colliding table; this owns it.
  if (kind === 'versus' || kind === 'comparison' || kind === 'compare' || kind === 'vs' || kind === 'head_to_head') {
    const rows = arrField('rows', 'items', 'attributes', 'features', 'criteria', 'dimensions', 'aspects');
    if (!rows.length) return { layers, height: 0 };
    const opts = Array.isArray(b['options']) ? (b['options'] as unknown[]).map(o => shStr(o)) : [];
    const aName = shStr(b['a_label'] ?? b['left_label'] ?? b['option_a'] ?? b['title_a'] ?? b['a']) || opts[0] || 'Option A';
    const bName = shStr(b['b_label'] ?? b['right_label'] ?? b['option_b'] ?? b['title_b'] ?? b['b']) || opts[1] || 'Option B';
    const gap = Math.round(W * 0.03), colW = Math.round((w - gap) / 2);
    const leftX = x, rightX = x + colW + gap, midX = x + Math.round(w / 2);
    const aOf = (rw: Record<string, unknown>): string => shStr(rw['a'] ?? rw['left'] ?? rw['option_a'] ?? rw['a_value'] ?? rw['value_a'] ?? rw['first']);
    const bOf = (rw: Record<string, unknown>): string => shStr(rw['b'] ?? rw['right'] ?? rw['option_b'] ?? rw['b_value'] ?? rw['value_b'] ?? rw['second']);
    const labelOf = (rw: Record<string, unknown>): string => shStr(rw['label'] ?? rw['attribute'] ?? rw['feature'] ?? rw['criterion'] ?? rw['aspect'] ?? rw['name'] ?? rw['title']);
    let yy = y;
    const hSize = Math.round(W * 0.03);
    const headH = Math.max(estTextHeight(aName, hSize, colW, 1.1), estTextHeight(bName, hSize, colW, 1.1));
    layers.push(txt(`${idp}_ha`, z++, leftX, yy, colW, headH, aName, { font_size: hSize, font_weight: 800, color: accent, align: 'center', line_height: 1.1 }));
    layers.push(txt(`${idp}_hb`, z++, rightX, yy, colW, headH, bName, { font_size: hSize, font_weight: 800, color: text, align: 'center', line_height: 1.1 }));
    yy += headH + Math.round(W * 0.022);
    const rowsTop = yy;
    const lSize = Math.round(W * 0.017), vSize = Math.round(W * 0.022);
    rows.forEach((rw, i) => {
      const label = labelOf(rw), av = aOf(rw), bv = bOf(rw);
      const lH = label ? estTextHeight(label, lSize, w, 1.1) : 0;
      const vH = Math.max(estTextHeight(av || ' ', vSize, colW - 24, 1.3), estTextHeight(bv || ' ', vSize, colW - 24, 1.3));
      if (i > 0) layers.push({ id: `${idp}_sep${i}`, type: 'rect', z: z++, x, y: yy - Math.round(W * 0.013), width: w, height: 1, opacity: 0.22, fill: { type: 'solid', color: muted } } as unknown as Layer);
      if (label) layers.push(txt(`${idp}_rl${i}`, z++, x, yy, w, lH, label.toUpperCase(), { font_family: 'IBM Plex Mono', font_size: lSize, font_weight: 700, color: muted, letter_spacing: 1, align: 'center', line_height: 1.1 }));
      const vy = yy + (label ? lH + 6 : 0);
      layers.push(txt(`${idp}_ra${i}`, z++, leftX, vy, colW, vH, av, { font_size: vSize, font_weight: 600, color: text, align: 'center', line_height: 1.3 }));
      layers.push(txt(`${idp}_rb${i}`, z++, rightX, vy, colW, vH, bv, { font_size: vSize, font_weight: 600, color: text, align: 'center', line_height: 1.3 }));
      yy += lH + (label ? 6 : 0) + vH + Math.round(W * 0.026);
    });
    layers.push({ id: `${idp}_div`, type: 'rect', z: z0, x: midX - 1, y: rowsTop, width: 2, height: Math.max(0, yy - rowsTop - Math.round(W * 0.026)), opacity: 0.3, fill: { type: 'solid', color: accent } } as unknown as Layer);
    return { layers, height: Math.max(0, yy - y - Math.round(W * 0.026)) };
  }
  // TIMELINE / milestones — a left date column + a rail of node dots + event
  // title/desc to the right, each row measured. Rasterizes. For history / roadmap /
  // "the journey of X". Like flow but date-anchored (the date is the emphasis).
  if (kind === 'timeline' || kind === 'milestones' || kind === 'history' || kind === 'roadmap' || kind === 'chronology') {
    const items = arrField('items', 'milestones', 'events', 'entries', 'rows', 'points', 'stages', 'phases');
    if (!items.length) return { layers, height: 0 };
    const dateColW = Math.round(W * 0.15);
    const railX = x + dateColW + Math.round(W * 0.025);
    const nodeR = Math.round(W * 0.013);
    const textX = railX + Math.round(W * 0.04);
    const textW = w - (textX - x);
    const tSize = Math.round(W * 0.027), dSize = Math.round(W * 0.02), dateSize = Math.round(W * 0.024);
    const gap = Math.round(W * 0.032);
    const rows = items.map(it => {
      const date = shStr(it['date'] ?? it['year'] ?? it['time'] ?? it['when'] ?? it['label'] ?? it['phase']);
      const title = shStr(it['title'] ?? it['event'] ?? it['name'] ?? it['heading'] ?? it['milestone']);
      const desc = shStr(it['desc'] ?? it['text'] ?? it['description'] ?? it['detail'] ?? it['body']);
      const tH = estTextHeight(title || ' ', tSize, textW, 1.15);
      const dH = desc ? estTextHeight(desc, dSize, textW, 1.4) : 0;
      const rowH = Math.max(2 * nodeR, tH + (desc ? 6 + dH : 0));
      return { date, title, desc, tH, dH, rowH };
    });
    let yy = y;
    rows.forEach((row, i) => {
      const nodeCY = yy + Math.round(tSize * 0.55);
      if (i < rows.length - 1) {
        const nextCY = yy + row.rowH + gap + Math.round(tSize * 0.55);
        layers.push({ id: `${idp}_rail${i}`, type: 'rect', z: z++, x: railX - 2, y: nodeCY, width: 4, height: Math.max(0, nextCY - nodeCY), opacity: 0.32, fill: { type: 'solid', color: accent } } as unknown as Layer);
      }
      if (row.date) layers.push(txt(`${idp}_dt${i}`, z++, x, nodeCY - Math.round(dateSize * 0.62), dateColW, Math.round(dateSize * 1.4), row.date, { font_family: 'IBM Plex Mono', font_size: dateSize, font_weight: 800, color: accent, align: 'right', line_height: 1.0 }));
      layers.push({ id: `${idp}_node${i}`, type: 'ellipse', z: z++, x: railX - nodeR, y: nodeCY - nodeR, width: 2 * nodeR, height: 2 * nodeR, fill: { type: 'solid', color: accent } } as unknown as Layer);
      layers.push(txt(`${idp}_tt${i}`, z++, textX, yy, textW, row.tH, row.title, { font_size: tSize, font_weight: 700, color: text, line_height: 1.15 }));
      if (row.desc) layers.push(txt(`${idp}_td${i}`, z++, textX, yy + row.tH + 6, textW, row.dH, row.desc, { font_size: dSize, font_weight: 400, color: muted, line_height: 1.4 }));
      yy += row.rowH + gap;
    });
    return { layers, height: Math.max(0, yy - y - gap) };
  }
  // PRICING / plans — N tier columns (name + big price + feature list), one tier
  // optionally highlighted (accent fill + POPULAR chip), all cards the same height.
  // Rasterizes. A blind model asked for pricing hand-places colliding columns; this
  // owns the grid. Features live on each tier item.
  if (kind === 'pricing' || kind === 'plans' || kind === 'tiers' || kind === 'price_table') {
    const tiersRaw = arrField('items', 'tiers', 'plans', 'options', 'rows', 'data', 'cards');
    if (!tiersRaw.length) return { layers, height: 0 };
    const list = tiersRaw.slice(0, 4);
    const n = list.length;
    const gap = Math.round(W * 0.025), colW = Math.round((w - (n - 1) * gap) / n), pad = Math.round(W * 0.022);
    const innerW = colW - 2 * pad;
    const nameSize = Math.round(W * 0.017), priceSize = Math.round(W * 0.046), perSize = Math.round(W * 0.016), featSize = Math.round(W * 0.0175);
    const td = list.map(t => {
      const name = shStr(t['name'] ?? t['title'] ?? t['tier'] ?? t['plan'] ?? t['label']);
      const price = shStr(t['price'] ?? t['cost'] ?? t['amount'] ?? t['value']);
      const period = shStr(t['period'] ?? t['unit'] ?? t['per'] ?? t['interval'] ?? t['cadence']);
      const fRaw = (Array.isArray(t['features']) ? t['features'] : Array.isArray(t['items']) ? t['items'] : Array.isArray(t['perks']) ? t['perks'] : Array.isArray(t['includes']) ? t['includes'] : []) as unknown[];
      const feats = fRaw.map(f => shStr(typeof f === 'object' && f ? ((f as Record<string, unknown>)['text'] ?? (f as Record<string, unknown>)['label'] ?? (f as Record<string, unknown>)['name']) : f)).filter(Boolean);
      const highlight = !!(t['highlight'] ?? t['featured'] ?? t['popular'] ?? t['recommended'] ?? t['best']);
      const featHs = feats.map(f => estTextHeight(f, featSize, innerW - 18, 1.3));
      const contentH = pad + (name ? nameSize + 14 : 0) + priceSize * 1.15 + (period ? perSize + 6 : 0) + 18 + featHs.reduce((a, b) => a + b + 11, 0) + pad;
      return { name, price, period, feats, featHs, highlight, contentH };
    });
    const cardH = Math.max(...td.map(t => t.contentH));
    list.forEach((_t, i) => {
      const t = td[i], cx = x + i * (colW + gap), hl = t.highlight;
      const cardText = hl ? readableOn(accent, bg) : text, cardMuted = hl ? readableOn(accent, bg) : muted;
      layers.push({ id: `${idp}_card${i}`, type: 'rect', z: z++, x: cx, y, width: colW, height: cardH, radius: 14, fill: { type: 'solid', color: hl ? accent : mixHex(bg, text, 0.06) }, ...(hl ? {} : { stroke: { color: mixHex(bg, text, 0.16), width: 1.5 } }) } as unknown as Layer);
      let cy = y + pad;
      if (t.name) { layers.push(txt(`${idp}_pn${i}`, z++, cx + pad, cy, innerW, nameSize + 6, t.name.toUpperCase(), { font_family: 'IBM Plex Mono', font_size: nameSize, font_weight: 700, color: hl ? cardText : accent, letter_spacing: 1.5 })); cy += nameSize + 14; }
      layers.push(txt(`${idp}_pp${i}`, z++, cx + pad, cy, innerW, priceSize * 1.15, t.price, { font_size: priceSize, font_weight: 800, color: cardText, line_height: 1.1 })); cy += priceSize * 1.15;
      if (t.period) { layers.push(txt(`${idp}_pper${i}`, z++, cx + pad, cy, innerW, perSize + 6, t.period, { font_size: perSize, font_weight: 500, color: cardMuted })); cy += perSize + 6; }
      cy += 18;
      t.feats.forEach((f, j) => {
        layers.push({ id: `${idp}_pdot${i}_${j}`, type: 'ellipse', z: z++, x: cx + pad, y: cy + 5, width: 7, height: 7, fill: { type: 'solid', color: hl ? cardText : accent } } as unknown as Layer);
        layers.push(txt(`${idp}_pf${i}_${j}`, z++, cx + pad + 16, cy, innerW - 18, t.featHs[j], f, { font_size: featSize, font_weight: 500, color: cardMuted, line_height: 1.3 }));
        cy += t.featHs[j] + 11;
      });
    });
    return { layers, height: cardH };
  }
  if (kind === 'caption' || kind === 'source' || kind === 'note' || kind === 'footnote' || kind === 'label') {
    // Small mono source/caption line (blind models pass the footer source as a
    // block like {kind:source}; render its text — never silently drop it).
    const t = shStr(b['text'] ?? b['body'] ?? b['value'] ?? b['content'] ?? b['source'] ?? b['label']);
    if (!t) return { layers, height: 0 };
    const size = Math.round(W * 0.016);
    const th = estTextHeight(t, size, w, 1.3);
    layers.push(txt(`${idp}_cap`, z++, x, y, w, th, t, { font_family: 'IBM Plex Mono', font_size: size, font_weight: 500, color: muted, letter_spacing: 0.5 }));
    return { layers, height: th };
  }
  if (kind === 'divider' || kind === 'rule' || kind === 'hr' || kind === 'separator') {
    layers.push({ id: `${idp}_div`, type: 'rect', z: z++, x, y: y + Math.round(W * 0.01), width: w, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    return { layers, height: Math.round(W * 0.02) };
  }
  // Unknown kind that still carries text → render as body text rather than
  // dropping it to a blank rule (a blind model can't see the text vanish).
  const fallText = shStr(b['text'] ?? b['body'] ?? b['value'] ?? b['content'] ?? b['title'] ?? b['heading']);
  if (fallText) {
    const size = Math.round(W * 0.0225);
    const th = estTextHeight(fallText, size, w, 1.5);
    layers.push(txt(`${idp}_t`, z++, x, y, w, th, fallText, { font_size: size, font_weight: 400, color: muted, line_height: 1.5 }));
    return { layers, height: th };
  }
  // Truly empty block → a thin rule.
  layers.push({ id: `${idp}_div`, type: 'rect', z: z++, x, y: y + Math.round(W * 0.01), width: w, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
  return { layers, height: Math.round(W * 0.02) };
}

// Weak models often emit ONE singular `{type:"stat", value, label}` block per
// figure instead of a single `{type:"stats", items:[…]}` row — the singular
// blocks then hit the unknown-kind fallback, which renders the value but DROPS
// the label (the g_oceans "8M / 91% / 30%" with no captions case). Fold any run
// of consecutive singular stat blocks into stats rows of up to 4 so they render
// as a proper figure row WITH labels. A no-op when no singular stats appear, so
// well-formed designs are untouched (same mood seed, same layout).
function coalesceStatBlocks(blocks: Record<string, unknown>[]): Record<string, unknown>[] {
  const SINGULAR = new Set(['stat', 'metric', 'big_number', 'figure', 'kpi', 'number']);
  const out: Record<string, unknown>[] = [];
  let run: Record<string, unknown>[] = [];
  const flush = (): void => {
    for (let i = 0; i < run.length; i += 4) {
      out.push({ type: 'stats', items: run.slice(i, i + 4).map(b => ({
        value: b['value'] ?? b['stat'] ?? b['number'] ?? b['figure'] ?? b['title'],
        label: b['label'] ?? b['desc'] ?? b['text'] ?? b['caption'] ?? b['name'],
      })) });
    }
    run = [];
  };
  for (const b of blocks) {
    const k = shStr(b['kind'] ?? b['type']).toLowerCase();
    if (SINGULAR.has(k) && !Array.isArray(b['items'])) run.push(b);
    else { flush(); out.push(b); }
  }
  flush();
  return out;
}

function buildSections(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H: boxH } = shBox(sh, 1080, 1920);
  // On a fixed carousel slide the page-fill stamps `__fillPage` + the page box:
  // FILL that height (bg spans the whole page, no unpainted strip) and vertically
  // CENTER the content (no top-heavy dead band). A poster keeps content-sizing.
  const fillPage = r['__fillPage'] === true && boxH > 0;
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline']);
  const subtitle = shStr(r['subtitle'] ?? r['deck'] ?? r['intro']);
  const footer = shStr(r['footer']);
  // Weak models sometimes DOUBLE-NEST blocks — `blocks:[[{block}],[{block}]]`,
  // each wrapped in its own array — which the renderer reads as an array-typed
  // "block" with no kind → every block renders empty (a near-blank poster).
  // Flatten one level so a nested block is treated as a normal block.
  const rawBlocks = (Array.isArray(r['blocks']) ? r['blocks'] : Array.isArray(r['sections']) ? r['sections'] : []) as unknown[];
  const flatBlocks = rawBlocks.flatMap(b => (Array.isArray(b) ? b : [b])) as Record<string, unknown>[];
  const blocks = coalesceStatBlocks(flatBlocks);
  // No bg from the model → seed a topic-apt mood from the content (the blind-
  // model "same template" fix), else everything falls to one cream default.
  const m = seededDefaults(r, [title, subtitle, kicker, blocks]);
  const bg = shStr(r['bg'], m?.bg ?? '#FAF5EC');
  const accent = shStr(r['accent'], m?.accent ?? '#B8543C');
  const { text, muted } = readablePair(bg, r['text_color'] ?? r['color'] ?? m?.text_color, r['muted']);
  const bgStyle = shStr(r['bg_style'] ?? r['background_style'] ?? r['bg_treatment'], m?.bg_style ?? '');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter(c => typeof c === 'string') as string[];
  const ctx: SecCtx = { accent, text, muted, bg, W, palette };

  const M = Math.round(W * 0.075), cX = X + M, cW = W - 2 * M;

  // ── Typographic treatment — the per-style TITLE personality on top of the
  // color/geometry/font: 'highlight' (knockout marker chip), 'underline' (accent
  // swipe), 'mega' (oversized uppercase), 'rotate' (vertical magazine-spine
  // kicker), 'rule' (accent rule). Seeded from the mood so a vision-less model
  // gets a distinct type voice for free; an explicit field still overrides.
  const headlineStyle = shStr(r['headline_style'] ?? r['type_treatment'] ?? r['headline'], m?.headline ?? 'rule');
  const titleFont = shStr(r['font'] ?? r['font_family'], m?.font ?? '') || undefined;
  const mega = headlineStyle === 'mega';
  const rotateKick = headlineStyle === 'rotate' && !!kicker;
  // STRUCTURAL variant (decorrelated from colour): a centered keynote header vs
  // the left editorial default, and a 4-across vs 2-col stat grid — so two decks
  // in the same colour mood don't share a SHAPE (the "all designs are the same"
  // fix). A left-spine rotate layout is inherently left, so it opts out of center.
  const lay = pickSecLayout([title, subtitle, kicker].filter(Boolean).join(' ') || 'folio');
  const alignField = shStr(r['align'] ?? r['text_align']);
  const centered = !rotateKick && (alignField === 'center' || (alignField !== 'left' && lay.align === 'center'));
  ctx.align = centered ? 'center' : 'left';
  ctx.statCols = lay.statCols;
  const halign = centered ? { align: 'center' } : {};
  // MASTHEAD BAND archetype — a full-bleed colour slab behind the header with
  // reversed-out type (a magazine/report-cover silhouette). The single biggest
  // "this isn't the same template" cue: it restyles the whole top third without
  // touching the palette. INK slab = strong contrast to the canvas; ACCENT slab =
  // the accent itself. Header colours flip so they stay legible on the slab; the
  // highlight/underline/rule moments are suppressed (the band IS the treatment).
  const bgIsDark = ((): boolean => { const r = hexToRgb(asHex(bg) ?? '#FAF5EC'); return r ? luminance(r) < 0.45 : false; })();
  // The masthead band needs a header to reverse out — a model that passed only
  // blocks (no kicker/title/subtitle) would otherwise get an empty coloured stripe.
  const hasHeader = !!kicker || !!title || !!subtitle;
  const band = lay.header === 'band' && !rotateKick && hasHeader;
  const bandBg = band ? (lay.bandTone === 'ink' ? (bgIsDark ? '#F4F1EA' : '#17161B') : mixHex(accent, '#101012', 0.12)) : '';
  const bandText = band ? readableOn(bandBg, bg) : text;
  const kickColor = band ? (lay.bandTone === 'ink' ? accent : bandText) : accent;
  const titleColor = band ? bandText : text;
  const subColor = band ? mixHex(bandBg, bandText, 0.62) : muted;
  const tLH = 1.04;
  const gutter = rotateKick ? Math.round(W * 0.085) : 0;       // left clearance for the vertical spine
  const ccX = cX + gutter, ccW = cW - gutter;                  // content column (indented when a spine is present)
  const tsBase = mega ? Math.round(W * 0.094) : Math.round(W * 0.072);
  const ts = title ? fitTitleSize(title, tsBase, ccW, titleFont, mega) : tsBase;  // shrink so the longest word fits

  // Drop leading/trailing dividers (a rule at the very top/bottom is pointless
  // dead space — a common blind-model habit). Trim BEFORE measuring.
  const isDiv = (b: Record<string, unknown>): boolean => { const ki = shStr(b['kind'] ?? b['type']); return ki === 'divider' || ki === 'rule'; };
  const bl = blocks.slice();
  while (bl.length && isDiv(bl[0])) bl.shift();
  while (bl.length && isDiv(bl[bl.length - 1])) bl.pop();
  const heights = bl.map((b, i) => renderSectionBlock(b, `${id}_b${i}`, z, ccX, 0, ccW, ctx).height);
  const sumH = heights.reduce((a, h) => a + h, 0);
  const n = Math.max(1, bl.length);

  // ── Fit pass — size the CANVAS to the content, not the content to a fixed
  // canvas. Short content shrinks the page (no dead band below the last block);
  // long content grows it (no clipping past the bottom). Measure the header +
  // blocks first, then compose the background at this fitted height so the baked
  // sweep geometry (triangles, diagonals, waves) matches the page exactly.
  let hY = Math.round(W * 0.08);
  if (kicker && !rotateKick) hY += Math.round(headlineStyle === 'highlight' ? W * 0.052 : W * 0.045);
  if (title) hY += estTextHeight(title, ts, ccW, tLH, mega ? 0.66 : 0.54) + Math.round(W * 0.02) + (headlineStyle === 'underline' ? Math.round(W * 0.018) : 0);
  if (subtitle) hY += estTextHeight(subtitle, Math.round(W * 0.028), ccW, 1.45) + Math.round(W * 0.025);
  if (kicker || title || subtitle) hY += Math.round(W * 0.05);
  const footerBand = footer ? Math.round(W * 0.1) : Math.round(W * 0.06);
  const naturalH = hY + sumH + Math.round(W * 0.032) * Math.max(0, n - 1) + footerBand + Math.round(W * 0.04);
  // A page-fill slide is EXACTLY the page height (bg spans it → no strip); a
  // poster sizes to content. When the page is taller than the content, center the
  // whole composition (topPad) — unless a masthead band is present, which is a
  // top-anchored cover archetype whose slab is drawn at the page top.
  const H = fillPage ? boxH : Math.max(Math.round(W * 0.9), Math.min(Math.round(W * 3.4), naturalH));
  // Vertically center the whole composition whenever the canvas is taller than the
  // content — a fixed fill page (carousel) OR a thin POSTER floored at W*0.9 (a
  // single stat + caption that used to sit top-anchored with a dead band below).
  // The masthead slab is shifted by the same offset (below) so the band stays
  // aligned with its reversed-out header text. Dense content (H==naturalH) → 0.
  const topPad = H > naturalH ? Math.round((H - naturalH) * 0.42) : 0;

  // Rich engine-composed background when bg_style is set, else a flat wash.
  const layers: Layer[] = composeBackground(bgStyle || defaultBgStyle(bg), id, X, Y, W, H, { bg, accent, text, palette, image: shStr(r['bg_image'] ?? r['photo'] ?? r['bg_photo']) }, 0);
  // Lay the masthead slab over the composed wash, under the header text.
  if (band) layers.push({ id: `${id}_mband`, type: 'rect', z: layers.length, x: X, y: Y + topPad, width: W, height: Math.round(hY), fill: { type: 'solid', color: bandBg } } as unknown as Layer);
  let k = layers.length, cy = Y + Math.round(W * 0.08) + topPad;

  // Vertical magazine-spine kicker (rotate): a -90° label pinned at the left
  // edge; the content column is already indented (gutter) to clear it. Built as a
  // raw layer because rotation is a LAYER prop, not a text-style field.
  if (rotateKick) {
    const kSize = Math.round(W * 0.019), kbw = Math.round(W * 0.34), kbh = Math.round(kSize * 1.8);
    const cxp = X + Math.round(W * 0.04), cyp = cy + Math.round(W * 0.18);
    layers.push({ id: `${id}_kick`, type: 'text', z: z + k++, x: Math.round(cxp - kbw / 2), y: Math.round(cyp - kbh / 2), width: kbw, height: kbh, rotation: -90,
      content: { type: 'plain', value: kicker }, style: { font_family: 'IBM Plex Mono', font_size: kSize, font_weight: 700, color: accent, letter_spacing: 3, text_transform: 'uppercase', align: 'center' } } as unknown as Layer);
  } else if (kicker && headlineStyle === 'highlight' && !band) {
    // Knockout marker chip — accent band, text in the canvas color.
    layers.push(txt(`${id}_kick`, z + k++, ccX, cy, ccW, 42, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 700, color: readableOn(accent, bg), letter_spacing: 2, text_transform: 'uppercase', highlight: accent, ...halign }));
    cy += Math.round(W * 0.052);
  } else if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, ccX, cy, ccW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: kickColor, letter_spacing: 2, text_transform: 'uppercase', ...halign }));
    cy += Math.round(W * 0.045);
  }
  if (title) {
    // Mega is uppercase and often falls back to a wider raster font than the
    // measured display font, so it wraps to MORE lines than the 0.54 estimate
    // predicts → the subtitle collided into it. Reserve with a wider factor.
    const th = estTextHeight(title, ts, ccW, tLH, mega ? 0.66 : 0.54);
    // highlight with no kicker → put the marker band on the TITLE itself (a
    // knockout headline) so the treatment is never dormant on a kicker-less deck.
    const titleHi = headlineStyle === 'highlight' && !kicker && !band;
    const titleStyle: Record<string, unknown> = { font_size: ts, font_weight: 800, color: titleHi ? readableOn(accent, bg) : titleColor, line_height: tLH, letter_spacing: mega ? -2 : -1, font_family: titleFont, ...halign };
    if (mega) titleStyle['text_transform'] = 'uppercase';
    if (titleHi) titleStyle['highlight'] = accent;
    layers.push(txt(`${id}_title`, z + k++, ccX, cy, ccW, th, title, titleStyle));
    cy += th + Math.round(W * 0.02);
    // Underline swipe — a thick accent bar directly beneath the title (centered
    // under a centered headline, else left-anchored).
    if (headlineStyle === 'underline' && !band) {
      const ulw = Math.min(ccW, Math.round(W * 0.32)), ulh = Math.max(7, Math.round(W * 0.013));
      const ulx = centered ? ccX + Math.round((ccW - ulw) / 2) : ccX;
      layers.push({ id: `${id}_ul`, type: 'rect', z: z + k++, x: ulx, y: Math.round(cy - W * 0.01), width: ulw, height: ulh, fill: { type: 'solid', color: accent } } as unknown as Layer);
      cy += Math.round(W * 0.012);
    }
  }
  if (subtitle) {
    const ss = Math.round(W * 0.028), sh2 = estTextHeight(subtitle, ss, ccW, 1.45);
    layers.push(txt(`${id}_sub`, z + k++, ccX, cy, ccW, sh2, subtitle, { font_size: ss, font_weight: 400, color: subColor, line_height: 1.45, ...halign }));
    cy += sh2 + Math.round(W * 0.025);
  }
  // A header rule belongs to the plain/mega/rotate treatments; highlight +
  // underline already carry their own accent moment, so a rule is redundant. The
  // masthead band already frames the header, so it suppresses the rule too.
  if ((kicker || title || subtitle) && !band && (headlineStyle === 'rule' || mega || headlineStyle === 'rotate')) {
    if (centered) {
      // A single short accent rule centered under the keynote header.
      const crw = Math.round(W * 0.16);
      layers.push({ id: `${id}_hr`, type: 'rect', z: z + k++, x: ccX + Math.round((ccW - crw) / 2), y: Math.round(cy), width: crw, height: mega ? 6 : 5, fill: { type: 'solid', color: accent } } as unknown as Layer);
    } else {
      layers.push({ id: `${id}_hr`, type: 'rect', z: z + k++, x: ccX, y: Math.round(cy), width: ccW, height: mega ? 4 : 3, fill: { type: 'solid', color: text } } as unknown as Layer);
      layers.push({ id: `${id}_htick`, type: 'rect', z: z + k++, x: ccX, y: Math.round(cy) - 2, width: Math.round(W * 0.13), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
    }
    cy += Math.round(W * 0.05);
  } else if (kicker || title || subtitle) {
    cy += Math.round(W * 0.03);
  }

  // The masthead band reserves the header zone (height hY). A band-mode header is
  // a touch shorter than that estimate (the rule is suppressed), so push the first
  // block clear of the band's bottom edge rather than letting its top tuck under it.
  if (band) cy = Math.max(cy, Y + topPad + Math.round(hY) + Math.round(W * 0.05));
  // Place blocks: distribute only the SMALL leftover slack in the fitted canvas
  // (floor keeps dense content tight, cap keeps a slightly-roomy page balanced).
  const footerH = footer ? Math.round(W * 0.1) : Math.round(W * 0.03);
  const avail = (Y + H - M - footerH) - cy;
  // When the composition is centered (topPad > 0, i.e. the canvas has slack), use
  // the NATURAL inter-block gap — matching the gap naturalH assumed — so the
  // centered block keeps its true height. A content-tight page (no slack) keeps
  // the original distribute-the-remainder behavior.
  const gap = topPad > 0
    ? Math.round(W * 0.032)
    : Math.max(Math.round(W * 0.024), Math.min(Math.round(W * 0.06), (avail - sumH) / n));
  bl.forEach((b, i) => {
    const out = renderSectionBlock(b, `${id}_b${i}`, z + k, ccX, cy, ccW, ctx);
    out.layers.forEach(l => layers.push(l));
    k += out.layers.length + 1;
    cy += heights[i] + gap;
  });

  if (footer) {
    const fy = Y + H - Math.round(W * 0.05);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: ccX, y: fy - 16, width: ccW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(txt(`${id}_footer`, z + k++, ccX, fy, ccW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// ── Main expansion function ─────────────────────────────────
// ── Decorative MOTIFS ─────────────────────────────────────────
// Composed, multi-primitive vector illustrations that fill the negative space a
// blind model leaves (big empty columns). Each draws into a box from rect/ellipse/
// path/line ONLY (rasterizes in PNG/PDF) using one accent color at varied OPACITY
// for depth — no color interpolation, so it is token-safe ($accent passes through
// to the resolver untouched). Returns absolute-coord layers; the caller wraps them
// in a group. Math.sin/cos only (deterministic — no Math.random/Date in render).
const MOTIF_NAMES = new Set([
  'bolt', 'lightning', 'arcs', 'waves', 'orbit', 'rings', 'rays', 'sunburst',
  'grid', 'dots', 'peaks', 'mountains', 'circuit',
]);

function motifLayers(name: string, box: ShapeBox, accent: string, idp: string, z0: number): Layer[] {
  const { x, y, w, h } = box;
  const a = accent;
  const layers: Layer[] = [];
  let z = z0;
  const R = (n: number): number => Math.round(n);
  const cx = x + w / 2, cy = y + h / 2;
  const poly = (pts: number[][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${R(p[0])} ${R(p[1])}`).join(' ');
  const op = (v: number): number => +v.toFixed(2);
  const key = MOTIF_NAMES.has(name) ? name : 'arcs';

  switch (key) {
    case 'bolt':
    case 'lightning': {
      const gw = w * 0.78, gh = h * 0.6;
      layers.push({ id: `${idp}_glow`, type: 'ellipse', z: z++, x: R(cx - gw / 2), y: R(cy - gh / 2), width: R(gw), height: R(gh), fill: { type: 'solid', color: a }, opacity: 0.1 } as unknown as Layer);
      const bx = x + w * 0.5;
      const bolt = poly([
        [bx + w * 0.10, y + h * 0.03], [bx - w * 0.14, y + h * 0.46], [bx + w * 0.02, y + h * 0.46],
        [bx - w * 0.20, y + h * 0.97], [bx + w * 0.16, y + h * 0.42], [bx - w * 0.01, y + h * 0.42],
      ]) + ' Z';
      layers.push({ id: `${idp}_bolt`, type: 'path', z: z++, x, y, width: w, height: h, d: bolt, fill: { type: 'solid', color: a }, opacity: 0.92 } as unknown as Layer);
      const fork = poly([[bx + w * 0.02, y + h * 0.46], [bx + w * 0.24, y + h * 0.64]]);
      layers.push({ id: `${idp}_fork`, type: 'path', z: z++, x, y, width: w, height: h, d: fork, stroke: { color: a, width: Math.max(3, R(w * 0.02)) }, opacity: 0.65 } as unknown as Layer);
      break;
    }
    case 'arcs': {
      const n = 5, max = Math.min(w, h) * 0.98, ox = x + w, oy = y + h * 0.08;
      for (let i = 0; i < n; i++) {
        const r = max * (0.26 + 0.74 * (i / (n - 1)));
        const d = `M${R(ox - r)} ${R(oy)} A ${R(r)} ${R(r)} 0 0 1 ${R(ox)} ${R(oy + r)}`;
        layers.push({ id: `${idp}_arc${i}`, type: 'path', z: z++, x, y, width: w, height: h, d, stroke: { color: a, width: Math.max(2, R(w * 0.012)) }, opacity: op(0.22 + 0.58 * (i / (n - 1))) } as unknown as Layer);
      }
      break;
    }
    case 'waves': {
      const n = 5, amp = h * 0.055, step = h / (n + 1), seg = 18;
      for (let i = 0; i < n; i++) {
        const baseY = y + step * (i + 1), pts: number[][] = [];
        for (let s = 0; s <= seg; s++) pts.push([x + (w * s) / seg, baseY + Math.sin((s / seg) * Math.PI * 3 + i * 0.6) * amp]);
        layers.push({ id: `${idp}_wave${i}`, type: 'path', z: z++, x, y, width: w, height: h, d: poly(pts), stroke: { color: a, width: Math.max(2, R(w * 0.01)) }, opacity: op(0.3 + 0.5 * (i / (n - 1))) } as unknown as Layer);
      }
      break;
    }
    case 'orbit':
    case 'rings': {
      const n = 3, max = Math.min(w, h) * 0.92;
      for (let i = 0; i < n; i++) {
        const r = (max * (0.42 + 0.58 * (i / (n - 1)))) / 2;
        layers.push({ id: `${idp}_ring${i}`, type: 'ellipse', z: z++, x: R(cx - r), y: R(cy - r), width: R(r * 2), height: R(r * 2), stroke: { color: a, width: Math.max(2, R(w * 0.01)) }, opacity: op(0.3 + 0.35 * (i / (n - 1))) } as unknown as Layer);
        const ang = -0.6 + i * 1.7, nx = cx + Math.cos(ang) * r, ny = cy + Math.sin(ang) * r, ds = Math.max(6, w * 0.035);
        layers.push({ id: `${idp}_node${i}`, type: 'ellipse', z: z++, x: R(nx - ds / 2), y: R(ny - ds / 2), width: R(ds), height: R(ds), fill: { type: 'solid', color: a }, opacity: 0.9 } as unknown as Layer);
      }
      const cs = Math.max(8, w * 0.05);
      layers.push({ id: `${idp}_core`, type: 'ellipse', z: z++, x: R(cx - cs / 2), y: R(cy - cs / 2), width: R(cs), height: R(cs), fill: { type: 'solid', color: a }, opacity: 1 } as unknown as Layer);
      break;
    }
    case 'rays':
    case 'sunburst': {
      const n = 12, rad = Math.min(w, h) * 0.52, cs = Math.max(8, w * 0.06);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        layers.push({ id: `${idp}_ray${i}`, type: 'path', z: z++, x, y, width: w, height: h, d: poly([[cx, cy], [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]]), stroke: { color: a, width: Math.max(2, R(w * 0.012)) }, opacity: op(i % 2 ? 0.35 : 0.7) } as unknown as Layer);
      }
      layers.push({ id: `${idp}_hub`, type: 'ellipse', z: z++, x: R(cx - cs / 2), y: R(cy - cs / 2), width: R(cs), height: R(cs), fill: { type: 'solid', color: a }, opacity: 1 } as unknown as Layer);
      break;
    }
    case 'grid':
    case 'dots': {
      const cols = 6, rows = Math.min(14, Math.max(3, Math.round((6 * h) / w)));
      const ds = Math.max(4, Math.min(w / cols, h / rows) * 0.26);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const px = x + ((c + 0.5) / cols) * w, py = y + ((r + 0.5) / rows) * h;
        layers.push({ id: `${idp}_dot${r}_${c}`, type: 'ellipse', z: z++, x: R(px - ds / 2), y: R(py - ds / 2), width: R(ds), height: R(ds), fill: { type: 'solid', color: a }, opacity: op(0.2 + 0.6 * (c / (cols - 1))) } as unknown as Layer);
      }
      break;
    }
    case 'peaks':
    case 'mountains': {
      const ranges = 3;
      for (let i = 0; i < ranges; i++) {
        const baseY = y + h * (0.55 + 0.15 * i), peakY = y + h * (0.2 + 0.18 * i), midX = x + w * (0.3 + 0.2 * i);
        const d = poly([[x, baseY], [midX, peakY], [x + w, baseY], [x + w, y + h], [x, y + h]]) + ' Z';
        layers.push({ id: `${idp}_peak${i}`, type: 'path', z: z++, x, y, width: w, height: h, d, fill: { type: 'solid', color: a }, opacity: op(0.18 + 0.22 * i) } as unknown as Layer);
      }
      break;
    }
    case 'circuit': {
      const lines = 5;
      for (let i = 0; i < lines; i++) {
        const sy = y + h * ((i + 0.5) / lines), midX = x + w * (0.35 + 0.12 * (i % 3)), turnY = sy + (i % 2 ? -h * 0.08 : h * 0.08);
        layers.push({ id: `${idp}_trace${i}`, type: 'path', z: z++, x, y, width: w, height: h, d: poly([[x, sy], [midX, sy], [midX, turnY], [x + w, turnY]]), stroke: { color: a, width: Math.max(2, R(w * 0.01)) }, opacity: op(0.3 + 0.4 * (i / (lines - 1))) } as unknown as Layer);
        const ds = Math.max(6, w * 0.03);
        layers.push({ id: `${idp}_jn${i}`, type: 'ellipse', z: z++, x: R(midX - ds / 2), y: R(turnY - ds / 2), width: R(ds), height: R(ds), fill: { type: 'solid', color: a }, opacity: 0.85 } as unknown as Layer);
      }
      break;
    }
  }
  return layers;
}

export function expandShorthand(sh: ShorthandLayer): Layer {
  const pos = expandPosition(sh);
  const base: Record<string, unknown> = {
    id: sh.id,
    z: sh.z,
    ...pos,
  };
  if (sh.opacity   !== undefined) base['opacity']   = sh.opacity;
  if (sh.rotation  !== undefined) base['rotation']  = sh.rotation;
  if (sh.flip_h    !== undefined) base['flip_h']    = sh.flip_h;
  if (sh.flip_v    !== undefined) base['flip_v']    = sh.flip_v;
  if (sh.visible   !== undefined) base['visible']   = sh.visible;
  if (sh.locked    !== undefined) base['locked']    = sh.locked;
  if (sh.link      !== undefined) base['href']       = sh.link;

  switch (sh.type) {
    case 'rect':
      return {
        ...base,
        type: 'rect',
        fill: sh.fill ? expandFill(sh.fill) : sh.color ? { type: 'solid', color: sh.color } : undefined,
        stroke: sh.stroke ? expandStroke(sh.stroke) : undefined,
        radius: sh.radius,
      } as Layer;

    case 'circle':
    case 'ellipse':
      // 'ellipse' shares the circle path (renderer draws both as <ellipse>).
      // Without this case it fell through to default:, which drops fill/stroke
      // → every ellipse rendered fill="none" (invisible). Keep the authored
      // type so an ellipse with width≠height stays an ellipse, not a circle.
      return {
        ...base,
        type: sh.type === 'ellipse' ? 'ellipse' : 'circle',
        fill: sh.fill ? expandFill(sh.fill) : sh.color ? { type: 'solid', color: sh.color } : undefined,
        stroke: sh.stroke ? expandStroke(sh.stroke) : undefined,
      } as Layer;

    case 'text':
      return {
        ...base,
        type: 'text',
        content: { type: 'plain', value: sh.text ?? '' } as TextContent,
        style: {
          ...(sh.font ? { font_family: sh.font } : {}),
          ...(sh.size ? { font_size: sh.size } : {}),
          ...(sh.weight ? { font_weight: sh.weight } : {}),
          ...(sh.color ? { color: sh.color } : {}),
          ...(sh.align ? { align: sh.align } : {}),
          ...(typeof sh.line_height === 'number' ? { line_height: sh.line_height } : {}),
          ...(typeof sh.letter_spacing === 'number' ? { letter_spacing: sh.letter_spacing } : {}),
          ...textTypography(sh),
        } as TextStyle,
      } as Layer;

    case 'line':
      return {
        ...base,
        type: 'line',
        x1: sh.x1 ?? sh.x ?? 0,
        y1: sh.y1 ?? sh.y ?? 0,
        x2: sh.x2 ?? (sh.x ?? 0) + (typeof sh.width === 'number' ? sh.width : 100),
        y2: sh.y2 ?? sh.y ?? 0,
        stroke: sh.stroke ? expandStroke(sh.stroke) : { color: sh.color ?? '#000', width: 2 },
      } as Layer;

    case 'icon': {
      // Size to the box when the model gave one but no explicit size — a 24px
      // icon dropped in a 200×200 box reads as a stray dot. Fall back to 24.
      const boxW = typeof pos.width === 'number' ? pos.width : undefined;
      const boxH = typeof pos.height === 'number' ? pos.height : undefined;
      const boxSize = boxW && boxH ? Math.min(boxW, boxH) : undefined;
      return {
        ...base,
        type: 'icon',
        name: sh.icon ?? sh.text ?? 'circle',
        size: sh.icon_size ?? sh.size ?? boxSize ?? 24,
        color: sh.color,
      } as Layer;
    }

    case 'path':
      return {
        ...base,
        type: 'path',
        d: sh.d ?? '',
        fill: sh.fill ? expandFill(sh.fill) : undefined,
        stroke: sh.stroke ? expandStroke(sh.stroke) : undefined,
      } as Layer;

    case 'polygon':
      return {
        ...base,
        type: 'polygon',
        sides: sh.sides,
        fill: sh.fill ? expandFill(sh.fill) : undefined,
        stroke: sh.stroke ? expandStroke(sh.stroke) : undefined,
      } as Layer;

    case 'star': case 'burst': case 'seal': case 'blob': case 'wave':
    case 'arc': case 'ring': case 'donut': case 'bubble': case 'speech_bubble':
    case 'heart': case 'lightning': case 'bolt': case 'shield': case 'gear':
    case 'cog': case 'arrow': case 'cross_shape': case 'plus_shape': {
      const box: ShapeBox = {
        x: typeof pos.x === 'number' ? pos.x : 0,
        y: typeof pos.y === 'number' ? pos.y : 0,
        w: typeof pos.width === 'number' ? pos.width : 100,
        h: typeof pos.height === 'number' ? pos.height : 100,
      };
      const result = shapePath(sh.type as ShapeName, box, sh as unknown as Record<string, unknown>);
      // arc is an open stroke shape; everything else fills. Default arc/ring
      // strokes sensibly so they're visible even if the model omits a stroke.
      const isStrokeShape = sh.type === 'arc';
      const fill = sh.fill ? expandFill(sh.fill)
        : sh.color && !isStrokeShape ? { type: 'solid' as const, color: sh.color }
        : isStrokeShape ? undefined
        : { type: 'solid' as const, color: sh.color ?? '$text' };
      const stroke = sh.stroke ? expandStroke(sh.stroke)
        : isStrokeShape ? { color: sh.color ?? '$text', width: typeof sh.weight === 'number' ? sh.weight : 8 }
        : undefined;
      return {
        ...base,
        type: 'path',
        d: result.d,
        ...(result.fillRule ? { fill_rule: result.fillRule } : {}),
        ...(fill ? { fill } : {}),
        ...(stroke ? { stroke } : {}),
      } as Layer;
    }

    case 'motif':
    case 'illustration':
    case 'decoration': {
      const box: ShapeBox = {
        x: typeof pos.x === 'number' ? pos.x : 0,
        y: typeof pos.y === 'number' ? pos.y : 0,
        w: typeof pos.width === 'number' ? pos.width : 240,
        h: typeof pos.height === 'number' ? pos.height : 240,
      };
      const shr = sh as unknown as Record<string, unknown>;
      const name = shStr(shr['motif'] ?? shr['shape'] ?? shr['name'] ?? shr['variant'], 'arcs');
      const accent = (typeof sh.color === 'string' && sh.color)
        || (typeof shr['accent'] === 'string' && (shr['accent'] as string))
        || '$accent';
      const idp = sh.id ?? `motif${Math.round(box.x)}_${Math.round(box.y)}`;
      return {
        ...base,
        type: 'group',
        width: box.w, height: box.h,
        // Tag as a space-filling decoration so the ingest pipeline can drop it if
        // it lands on content (a full-width layout leaves no open side space).
        meta: { ...(base['meta'] as Record<string, unknown> | undefined), role: 'motif' },
        layers: motifLayers(name, box, accent, idp, typeof sh.z === 'number' ? sh.z : 0),
      } as unknown as Layer;
    }

    case 'image':
      return {
        ...base,
        type: 'image',
        src: sh.src ?? '',
      } as Layer;

    case 'mermaid':
      return {
        ...base,
        type: 'mermaid',
        definition: sh.definition ?? '',
      } as Layer;

    case 'code':
      return {
        ...base,
        type: 'code',
        code: sh.code ?? '',
        language: sh.language ?? 'typescript',
      } as Layer;

    case 'math':
      return {
        ...base,
        type: 'math',
        expression: sh.expression ?? '',
      } as Layer;

    case 'group':
      return {
        ...base,
        type: 'group',
        // Route children through the full pipeline (coerce → normalize aliases →
        // infer type → ids → visible defaults), so nested layers get the same
        // small-model robustness as top-level ones.
        layers: expandShorthandLayers(coerceShorthandLayers(sh.layers)),
      } as Layer;

    case 'feature_grid':
      return buildFeatureGrid(sh, String(sh.id ?? 'feature_grid'), typeof sh.z === 'number' ? sh.z : 0);

    case 'editorial':
    case 'poster':
      return buildEditorial(sh, String(sh.id ?? 'editorial'), typeof sh.z === 'number' ? sh.z : 0);

    case 'split':
      return buildSplit(sh, String(sh.id ?? 'split'), typeof sh.z === 'number' ? sh.z : 0);

    case 'list':
    case 'steps':
    case 'checklist':
    case 'numbered_list':
      return buildList(sh, String(sh.id ?? 'list'), typeof sh.z === 'number' ? sh.z : 0);

    case 'stat':
    case 'metric':
    case 'big_number':
      return buildStat(sh, String(sh.id ?? 'stat'), typeof sh.z === 'number' ? sh.z : 0);

    case 'event':
    case 'flyer':
    case 'hero':
      return buildEvent(sh, String(sh.id ?? 'event'), typeof sh.z === 'number' ? sh.z : 0);

    case 'sections':
    case 'infographic':
    case 'document':
    case 'report_poster':
      return buildSections(sh, String(sh.id ?? 'sections'), typeof sh.z === 'number' ? sh.z : 0);

    case 'decor':
    case 'marble_bg':
    case 'backdrop':
      return buildDecor(sh, String(sh.id ?? 'decor'), typeof sh.z === 'number' ? sh.z : 0);

    case 'component':
      return {
        ...base,
        type: 'component',
        ref: typeof sh.ref === 'string' ? sh.ref : '',
        ...(sh.slots && typeof sh.slots === 'object' ? { slots: sh.slots } : {}),
        ...(typeof sh.variant === 'string' ? { variant: sh.variant } : {}),
        ...(sh.overrides && typeof sh.overrides === 'object' ? { overrides: sh.overrides } : {}),
      } as Layer;

    case 'chart':
      return {
        ...base,
        type: 'chart',
        spec: buildChartSpec(sh),
      } as Layer;

    case 'kpi_card':
      return {
        ...base,
        type: 'kpi_card',
        label: typeof sh.label === 'string' ? sh.label : (sh.text ?? ''),
        value: (sh.value as string | number) ?? '',
        ...(sh.format ? { format: sh.format } : {}),
        ...(sh.delta !== undefined ? { delta: sh.delta as string | number } : {}),
        ...(sh.icon ? { icon: sh.icon } : {}),
        ...(sh.fill ? { background: typeof sh.fill === 'string' ? sh.fill : undefined } : {}),
        ...(sh.color ? { text_color: sh.color } : {}),
        ...(typeof sh.radius === 'number' ? { border_radius: sh.radius } : {}),
      } as Layer;

    case 'auto_layout':
      return {
        ...base,
        type: 'auto_layout',
        direction: sh.direction === 'row' ? 'row' : 'column',
        ...(typeof sh.gap === 'number' ? { gap: sh.gap } : {}),
        ...(sh.padding !== undefined ? { padding: sh.padding } : {}),
        ...(typeof sh.align === 'string' ? { align_items: mapAlignItems(sh.align) } : {}),
        ...(typeof sh.justify === 'string' ? { justify_content: mapJustify(sh.justify) } : {}),
        ...(typeof sh.wrap === 'boolean' ? { wrap: sh.wrap } : {}),
        ...(sh.fill ? { fill: expandFill(sh.fill) } : {}),
        ...(sh.stroke ? { stroke: expandStroke(sh.stroke) } : {}),
        ...(sh.radius !== undefined ? { radius: sh.radius } : {}),
        layers: expandShorthandLayers(coerceShorthandLayers(sh.layers)),
      } as Layer;

    default:
      // Pass through as-is for unknown types
      return { ...base, type: sh.type } as unknown as Layer;
  }
}

// Layer types the compact-string parser recognizes as an explicit prefix.
const KNOWN_SHORTHAND_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'text', 'line', 'icon', 'path', 'polygon', 'image', 'mermaid', 'code', 'math', 'group',
  'auto_layout', 'row', 'column', 'stack', 'grid', 'chart', 'kpi_card', 'component',
  'feature_grid', 'cards', 'card_grid', 'features', 'decor', 'marble_bg', 'backdrop',
]);

// Parse a compact layer string a small model tends to emit, e.g.
// "text:[200,200,800,200]:BREWED TO PERFECTION", "pos:[0,0,1080,1080]", or
// "rect:[0,0,100,100]". Pulls out pos, an explicit type prefix (ignoring a
// literal "pos:" lead), and trailing text. Type is left for inference when the
// prefix isn't a known type.
function parseCompactLayer(s: string): ShorthandLayer {
  const out: ShorthandLayer = {};
  const m = s.match(/\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/);
  if (m && m.index !== undefined) {
    out.pos = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    const prefix = s.slice(0, m.index).replace(/[:\s]+$/, '').trim().toLowerCase();
    if (KNOWN_SHORTHAND_TYPES.has(prefix)) out.type = prefix;
    const suffix = s.slice(m.index + m[0].length).replace(/^[:\s]+/, '').trim();
    if (suffix) out.text = suffix;
  } else if (s.trim()) {
    out.text = s.trim(); // no bracket → treat the whole string as a text label
  }
  return out;
}

// Coerce the various shapes a model sends for layers_shorthand into a canonical
// ShorthandLayer[]. Accepts: the documented array of objects; an array of
// compact strings; or an object/dict mapping id → object | compact-string
// (e.g. {bg:"pos:[…]", headline:"text:[…]:Hello"} — a common small-model form).
// Recover a layers_shorthand that arrived as a (often MALFORMED) JSON string —
// the dominant blank-design cause on small models. They stringify the whole
// array AND mangle it: a missing final brace (truncation), the OTHER tool params
// concatenated in (`…}],"design_path":"…"}`), or a doubled `}`. Scan bracket
// depth (string-aware) and either TRUNCATE at the first complete top-level value
// (trailing garbage) or APPEND the missing closers (unclosed value).
function closeJsonString(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false, endIdx = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch === '{' ? '}' : ']');
    else if (ch === '}' || ch === ']') { if (stack.length) stack.pop(); if (stack.length === 0) { endIdx = i; break; } }
  }
  if (endIdx >= 0 && endIdx < s.length - 1) return s.slice(0, endIdx + 1);
  if (stack.length) return s.replace(/,\s*$/, '') + stack.reverse().join('');
  return s;
}
/** Strict JSON → lenient YAML (unquoted keys / single quotes / dup-keys=last) →
 *  bracket-repaired reparse. Returns the parsed value, or undefined if all fail. */
function lenientParseLayers(s: string): unknown {
  try { return JSON.parse(s); } catch { /* not strict JSON */ }
  try { const y = yaml.load(s); if (y && typeof y === 'object') return y; } catch { /* not YAML */ }
  const repaired = closeJsonString(s);
  if (repaired !== s) {
    try { return JSON.parse(repaired); } catch { /* repaired still not JSON */ }
    try { const y = yaml.load(repaired); if (y && typeof y === 'object') return y; } catch { /* give up */ }
  }
  return undefined;
}
// A model that confuses the page-append shape for a layer appends a stray
// routing artifact next to the real preset, e.g.
//   {type:"poster", label:"my.design.yaml", page_id:0}
// `poster` is a real preset type, so coercion accepts it and the expander
// renders the FILENAME label as a headline ON TOP of the good content (the v4
// streaming-poster slip). Recognise that shape — a container/routing layer
// whose ONLY payload is a filename, with no blocks/items — so it can be pruned.
const CONTAINER_TYPES = new Set(['poster', 'page', 'slide', 'document', 'carousel', 'design']);
const FILENAME_RE = /\.(?:design\.)?ya?ml$|\.(?:png|jpe?g|svg|pdf|json)$/i;
function isStrayContainerLayer(r: Record<string, unknown>): boolean {
  if (Array.isArray(r['blocks']) || Array.isArray(r['items']) || Array.isArray(r['rows']) || Array.isArray(r['sections'])) return false;
  const labelish = [r['label'], r['title'], r['content'], r['text'], r['value'], r['name']]
    .find(v => typeof v === 'string' && (v as string).trim() !== '') as string | undefined;
  if (typeof labelish !== 'string' || !FILENAME_RE.test(labelish.trim())) return false;
  const routing = r['page_id'] !== undefined || r['page'] !== undefined;
  const container = typeof r['type'] === 'string' && CONTAINER_TYPES.has((r['type'] as string).toLowerCase());
  return routing || container;
}
// Prune stray container/routing artifacts, but only when a real sibling layer
// survives — never empty the batch (downstream empty-guards handle a truly
// empty add; a lone filename layer is left for the error path to surface).
function pruneStrayMeta(arr: ShorthandLayer[]): ShorthandLayer[] {
  const kept = arr.filter(l => !isStrayContainerLayer(l as Record<string, unknown>));
  return kept.length ? kept : arr;
}

export function coerceShorthandLayers(input: unknown): ShorthandLayer[] {
  const one = (v: unknown, id?: string): ShorthandLayer => {
    if (typeof v === 'string') { const p = parseCompactLayer(v); return id ? { id, ...p } : p; }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const obj = { ...(v as Record<string, unknown>) } as ShorthandLayer;
      if (id && obj.id === undefined) obj.id = id;
      return obj;
    }
    return (id ? { id } : {}) as ShorthandLayer;
  };
  if (input == null) return [];
  // A STRING is the #1 silent-failure shape: a model JSON/YAML-stringifies the
  // whole layers_shorthand ('[{type:"editorial", …}]'). Unquoted keys make it
  // invalid strict JSON but valid YAML flow, so parse leniently and recurse.
  // Without this the string matches no branch below → [] → an EMPTY page that
  // still reports success (caught a 6-page carousel silently dropping all copy).
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) return [];
    const parsed = lenientParseLayers(s);
    if (parsed && typeof parsed === 'object') return coerceShorthandLayers(parsed);
    // A bare compact layer must carry an [x,y,w,h] bracket. Without one it's a
    // junk blob a weak model emitted ("feature_grid:0,0,…:items=…") — return []
    // so the caller surfaces the correct ARRAY shape instead of a junk layer.
    if (/\[[^\]]*\]/.test(s)) { const p = parseCompactLayer(s); if (Object.keys(p).length) return [p]; }
    return [];
  }
  if (Array.isArray(input)) return pruneStrayMeta(input.map(v => one(v)));
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    // A bare object that is itself ONE layer — it carries a layer type
    // (type/preset as a string) — not a {id: layer} dict. Without this, a model
    // that sends a single {preset:"feature_grid", title, items:[…]} object has
    // each key exploded into its own layer (title/items become stray texts).
    if (typeof obj['type'] === 'string' || typeof obj['preset'] === 'string') return [one(obj)];
    return pruneStrayMeta(Object.entries(obj).map(([id, v]) => one(v, id)));
  }
  return [];
}

// Every preset `type` (plus its aliases) the expander dispatches on. Used to
// recognise a preset payload a model stuffed into a text layer (see below).
const PRESET_TYPES = new Set([
  'feature_grid', 'editorial', 'poster', 'split', 'list', 'steps', 'checklist',
  'numbered_list', 'stat', 'metric', 'big_number', 'event', 'flyer', 'hero',
  'sections', 'infographic', 'document', 'report_poster', 'decor', 'marble_bg',
  'backdrop',
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
const FIELD_BLOCK_KEYS = ['stats', 'bars', 'heading_text', 'callout', 'takeaway', 'list', 'steps', 'kpis', 'metrics', 'quote', 'source'];
function hasFieldKeyedBlocks(r: Record<string, unknown>): boolean {
  const present = FIELD_BLOCK_KEYS.filter(k => r[k] != null);
  return present.length >= 2 || (present.length >= 1 && (r['kicker'] != null || r['title'] != null || r['subtitle'] != null));
}
// Build a `blocks[]` array from field-keyed sections content, in editorial order.
function fieldKeyedToBlocks(r: Record<string, unknown>): Record<string, unknown>[] {
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

function looksLikePreset(o: unknown): boolean {
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
function normalizePresetBlob(o: unknown): unknown {
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
const WRAPPER_TYPES = new Set(['', 'group', 'page', 'container', 'frame', 'root', 'canvas', 'wrapper', 'layout', 'artboard']);
// Page-level style keys a model puts on a wrapper, meant to cascade onto the
// PRESET children it holds (presets consume bg/accent/palette/text_color; leaf
// text/icon layers carry their own color, so cascading to them only adds
// "unrecognized field" noise). Excludes font_heading/font_body — no layer reads
// them, so they would just trip the diagnostics.
const CASCADE_KEYS = ['bg', 'background', 'accent', 'palette', 'theme', 'mood', 'text_color'];

// Is this a BARE container — a dimensionless wrapper with a nested layers/children
// array and no own geometry or flow hints? Such a wrapper carries page intent,
// not a real group; inferLayerType would make it a `group` with no width → reject.
function isBareContainer(r: Record<string, unknown>): boolean {
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
function childPaintsCanvas(kids: ShorthandLayer[], docW: number, docH: number): boolean {
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
const BLEED_PRESETS = new Set([
  'feature_grid', 'editorial', 'poster', 'event', 'flyer', 'hero', 'split',
  'decor', 'marble_bg', 'backdrop',
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
    const hasBox = (Array.isArray(r['pos']) && (r['pos'] as unknown[]).length === 4)
      || typeof r['x'] === 'number' || typeof r['y'] === 'number'
      || typeof r['width'] === 'number' || typeof r['height'] === 'number';
    if (hasBox) continue;
    r['pos'] = [0, 0, docW, docH];
    filled++;
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
const FLOW_PAGE_PRESETS = new Set([
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

// Is this an OPAQUE rectangle covering (essentially) the whole canvas? A solid
// or gradient fill at the origin spanning the page — the shape a model stamps as
// a "background". Noise/image overlays and anything <0.95 opacity (a scrim) are
// deliberately NOT covers and are left where the model put them.
function isFullCanvasOpaqueRect(l: Layer, docW: number, docH: number): boolean {
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
const PAGE_PRESETS = new Set([
  'feature_grid', 'sections', 'infographic', 'document', 'report_poster',
  'editorial', 'poster', 'event', 'flyer', 'hero', 'split',
]);
const DARK_LUM = 0.42; // matches buildFeatureGrid's bgDark threshold

function fillHex(fill: unknown): string | null {
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
function pageCanvasColor(page: { layers?: Layer[] }): string | null {
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
function pageHeadingFont(page: { layers?: Layer[] }): string | null {
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
function normalizeShorthandAliases(sh: ShorthandLayer): ShorthandLayer {
  const out: ShorthandLayer = { ...sh };
  const r = out as Record<string, unknown>;
  // Terse single-/short-char keys small models emit to save tokens
  // (p/t/f/w/h/col). Canonical key wins when already present.
  const alias = (canonical: string, ...keys: string[]): void => {
    if (r[canonical] !== undefined) return;
    for (const k of keys) if (r[k] !== undefined) { r[canonical] = r[k]; return; }
  };
  alias('type', 't', 'preset');
  alias('pos', 'p');
  alias('fill', 'f');
  alias('width', 'w');
  alias('height', 'h');
  alias('color', 'col');
  alias('radius', 'corner_radius', 'cornerRadius', 'borderRadius');
  // `children` → `layers` — the UI-tree word strong models reach for. Without
  // this, nested container content is silently dropped and the model concludes
  // "nesting isn't supported". Runs at every level (expansion recurses).
  if (out.layers === undefined && Array.isArray(r['children'])) out.layers = r['children'] as ShorthandLayer[];
  // Container type aliases → auto_layout (flexbox). The model declares a
  // row/column/grid and the engine flows child positions, so it doesn't have
  // to compute coordinates for every element in a complex layout.
  const ct = typeof out.type === 'string' ? out.type.toLowerCase() : '';
  if (ct === 'row' || ct === 'hstack') { out.type = 'auto_layout'; if (out.direction === undefined) out.direction = 'row'; }
  else if (ct === 'column' || ct === 'col' || ct === 'stack' || ct === 'vstack') { out.type = 'auto_layout'; if (out.direction === undefined) out.direction = 'column'; }
  else if (ct === 'grid') { out.type = 'auto_layout'; if (out.direction === undefined) out.direction = 'row'; if (out.wrap === undefined) out.wrap = true; }
  else if (ct === 'shape' || ct === 'box' || ct === 'container') { out.type = 'rect'; }
  else if (ct === 'cards' || ct === 'card_grid' || ct === 'card-grid' || ct === 'features' || ct === 'feature-grid' || ct === 'featuregrid') { out.type = 'feature_grid'; }
  // `c` → text content
  if (out.text === undefined && typeof r['c'] === 'string') out.text = r['c'] as string;
  // `s` is ambiguous: a number is a font size, a string is an image src.
  if (r['s'] !== undefined) {
    if (typeof r['s'] === 'number' && out.size === undefined) out.size = r['s'] as number;
    else if (typeof r['s'] === 'string' && out.src === undefined) out.src = r['s'] as string;
  }
  // content (plain string or {value}) → text
  if (out.text === undefined && out.content !== undefined) {
    const c = out.content;
    if (typeof c === 'string') out.text = c;
    else if (c && typeof c === 'object' && typeof c.value === 'string') out.text = c.value;
  }
  // font_size / fontSize → size
  if (out.size === undefined) {
    const fs = out.font_size ?? out.fontSize;
    if (typeof fs === 'number') out.size = fs;
  }
  // symbol / glyph → icon name
  if (out.icon === undefined) {
    const sym = out.symbol ?? out.glyph;
    if (typeof sym === 'string') out.icon = sym;
  }
  // `name` → icon name, but only for explicit icon layers — the expanded
  // schema uses `name` for the icon, so a model reasonably puts it there.
  // Gated on type to avoid turning a stray-named rect into an icon.
  if (out.icon === undefined && out.type === 'icon' && typeof r['name'] === 'string') out.icon = r['name'] as string;
  // url / href → src
  if (out.src === undefined) {
    const u = out.url ?? out.href;
    if (typeof u === 'string') out.src = u;
  }
  // typography: lh/leading → line_height; track/tracking → letter_spacing.
  // These give real type craft (tight display leading 0.9–1.1, tracked +1.5
  // uppercase mono labels, negative tracking on big headlines).
  if (out.line_height === undefined) {
    const lh = r['lh'] ?? r['leading'];
    if (typeof lh === 'number') out.line_height = lh;
  }
  if (out.letter_spacing === undefined) {
    const ls = r['track'] ?? r['tracking'];
    if (typeof ls === 'number') out.letter_spacing = ls;
  }
  return out;
}

// Infer a layer type from the fields a small model actually provided, for when
// it omits `type` (a common failure: it emits {pos, text} and expects "text").
function inferLayerType(sh: ShorthandLayer): string {
  // An items array is the feature_grid preset (model sent content, no type).
  if (Array.isArray((sh as Record<string, unknown>)['items'])) return 'feature_grid';
  // A layer with children is a container: auto_layout if it has layout hints
  // (direction/gap/justify/wrap), otherwise a plain group.
  if (Array.isArray(sh.layers)) {
    return (sh.direction !== undefined || sh.gap !== undefined || sh.justify !== undefined || sh.wrap !== undefined)
      ? 'auto_layout' : 'group';
  }
  if (sh.text !== undefined) return 'text';
  if (sh.src !== undefined) return 'image';
  if (sh.icon !== undefined) return 'icon';
  if (sh.d !== undefined) return 'path';
  if ((sh as Record<string, unknown>)['x1'] !== undefined) return 'line';
  return 'rect'; // a positioned box is the safe default
}

const FILLABLE_SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon']);

// Give an under-specified layer visible, theme-aware styling so a small model's
// bare {pos,text} layers don't render blank (invisible black 16px text on the
// dark default theme, or an unfilled — transparent — background rect). Uses
// theme color tokens ($text/$surface) so it adapts to whatever theme is active,
// and sizes text relative to its box. Never overrides values the model gave.
function applyVisibleDefaults(sh: ShorthandLayer, type: string): ShorthandLayer {
  const out = { ...sh };
  if (type === 'text') {
    if (out.color === undefined) out.color = '$text';
    if (out.size === undefined) {
      const h = typeof out.pos?.[3] === 'number' ? out.pos[3]
        : typeof out.height === 'number' ? out.height : undefined;
      out.size = h ? Math.max(28, Math.min(120, Math.round(h * 0.5))) : 48;
    }
  } else if (FILLABLE_SHAPES.has(type) && out.fill === undefined && out.color === undefined) {
    out.fill = '$surface';
  }
  return out;
}

const REPEAT_CAP = 200; // backstop against a runaway repeat count

// Deep-substitute {{key}} tokens in every string field (recursing into nested
// layers) with values from a data row. Used by repeat with a data array.
function substituteTokens(sh: ShorthandLayer, data: Record<string, unknown>): ShorthandLayer {
  const sub = (v: unknown): unknown => {
    if (typeof v === 'string') return v.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, k) => {
      const val = data[k];
      return val === undefined || val === null ? '' : String(val);
    });
    if (Array.isArray(v)) return v.map(sub);
    if (v && typeof v === 'object') {
      const o: Record<string, unknown> = {};
      for (const [k, vv] of Object.entries(v as Record<string, unknown>)) o[k] = sub(vv);
      return o;
    }
    return v;
  };
  return sub(sh) as ShorthandLayer;
}

// Expand any layer carrying `repeat` into multiple layers BEFORE normalization:
// a number → N identical copies; a data array → one copy per row with {{key}}
// tokens filled in. Copies get unique ids (<id>_1..N). Nested children repeat
// naturally because container children also flow through expandShorthandLayers.
function expandRepeats(layers: ShorthandLayer[]): ShorthandLayer[] {
  const out: ShorthandLayer[] = [];
  for (const sh of layers) {
    if (!sh || typeof sh !== 'object' || sh.repeat === undefined) { out.push(sh); continue; }
    const { repeat, ...rest } = sh;
    const rows: (Record<string, unknown> | null)[] = Array.isArray(repeat)
      ? repeat.slice(0, REPEAT_CAP)
      : Array.from({ length: Math.max(0, Math.min(REPEAT_CAP, Math.floor(Number(repeat) || 0))) }, () => null);
    rows.forEach((row, i) => {
      // Both numeric and data repeats expose {{i}}/{{n}} (1-based index);
      // data repeats add the row's own keys.
      const base = substituteTokens(rest as ShorthandLayer, { ...(row ?? {}), i: i + 1, n: i + 1 });
      if (typeof rest.id === 'string') base.id = `${rest.id}_${i + 1}`;
      out.push(base);
    });
  }
  return out;
}

export function expandShorthandLayers(layers: ShorthandLayer[]): Layer[] {
  layers = expandRepeats(layers);
  // Small models frequently omit the required id/type/z on shorthand layers.
  // Rather than reject the whole call, infer type from the fields, auto-assign
  // a unique id, default z to stacking order, and apply visible theme-aware
  // styling — so the design still renders with content instead of blank.
  const seen = new Set<string>();
  for (const l of layers) if (l.id) seen.add(l.id);
  return layers.map((raw, i) => {
    // Map verbose-schema aliases (content/font_size/symbol/url) onto the
    // canonical shorthand fields before inferring type or applying defaults,
    // so inference sees `text`/`icon`/`src` and the model's content survives.
    const sh = normalizeShorthandAliases(raw);
    const type = sh.type ?? inferLayerType(sh);
    let id = sh.id;
    if (!id) {
      let n = i + 1;
      id = `${type}_${n}`;
      while (seen.has(id)) { n++; id = `${type}_${n}`; }
      seen.add(id);
    }
    return expandShorthand(applyVisibleDefaults({ ...sh, id, type, z: sh.z ?? i }, type));
  });
}

// Every shorthand key the expander understands — canonical fields plus the
// aliases normalizeShorthandAliases maps. A key outside this set is silently
// ignored on expansion, so diagnoseShorthandKeys flags it for the model.
const KNOWN_SHORTHAND_KEYS = new Set<string>([
  // engine-internal markers (set by the engine, not the model — never flagged)
  '__fillPage', '__variant', '__deckseed',
  // canonical
  'id', 'type', 'z', 'pos', 'x', 'y', 'width', 'height', 'opacity', 'rotation',
  'flip_h', 'flip_v', 'visible', 'locked', 'fill', 'stroke', 'radius', 'text',
  'font', 'size', 'weight', 'color', 'align', 'text_decoration', 'src', 'fit',
  'alt', 'icon', 'icon_size', 'name', 'd', 'sides', 'x1', 'y1', 'x2', 'y2',
  'definition', 'code', 'language', 'expression', 'layers',
  // typography craft
  'line_height', 'letter_spacing', 'lh', 'leading', 'track', 'tracking',
  // auto_layout / container
  'direction', 'gap', 'padding', 'justify', 'wrap', 'repeat', 'children', 'valign',
  'corner_radius', 'cornerRadius', 'borderRadius',
  // chart / kpi_card / component
  'chart', 'data', 'spec', 'value', 'label', 'delta', 'format', 'ref', 'slots', 'variant', 'overrides',
  // feature_grid preset
  'items', 'features', 'title', 'subtitle', 'card_fill', 'accent', 'text_color', 'muted', 'bg', 'columns',
  'preset', 'bg_gradient', 'benefit',
  // decor / marble_bg / backdrop preset
  'palette', 'corners', 'intensity', 'veins', 'rings', 'dots', 'style',
  // rich engine-composed background (composeBackground)
  'bg_style', 'background_style', 'bg_treatment', 'bg_image', 'photo', 'bg_photo',
  // editorial / split / list layout presets
  'kicker', 'eyebrow', 'headline', 'lede', 'deck', 'body', 'desc', 'footer',
  'side', 'ratio', 'panel', 'panel_fill', 'panel_label', 'panel_text', 'big',
  'marker', 'heading', 'description', 'cards',
  'stat', 'number', 'caption',
  'details', 'lines', 'info', 'date', 'venue', 'location', 'place', 'time', 'when', 'where',
  'blocks', 'sections', 'kind', 'cite', 'author', 'source', 'quote',
  // pattern / image fills (WS1)
  'pattern', 'fg', 'mode', 'tile_size', 'foreground', 'background',
  // parametric shapes (WS2)
  'points', 'inner_ratio', 'lobes', 'seed', 'cycles', 'amplitude', 'start', 'end',
  'thickness', 'teeth', 'hole',
  // typography craft (WS3)
  'transform', 'text_transform', 'uppercase', 'italic', 'font_style', 'underline',
  'decoration', 'variation', 'font_variation_settings', 'features', 'font_feature_settings',
  'outline', 'outline_color', 'outline_width', 'text_stroke', 'highlight', 'curve',
  'text_path', 'word_spacing',
  // per-style title treatment (highlight/underline/mega/rotate/rule)
  'headline_style', 'type_treatment',
  // decorative motif / illustration (fills negative space)
  'motif', 'shape',
  // aliases (verbose + terse)
  'content', 'font_size', 'fontSize', 'symbol', 'glyph', 'url', 'href', 'link',
  't', 'p', 'f', 'w', 'h', 'col', 'c', 's',
]);

// Flag shorthand keys the expander doesn't recognize (so they aren't silently
// dropped — the failure mode where a model sends {t:"text"} and gets a rect).
// Runs on the raw coerced shorthand, before expansion.
export function diagnoseShorthandKeys(raw: ShorthandLayer[]): string[] {
  const notes: string[] = [];
  raw.forEach((sh, i) => {
    if (!sh || typeof sh !== 'object') return;
    const unknown = Object.keys(sh).filter(k => !KNOWN_SHORTHAND_KEYS.has(k));
    if (unknown.length) notes.push(`layer "${sh.id ?? i}": unrecognized field(s) [${unknown.join(', ')}] were ignored. Text fields: text, font, size, weight, color, align, line_height (lh), letter_spacing (track). Box fields: pos, type, fill, stroke, radius, icon, src.`);
  });
  return notes;
}

// A few popular icon names to offer when a model picks one that doesn't exist.
const SUGGESTED_ICONS = 'image, star, heart, check, arrow-right, user, mail, calendar, clock, zap, award, map-pin, phone, shopping-cart';

// Resolve a layer's bounding box from either pos:[x,y,w,h] or x/y/width/height.
// Returns null when any component is non-numeric (e.g. width:"auto") — we can't
// reason about overlap without a concrete box.
interface Box { x: number; y: number; w: number; h: number }
function layerBox(l: Layer): Box | null {
  const a = l as Layer & { pos?: unknown; x?: number; y?: number; width?: number | 'auto'; height?: number | 'auto' };
  if (Array.isArray(a.pos) && a.pos.length === 4 && a.pos.every(n => typeof n === 'number')) {
    const [x, y, w, h] = a.pos as number[];
    return { x, y, w, h };
  }
  if (typeof a.x === 'number' && typeof a.y === 'number' && typeof a.width === 'number' && typeof a.height === 'number') {
    return { x: a.x, y: a.y, w: a.width, h: a.height };
  }
  return null;
}

function overlapRatio(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = ix * iy;
  const minArea = Math.min(a.w * a.h, b.w * b.h);
  return minArea > 0 ? inter / minArea : 0;
}

// Detect hand-placed TOP-LEVEL text layers whose boxes collide. Overlapping
// text is almost never intentional — it renders as an illegible pile (the
// classic small-model failure: hand-placing N card headings at the same spot).
// We check only top-level text siblings (shared canvas coords); container
// children are positioned by the engine and must not be flagged. Returns one
// note that steers toward the preset / container that owns layout.
export function detectTextOverlap(layers: Layer[]): string | null {
  const boxed = layers
    .filter(l => l.type === 'text')
    .map(l => ({ id: l.id, box: layerBox(l) }))
    .filter((t): t is { id: string; box: Box } => t.box !== null);
  const colliding = new Set<string>();
  for (let i = 0; i < boxed.length; i++) {
    for (let j = i + 1; j < boxed.length; j++) {
      if (overlapRatio(boxed[i].box, boxed[j].box) >= 0.35) {
        colliding.add(boxed[i].id);
        colliding.add(boxed[j].id);
      }
    }
  }
  if (colliding.size < 2) return null;
  const ids = [...colliding];
  const shown = ids.slice(0, 6).join(', ') + (ids.length > 6 ? '…' : '');
  return `${ids.length} text layers overlap (${shown}) — hand-placed coordinates collide, so they render on top of each other illegibly. For cards/columns/rows DON'T hand-place x/y: use the feature_grid preset ({type:"feature_grid", title, subtitle, items:[{icon,title,desc}]}) or a row/column container — the engine spaces them with no overlap.`;
}

// Inspect expanded layers for things that render but not the way the model
// likely intended — an unknown icon name (→ placeholder), a local image src
// (renders only if the asset exists), or empty text. Returns one actionable
// note per issue so a tool response can direct the model's next call. This is
// the self-correction signal for the multi-tool loop: the design still saves,
// and the model is told exactly what to fix.
export function diagnoseLayers(layers: Layer[]): string[] {
  const notes: string[] = [];
  const walk = (ls: Layer[] | undefined): void => {
    for (const l of ls ?? []) {
      if (l.type === 'icon') {
        const name = (l as Layer & { name?: string }).name ?? '';
        const hit = resolveIconName(name);
        if (!hit) notes.push(`icon "${l.id}": "${name}" is not a known icon → renders as a blank fallback circle. Use a real name, e.g.: ${SUGGESTED_ICONS}.`);
      } else if (l.type === 'image') {
        const src = (l as Layer & { src?: string }).src ?? '';
        if (src && !/^(https?:|data:|file:|\/\/)/i.test(src)) {
          notes.push(`image "${l.id}": src "${src}" is a local file — it renders only if that asset exists in the project, else a placeholder frame shows. Use an https:// URL, or replace the photo with a fill/gradient/shape/icon you can render directly.`);
        }
      } else if (l.type === 'text') {
        const v = (l as Layer & { content?: { value?: string } }).content?.value;
        if (typeof v === 'string' && v.trim() === '') notes.push(`text "${l.id}": value is empty — put the copy in the "content" (or "text") field.`);
        // A model that picked feature_grid but encoded it as a flat string lands
        // here as one text layer holding the raw DSL ("…items=icon=…:title=…").
        // Tell it the JSON shape so the next call is a real preset, not a blob.
        else if (typeof v === 'string' && (/\bitems\s*=/.test(v) || (/\btitle\s*=/.test(v) && /\bdesc\s*=/.test(v)) || /^\s*feature_grid\s*:/.test(v))) {
          notes.push(`text "${l.id}": the content looks like a feature_grid encoded as a string. Send it as a JSON object, not a colon/equals string: {type:"feature_grid", title:"…", subtitle:"…", bg:"gradient", items:[{icon:"…", title:"…", desc:"…"}]}.`);
        }
      }
      // Recurse into ANY nested container — group, auto_layout, feature_grid
      // cards… — not just `group`. Presets nest their icons and text inside
      // auto_layout rows, so a group-only walk silently skipped them and an
      // unknown icon (which renders as a placeholder box a blind model can't
      // see) went unwarned.
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) walk(kids);
    }
  };
  walk(layers);
  const overlap = detectTextOverlap(layers);
  if (overlap) notes.unshift(overlap);
  return notes;
}

/**
 * Context compression for local LLMs
 * Returns a minimal summary of a design for feeding to LLMs with tight context windows.
 */
export function compressDesignContext(spec: {
  meta?: { name: string; type: string };
  pages?: { id: string; label?: string }[];
  theme?: { ref: string };
  layers?: { id: string; type: string }[];
}): string {
  const parts: string[] = [];
  parts.push(`Design: ${spec.meta?.name ?? 'Untitled'} (${spec.meta?.type ?? 'unknown'})`);

  if (spec.theme?.ref) {
    parts.push(`Theme: ${spec.theme.ref}`);
  }

  if (spec.pages && spec.pages.length > 0) {
    const pageNames = spec.pages.map(p => p.label ?? p.id).join(', ');
    parts.push(`Completed: [${pageNames}]`);
    parts.push(`Next: page ${spec.pages.length + 1}`);
  }

  if (spec.layers) {
    const layerSummary = spec.layers.map(l => `${l.id}(${l.type})`).join(', ');
    parts.push(`Layers: [${layerSummary}]`);
  }

  return parts.join('. ');
}

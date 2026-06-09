import type { Layer, Fill, TextContent, TextStyle } from '../schema/types';
import { resolveIconName } from '../renderer/lucide-icons';
import { shapePath, type ShapeName, type ShapeBox } from '../engine/shape-paths';
import { hexToRgb, luminance } from './engine/reference';

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
  const cardFill  = str(r['card_fill'], '$surface');
  const accent    = str(r['accent'], '$primary');
  const textColor = str(r['text_color'] ?? r['color'], '$text');
  const muted     = str(r['muted'], textColor);
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
  if (bgFill !== undefined) {
    layers.push({ id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: expandFill(bgFill) } as unknown as Layer);
  }
  const title = str(r['title']);
  if (title) layers.push({ id: `${id}_title`, type: 'text', z: 5, x: X + M, y: Y + Math.round(H * 0.11), width: W - 2 * M, height: Math.round(H * 0.13),
    content: { type: 'plain', value: title }, style: { font_size: Math.round(W * 0.08), font_weight: 800, color: textColor, align: 'center' } } as unknown as Layer);
  const subtitle = str(r['subtitle']);
  if (subtitle) layers.push({ id: `${id}_subtitle`, type: 'text', z: 5, x: X + M, y: Y + Math.round(H * 0.26), width: W - 2 * M, height: Math.round(H * 0.06),
    content: { type: 'plain', value: subtitle }, style: { font_size: Math.round(W * 0.03), color: muted, align: 'center' } } as unknown as Layer);
  const cards: Layer[] = items.map((it, i) => {
    const kids: Layer[] = [];
    if (it.icon) kids.push({ id: `${id}_c${i}_icon`, type: 'icon', z: 0, x: 0, y: 0, width: 60, height: 60, name: it.icon, size: 60, color: cardIcon } as unknown as Layer);
    if (it.title) kids.push({ id: `${id}_c${i}_title`, type: 'text', z: 1, x: 0, y: 0, width: cardW - 60, height: 90,
      content: { type: 'plain', value: it.title }, style: { font_size: 30, font_weight: 700, color: cardText, align: 'center' } } as unknown as Layer);
    if (it.desc) kids.push({ id: `${id}_c${i}_desc`, type: 'text', z: 2, x: 0, y: 0, width: cardW - 60, height: 110,
      content: { type: 'plain', value: it.desc }, style: { font_size: 21, color: cardMuted, align: 'center' } } as unknown as Layer);
    return { id: `${id}_card${i}`, type: 'auto_layout', z: i, x: 0, y: 0, width: cardW, height: rowH, direction: 'column',
      gap: 16, padding: 28, align_items: 'center', justify_content: 'center', radius: 18,
      fill: expandFill(cardFillResolved), layers: kids } as unknown as Layer;
  });
  layers.push({ id: `${id}_row`, type: 'auto_layout', z: 10, x: X + M, y: Y + rowY, width: W - 2 * M, height: rowH,
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
function estTextHeight(text: string, fontSize: number, widthPx: number, lh = 1.3): number {
  const cpl = Math.max(1, Math.floor(widthPx / (fontSize * 0.54)));
  const lines = text.split('\n').reduce((a, seg) => a + Math.max(1, Math.ceil(seg.length / cpl)), 0);
  return Math.ceil(lines * fontSize * lh);
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
  const bg = shStr(r['bg'], '#FAF5EC');
  const accent = shStr(r['accent'], '#B8543C');
  const textColor = shStr(r['text_color'] ?? r['color'], '#1A1A1A');
  const muted = shStr(r['muted'], '#6E5F4A');
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['label']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const subtitle = shStr(r['subtitle'] ?? r['lede'] ?? r['deck']);
  const body = shStr(r['body'] ?? r['desc']);
  const footer = shStr(r['footer']);
  const M = Math.round(W * 0.08);
  const cW = W - 2 * M, cX = X + M;
  const layers: Layer[] = [{ id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: expandFill(bg) } as unknown as Layer];
  let cy = Y + Math.round(H * 0.13), k = 1;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += Math.round(H * 0.035);
  }
  layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: cW, height: 3, fill: { type: 'solid', color: textColor } } as unknown as Layer);
  cy += Math.round(H * 0.025);
  if (title) {
    const ts = Math.round(W * 0.085), th = estTextHeight(title, ts, cW, 1.04);
    layers.push(txt(`${id}_title`, z + k++, cX, cy, cW, th, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.04 }));
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
  const textColor = shStr(r['text_color'] ?? r['color'], '#1A1A1A');
  const muted = shStr(r['muted'], '#6E5F4A');
  const panelText = shStr(r['panel_text'], '#FAF5EC');
  const kicker = shStr(r['kicker'] ?? r['eyebrow'] ?? r['label']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const subtitle = shStr(r['subtitle'] ?? r['lede'] ?? r['deck'] ?? r['body']);
  const panelLabel = shStr(r['panel_label'] ?? r['big']);

  const PW = Math.round(W * ratio);
  const panelX = side === 'left' ? X : X + W - PW;
  const contentX = side === 'left' ? X + PW : X;
  const Mcol = Math.round((W - PW) * 0.1);
  const cW = (W - PW) - 2 * Mcol, cX = contentX + Mcol;

  const layers: Layer[] = [
    { id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: expandFill(bg) } as unknown as Layer,
    { id: `${id}_panel`, type: 'rect', z: 1, x: panelX, y: Y, width: PW, height: H, fill: expandFill(panelFill as string | Fill) } as unknown as Layer,
  ];
  let k = 2;
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
  const bg = shStr(r['bg'], '#FAF5EC');
  const accent = shStr(r['accent'], '#B8543C');
  const textColor = shStr(r['text_color'] ?? r['color'], '#1A1A1A');
  const muted = shStr(r['muted'], '#6E5F4A');
  const kicker = shStr(r['kicker'] ?? r['eyebrow']);
  const title = shStr(r['title'] ?? r['headline'] ?? r['text']);
  const footer = shStr(r['footer']);
  const marker = shStr(r['marker'], 'number'); // number | bullet | icon | none
  const items = readListItems(r['items']);

  const M = Math.round(W * 0.08), cX = X + M, contentW = W - 2 * M;
  const layers: Layer[] = [{ id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: expandFill(bg) } as unknown as Layer];
  let k = 1, cy = Y + Math.round(H * 0.1);

  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, contentW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.019), font_weight: 600, color: accent, letter_spacing: 1.5, text_transform: 'uppercase' }));
    cy += Math.round(H * 0.04);
  }
  if (title) {
    const ts = Math.round(W * 0.07), th = estTextHeight(title, ts, contentW, 1.04);
    layers.push(txt(`${id}_title`, z + k++, cX, cy, contentW, th, title, { font_size: ts, font_weight: 800, color: textColor, line_height: 1.04 }));
    cy += th + Math.round(H * 0.018);
    layers.push({ id: `${id}_rule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy), width: contentW, height: 3, fill: { type: 'solid', color: textColor } } as unknown as Layer);
    layers.push({ id: `${id}_tick`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy) - 2, width: Math.round(W * 0.13), height: 7, fill: { type: 'solid', color: accent } } as unknown as Layer);
    cy += Math.round(H * 0.04);
  }

  const gutter = marker === 'none' ? 0 : Math.round(W * 0.085);
  const tX = cX + gutter, tW = contentW - gutter;
  const its = Math.round(W * 0.032), ds = Math.round(W * 0.0205), gapTD = Math.round(its * 0.4);
  const blocks = items.map((it) => {
    const tH = estTextHeight(it.title, its, tW, 1.12);
    const dH = it.desc ? estTextHeight(it.desc, ds, tW, 1.4) : 0;
    return { it, tH, dH, h: tH + (it.desc ? gapTD + dH : 0) };
  });
  const bottomM = footer ? Math.round(H * 0.1) : Math.round(H * 0.06);
  const avail = (Y + H - bottomM) - cy;
  const sumH = blocks.reduce((a, b) => a + b.h, 0);
  const n = blocks.length;
  const gap = n > 1 ? Math.max(Math.round(H * 0.022), Math.min(Math.round(H * 0.06), (avail - sumH) / n)) : 0;

  blocks.forEach((b, i) => {
    if (marker === 'number') {
      const ms = Math.round(W * 0.042);
      layers.push(txt(`${id}_n${i}`, z + k++, cX, cy - Math.round(ms * 0.08), gutter, ms * 1.3, String(i + 1).padStart(2, '0'), { font_size: ms, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -1 }));
    } else if (marker === 'bullet') {
      layers.push({ id: `${id}_d${i}`, type: 'ellipse', z: z + k++, x: cX, y: Math.round(cy + b.tH * 0.28), width: Math.round(W * 0.018), height: Math.round(W * 0.018), fill: { type: 'solid', color: accent } } as unknown as Layer);
    } else if (marker === 'icon' && b.it.icon) {
      layers.push({ id: `${id}_i${i}`, type: 'icon', z: z + k++, x: cX, y: Math.round(cy), width: Math.round(W * 0.05), height: Math.round(W * 0.05), icon: b.it.icon, color: accent } as unknown as Layer);
    }
    layers.push(txt(`${id}_t${i}`, z + k++, tX, cy, tW, b.tH, b.it.title, { font_size: its, font_weight: 700, color: textColor, line_height: 1.12 }));
    if (b.it.desc) layers.push(txt(`${id}_b${i}`, z + k++, tX, cy + b.tH + gapTD, tW, b.dH, b.it.desc, { font_size: ds, font_weight: 400, color: muted, line_height: 1.4 }));
    cy += b.h + gap;
  });

  if (footer) {
    const fy = Y + H - Math.round(H * 0.07);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: fy, width: contentW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(txt(`${id}_footer`, z + k++, cX, fy + 14, contentW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Single-statistic focal poster — a huge dominant number (the ONE accent
// moment), a small kicker above, a one-line caption below, optional footer.
// Engine sizes the number to dominate and measures the caption, so the focal
// hierarchy is guaranteed. Removes the hand-placed big-number flail (the model
// can't see that its giant number overflowed or collided with the caption).
function buildStat(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const bg = shStr(r['bg'], '#0A0A0A');
  const accent = shStr(r['accent'], '#FF3D00');
  const textColor = shStr(r['text_color'] ?? r['color'], '#FAFAFA');
  const muted = shStr(r['muted'], '#9A9A9A');
  const kicker = shStr(r['kicker'] ?? r['label'] ?? r['eyebrow']);
  const stat = shStr(r['stat'] ?? r['value'] ?? r['number'] ?? r['title'] ?? r['text'], '0');
  const caption = shStr(r['caption'] ?? r['subtitle'] ?? r['desc'] ?? r['body']);
  const footer = shStr(r['footer']);

  const M = Math.round(W * 0.08), cX = X + M, cW = W - 2 * M;
  const layers: Layer[] = [{ id: `${id}_bg`, type: 'rect', z: 0, x: X, y: Y, width: W, height: H, fill: expandFill(bg) } as unknown as Layer];

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
  let k = 1;
  if (kicker) {
    layers.push(txt(`${id}_kick`, z + k++, cX, cy, cW, 34, kicker, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.02), font_weight: 600, color: muted, letter_spacing: 2, text_transform: 'uppercase' }));
    cy += kickH;
  }
  layers.push(txt(`${id}_stat`, z + k++, cX, cy, cW, numH, stat, { font_size: numSize, font_weight: 800, color: accent, line_height: 1.0, letter_spacing: -2 }));
  cy += numH + (caption ? gap : 0);
  if (caption) {
    layers.push({ id: `${id}_caprule`, type: 'rect', z: z + k++, x: cX, y: Math.round(cy) - Math.round(gap * 0.4), width: Math.round(W * 0.13), height: 6, fill: { type: 'solid', color: accent } } as unknown as Layer);
    layers.push(txt(`${id}_cap`, z + k++, cX, cy + 14, cW, capH, caption, { font_size: capSize, font_weight: 400, color: textColor, line_height: 1.4 }));
  }
  if (footer) {
    const fy = Y + H - Math.round(H * 0.07);
    layers.push({ id: `${id}_frule`, type: 'rect', z: z + k++, x: cX, y: fy, width: cW, height: 2, fill: { type: 'solid', color: muted } } as unknown as Layer);
    layers.push(txt(`${id}_footer`, z + k++, cX, fy + 14, cW, 30, footer, { font_family: 'IBM Plex Mono', font_size: Math.round(W * 0.016), font_weight: 500, color: muted, letter_spacing: 1 }));
  }
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// ── Main expansion function ─────────────────────────────────
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
  if (Array.isArray(input)) return input.map(v => one(v));
  if (typeof input === 'object') {
    const obj = input as Record<string, unknown>;
    // A bare object that is itself ONE layer — it carries a layer type
    // (type/preset as a string) — not a {id: layer} dict. Without this, a model
    // that sends a single {preset:"feature_grid", title, items:[…]} object has
    // each key exploded into its own layer (title/items become stray texts).
    if (typeof obj['type'] === 'string' || typeof obj['preset'] === 'string') return [one(obj)];
    return Object.entries(obj).map(([id, v]) => one(v, id));
  }
  return [];
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
  // editorial / split / list layout presets
  'kicker', 'eyebrow', 'headline', 'lede', 'deck', 'body', 'desc', 'footer',
  'side', 'ratio', 'panel', 'panel_fill', 'panel_label', 'panel_text', 'big',
  'marker', 'heading', 'description', 'cards',
  'stat', 'number', 'caption',
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
        if (!hit) notes.push(`icon "${l.id}": "${name}" is not a known icon → renders as a labeled placeholder. Use a real name, e.g.: ${SUGGESTED_ICONS}.`);
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
      } else if (l.type === 'group') {
        walk((l as Layer & { layers?: Layer[] }).layers);
      }
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

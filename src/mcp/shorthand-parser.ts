import type { Layer, Fill, TextContent, TextStyle } from '../schema/types';
import { resolveIconName } from '../renderer/lucide-icons';

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
function expandFill(fill: string | Fill): Fill {
  if (typeof fill === 'string') {
    const css = parseCssGradient(fill);
    if (css) return css;
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
    if (it.icon) kids.push({ id: `${id}_c${i}_icon`, type: 'icon', z: 0, x: 0, y: 0, width: 60, height: 60, name: it.icon, size: 60, color: accent } as unknown as Layer);
    if (it.title) kids.push({ id: `${id}_c${i}_title`, type: 'text', z: 1, x: 0, y: 0, width: cardW - 60, height: 90,
      content: { type: 'plain', value: it.title }, style: { font_size: 30, font_weight: 700, color: textColor, align: 'center' } } as unknown as Layer);
    if (it.desc) kids.push({ id: `${id}_c${i}_desc`, type: 'text', z: 2, x: 0, y: 0, width: cardW - 60, height: 110,
      content: { type: 'plain', value: it.desc }, style: { font_size: 21, color: muted, align: 'center' } } as unknown as Layer);
    return { id: `${id}_card${i}`, type: 'auto_layout', z: i, x: 0, y: 0, width: cardW, height: rowH, direction: 'column',
      gap: 16, padding: 28, align_items: 'center', justify_content: 'center', radius: 18,
      fill: expandFill(cardFill), layers: kids } as unknown as Layer;
  });
  layers.push({ id: `${id}_row`, type: 'auto_layout', z: 10, x: X + M, y: Y + rowY, width: W - 2 * M, height: rowH,
    direction: 'row', gap, justify_content: 'space-between', align_items: 'stretch', layers: cards } as unknown as Layer);
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
      return {
        ...base,
        type: 'circle',
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
  'feature_grid', 'cards', 'card_grid', 'features',
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
  // auto_layout / container
  'direction', 'gap', 'padding', 'justify', 'wrap', 'repeat', 'children', 'valign',
  'corner_radius', 'cornerRadius', 'borderRadius',
  // chart / kpi_card / component
  'chart', 'data', 'spec', 'value', 'label', 'delta', 'format', 'ref', 'slots', 'variant', 'overrides',
  // feature_grid preset
  'items', 'features', 'title', 'subtitle', 'card_fill', 'accent', 'text_color', 'muted', 'bg', 'columns',
  'preset', 'bg_gradient', 'benefit',
  // aliases (verbose + terse)
  'content', 'font_size', 'fontSize', 'symbol', 'glyph', 'url', 'href',
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
    if (unknown.length) notes.push(`layer "${sh.id ?? i}": unrecognized field(s) [${unknown.join(', ')}] were ignored. Shorthand fields: pos, type, fill, text, size, color, src, icon (verbose content/font_size/symbol/url and terse p/t/f/w/h/c/s/col are accepted).`);
  });
  return notes;
}

// A few popular icon names to offer when a model picks one that doesn't exist.
const SUGGESTED_ICONS = 'image, star, heart, check, arrow-right, user, mail, calendar, clock, zap, award, map-pin, phone, shopping-cart';

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
      } else if (l.type === 'group') {
        walk((l as Layer & { layers?: Layer[] }).layers);
      }
    }
  };
  walk(layers);
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

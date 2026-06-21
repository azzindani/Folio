// Folio shorthand parser — shorthand expansion, coercion & normalization. Split from shorthand-parser.ts; verbatim bodies.
import yaml from 'js-yaml';
import type { Layer, TextContent, TextStyle } from '../schema/types';

import { shapePath, type ShapeName, type ShapeBox } from '../engine/shape-paths';

import { shStr, ShorthandLayer, expandPosition, expandFill, expandStroke, mapAlignItems, mapJustify, textTypography, chartColorFields, connectorFields } from './shorthand-helpers';
import { buildChartSpec, buildFeatureGrid, buildDecor, buildEditorial, buildSplit } from './shorthand-presets-a';
import { buildList, buildStat, buildEvent, buildSections } from './shorthand-presets-b';
import { buildPricing, buildVersus } from './shorthand-presets-c';
import { buildTimeline } from './shorthand-presets-seq';
import { buildMindmap } from './shorthand-presets-map';
import { buildDoodles } from './shorthand-doodles';
import { buildRibbonCards, buildValueList } from './shorthand-presets-cards';
import { buildNewsletter } from './shorthand-presets-news';

import { motifLayers } from './shorthand-background';

export function expandShorthand(sh: ShorthandLayer): Layer {
  const pos = expandPosition(sh);
  const base: Record<string, unknown> = {
    id: sh.id,
    z: sh.z,
    ...pos,
  };
  if (sh.opacity   !== undefined) base['opacity']   = sh.opacity;
  const rot = sh.rotation ?? sh.rotate ?? sh.angle; // accept the CSS-style aliases models reach for
  if (rot          !== undefined) base['rotation']  = rot;
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

    case 'connector':  // renderer-side type (outside LayerType) → endpoints/arrow + bbox, cast via unknown
      return { ...base, type: 'connector', ...connectorFields(sh) } as unknown as Layer;

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

    case 'timeline':
    case 'roadmap':
    case 'history':
    case 'milestones':
      return buildTimeline(sh, String(sh.id ?? 'timeline'), typeof sh.z === 'number' ? sh.z : 0);

    case 'mindmap': case 'mind_map': case 'brainstorm': case 'concept_map': case 'process_cards':
      return buildMindmap(sh, String(sh.id ?? 'mindmap'), typeof sh.z === 'number' ? sh.z : 0);

    case 'pricing':
    case 'plans':
    case 'tiers':
    case 'price_table':
      return buildPricing(sh, String(sh.id ?? 'pricing'), typeof sh.z === 'number' ? sh.z : 0);

    case 'versus':
    case 'compare':
    case 'comparison':
    case 'vs':
      return buildVersus(sh, String(sh.id ?? 'versus'), typeof sh.z === 'number' ? sh.z : 0);

    case 'decor':
    case 'marble_bg':
    case 'backdrop':
      return buildDecor(sh, String(sh.id ?? 'decor'), typeof sh.z === 'number' ? sh.z : 0);

    case 'doodles': case 'scatter': case 'confetti':
      return buildDoodles(sh, String(sh.id ?? 'doodles'), typeof sh.z === 'number' ? sh.z : 0);

    case 'ribbon_cards': case 'tip_cards': case 'ribbon':
      return buildRibbonCards(sh, String(sh.id ?? 'ribbon_cards'), typeof sh.z === 'number' ? sh.z : 0);

    case 'value_list': case 'values': case 'tips_list':
      return buildValueList(sh, String(sh.id ?? 'value_list'), typeof sh.z === 'number' ? sh.z : 0);

    case 'newsletter': case 'bulletin': case 'digest':
      return buildNewsletter(sh, String(sh.id ?? 'newsletter'), typeof sh.z === 'number' ? sh.z : 0);

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
        ...chartColorFields(sh), // optional bar/track/label/value colors for hand-placed (rasterized) charts
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

export const KNOWN_SHORTHAND_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'text', 'line', 'icon', 'path', 'polygon', 'image', 'mermaid', 'code', 'math', 'group',
  'auto_layout', 'row', 'column', 'stack', 'grid', 'chart', 'kpi_card', 'component',
  'feature_grid', 'cards', 'card_grid', 'features', 'decor', 'marble_bg', 'backdrop',
]);

// Parse a compact layer string a small model tends to emit, e.g.
// "text:[200,200,800,200]:BREWED TO PERFECTION", "pos:[0,0,1080,1080]", or
// "rect:[0,0,100,100]". Pulls out pos, an explicit type prefix (ignoring a
// literal "pos:" lead), and trailing text. Type is left for inference when the
// prefix isn't a known type.

export function parseCompactLayer(s: string): ShorthandLayer {
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

export function closeJsonString(s: string): string {
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

export function lenientParseLayers(s: string): unknown {
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

export const CONTAINER_TYPES = new Set(['poster', 'page', 'slide', 'document', 'carousel', 'design']);

export const FILENAME_RE = /\.(?:design\.)?ya?ml$|\.(?:png|jpe?g|svg|pdf|json)$/i;

export function isStrayContainerLayer(r: Record<string, unknown>): boolean {
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

export function pruneStrayMeta(arr: ShorthandLayer[]): ShorthandLayer[] {
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

export function normalizeShorthandAliases(sh: ShorthandLayer): ShorthandLayer {
  const out: ShorthandLayer = { ...sh };
  const r = out as Record<string, unknown>;
  // Terse single-/short-char keys small models emit to save tokens
  // (p/t/f/w/h/col). Canonical key wins when already present.
  const alias = (canonical: string, ...keys: string[]): void => {
    if (r[canonical] !== undefined) return;
    for (const k of keys) if (r[k] !== undefined) { r[canonical] = r[k]; return; }
  };
  // Verbose/canonical layers nest styling under `style:{}` — the schema shape a
  // model learns from inspect_design output or the docs, then reasonably sends
  // through `layers_shorthand`. The shorthand expander reads FLAT fields, so an
  // un-lifted `style` silently DROPS every color/font/weight/align: the text
  // then defaults to a flat `$text` with one size and no accent, and the whole
  // poster reads as blank/undesigned (live blind-model failure). Lift the
  // recognized style props to the top level (an explicit flat field still wins).
  const st = r['style'];
  if (st && typeof st === 'object' && !Array.isArray(st)) {
    const s = st as Record<string, unknown>;
    const lift = (canonical: string, ...keys: string[]): void => {
      if (r[canonical] !== undefined) return;
      for (const k of keys) if (s[k] !== undefined) { r[canonical] = s[k]; return; }
    };
    lift('color', 'color');
    lift('font', 'font', 'font_family', 'fontFamily');
    lift('size', 'size', 'font_size', 'fontSize');
    lift('weight', 'weight', 'font_weight', 'fontWeight');
    lift('align', 'align', 'text_align', 'textAlign');
    lift('line_height', 'line_height', 'lineHeight', 'lh', 'leading');
    lift('letter_spacing', 'letter_spacing', 'letterSpacing', 'track', 'tracking');
    // Craft fields the text expander's typography reader also checks flat.
    for (const k of ['text_transform', 'uppercase', 'italic', 'font_style', 'text_decoration', 'underline', 'highlight', 'outline', 'outline_color', 'outline_width', 'word_spacing']) {
      if (r[k] === undefined && s[k] !== undefined) r[k] = s[k];
    }
  }
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

export function inferLayerType(sh: ShorthandLayer): string {
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

export const FILLABLE_SHAPES = new Set(['rect', 'circle', 'ellipse', 'polygon']);

// Give an under-specified layer visible, theme-aware styling so a small model's
// bare {pos,text} layers don't render blank (invisible black 16px text on the
// dark default theme, or an unfilled — transparent — background rect). Uses
// theme color tokens ($text/$surface) so it adapts to whatever theme is active,
// and sizes text relative to its box. Never overrides values the model gave.

export function applyVisibleDefaults(sh: ShorthandLayer, type: string): ShorthandLayer {
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

export const REPEAT_CAP = 200; // backstop against a runaway repeat count

// Deep-substitute {{key}} tokens in every string field (recursing into nested
// layers) with values from a data row. Used by repeat with a data array.

export function substituteTokens(sh: ShorthandLayer, data: Record<string, unknown>): ShorthandLayer {
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

export function expandRepeats(layers: ShorthandLayer[]): ShorthandLayer[] {
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

import type { Layer, Fill, TextContent, TextStyle } from '../schema/types';

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
  d?: string;
  sides?: number;
  x1?: number; y1?: number; x2?: number; y2?: number;
  definition?: string;
  code?: string;
  language?: string;
  expression?: string;
  layers?: ShorthandLayer[];
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
    return { type: 'solid', color: fill };
  }
  return fill;
}

// ── Expand stroke shorthand ─────────────────────────────────
function expandStroke(stroke: string | { color: string; width: number }): { color: string; width: number } {
  if (typeof stroke === 'string') {
    return { color: stroke, width: 2 };
  }
  return stroke;
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

    case 'icon':
      return {
        ...base,
        type: 'icon',
        name: sh.icon ?? sh.text ?? 'circle',
        size: sh.icon_size ?? sh.size ?? 24,
        color: sh.color,
      } as Layer;

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
        layers: (sh.layers ?? []).map(expandShorthand),
      } as Layer;

    default:
      // Pass through as-is for unknown types
      return { ...base, type: sh.type } as unknown as Layer;
  }
}

// Layer types the compact-string parser recognizes as an explicit prefix.
const KNOWN_SHORTHAND_TYPES = new Set([
  'rect', 'circle', 'ellipse', 'text', 'line', 'icon', 'path', 'polygon', 'image', 'mermaid', 'code', 'math', 'group',
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
  if (typeof input === 'object') return Object.entries(input as Record<string, unknown>).map(([id, v]) => one(v, id));
  return [];
}

// Infer a layer type from the fields a small model actually provided, for when
// it omits `type` (a common failure: it emits {pos, text} and expects "text").
function inferLayerType(sh: ShorthandLayer): string {
  if (sh.text !== undefined) return 'text';
  if (sh.src !== undefined) return 'image';
  if (sh.icon !== undefined) return 'icon';
  if (sh.d !== undefined) return 'path';
  if ((sh as Record<string, unknown>)['x1'] !== undefined) return 'line';
  return 'rect'; // a positioned box is the safe default
}

export function expandShorthandLayers(layers: ShorthandLayer[]): Layer[] {
  // Small models frequently omit the required id/type/z on shorthand layers.
  // Rather than reject the whole call, infer type from the fields, auto-assign
  // a unique id, and default z to stacking order — so the design still renders.
  const seen = new Set<string>();
  for (const l of layers) if (l.id) seen.add(l.id);
  return layers.map((sh, i) => {
    const type = sh.type ?? inferLayerType(sh);
    let id = sh.id;
    if (!id) {
      let n = i + 1;
      id = `${type}_${n}`;
      while (seen.has(id)) { n++; id = `${type}_${n}`; }
      seen.add(id);
    }
    return expandShorthand({ ...sh, id, type, z: sh.z ?? i });
  });
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

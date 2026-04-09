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
  id: string;
  type: string;
  z: number;
  pos?: [number, number, number, number];
  x?: number;
  y?: number;
  width?: number | 'auto';
  height?: number | 'auto';
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
  const base = {
    id: sh.id,
    z: sh.z,
    ...pos,
  };

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

export function expandShorthandLayers(layers: ShorthandLayer[]): Layer[] {
  return layers.map(expandShorthand);
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

/**
 * patch_design routing — a path naming a field the renderer never reads on that
 * layer is sent to the field that renders.
 *
 * A stored layer keeps its typography in `style`, its words in `content.value`
 * and an icon's glyph in `name`. A patch path written the natural way lands
 * BESIDE them: `layers[0].layers[6].letter_spacing` set a key nothing reads, the
 * reply said "4 field(s) patched", and nothing moved. The first benchmark run
 * hit it twice (tracking on four headlines; an icon swap on `.icon`), and both
 * models rebuilt whole slides to get round it. edit_layer's canonicalizeProps
 * already fixes the same disagreement for `update`; this is that rule at the
 * patch door.
 */
import { FLAT_TEXT_STYLE_KEYS } from '../../schema/validator';
import { tokenizePath, descend } from '../engine-runtime-tools';

/** Flat authoring alias → the canonical `style` key it belongs in. */
export const TYPO_ALIASES: readonly (readonly [string, readonly string[]])[] = [
  ['font_size', ['font_size', 'size', 'fontSize']],
  ['font_family', ['font_family', 'font', 'fontFamily']],
  ['font_weight', ['font_weight', 'weight', 'fontWeight']],
  ['color', ['color']],
  ['text_align', ['text_align', 'align', 'textAlign']],
  ['line_height', ['line_height', 'lineHeight', 'leading', 'lh']],
  ['letter_spacing', ['letter_spacing', 'letterSpacing', 'tracking', 'track']],
];

/** The `style` key a flat text-layer key belongs in, if it is typography. */
function styleKeyFor(key: string): string | undefined {
  for (const [canonical, keys] of TYPO_ALIASES) if (keys.includes(key)) return canonical;
  return (FLAT_TEXT_STYLE_KEYS as readonly string[]).includes(key) ? key : undefined;
}

/** Field (relative to the layer) that renders what `key` asks for, or undefined when `key` is already it. */
function renderedField(layer: Record<string, unknown>, key: string): string | undefined {
  const type = layer['type'];
  if (type === 'icon') return key === 'icon' || key === 'symbol' ? 'name' : undefined;
  if (type !== 'text' && type !== 'rich_text') return undefined;
  if (key === 'text') {
    const c = layer['content'];
    if (c === undefined) return undefined;                 // no content: the renderer reads `text`
    return c && typeof c === 'object' && !Array.isArray(c) ? 'content.value' : 'content';
  }
  const s = styleKeyFor(key);
  return s ? `style.${s}` : undefined;
}

export interface PatchRoute {
  /** Path to write. */
  path: string;
  /** The path as asked, when it was routed. */
  from?: string;
}

/**
 * Route one patch path. Only a trailing KEY on a text, rich_text or icon layer
 * is ever rewritten; every other path passes through untouched. Routing into a
 * missing `style` creates it on `spec`, so the write that follows lands.
 */
export function routePatchPath(spec: Record<string, unknown>, dotPath: string): PatchRoute {
  const toks = tokenizePath(dotPath);
  const last = toks[toks.length - 1];
  if (toks.length < 2 || last.kind !== 'key' || !dotPath.endsWith(`.${last.key}`)) return { path: dotPath };
  let cur: unknown = spec;
  for (const t of toks.slice(0, -1)) {
    cur = descend(cur, t);
    if (cur == null || typeof cur !== 'object') return { path: dotPath };
  }
  if (Array.isArray(cur)) return { path: dotPath };
  const layer = cur as Record<string, unknown>;
  const field = renderedField(layer, last.key);
  if (!field) return { path: dotPath };
  if (field.startsWith('style.')) {
    const st = layer['style'];
    if (!st || typeof st !== 'object' || Array.isArray(st)) layer['style'] = {};
  }
  return { path: `${dotPath.slice(0, -(last.key.length + 1))}.${field}`, from: dotPath };
}

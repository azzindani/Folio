// Folio MCP — authored-spec round-trip.
//
// A preset is written as INTENT ({type:"sections", title, blocks:[…], accent})
// and stored as RESULT (a group of ~30 positioned rects and text layers). The
// intent was thrown away at expansion, so a later session asking "make it three
// blocks, not five" or "switch the accent" had two bad options: hand-edit thirty
// generated layers, or rebuild the page from scratch and lose everything else
// about it. Design and code drifted apart in one direction, with no way back.
//
// This module keeps the source next to the output. Every preset group carries
// the spec that produced it, so the loop closes:
//
//     get_spec  →  patch_spec  →  re-render      (the same design, evolved)
//
// instead of
//
//     read 30 layers  →  guess which ones matter  →  rebuild   (a new design)
//
// Two fields, deliberately separate:
//   _spec      what the MODEL wrote — the only thing get_spec returns, and the
//              only thing patch_spec merges into. Round-trippable by itself.
//   _spec_env  what the ENGINE stamped (page-fill, fixed canvas, deck seed) —
//              context, not intent. Re-applied on re-expansion so a patched
//              slide lands in the same world the original did, but never shown
//              to the model as if it had authored it.
//
// Fidelity rule: re-expanding an unchanged _spec must reproduce the same tree.
// Expansion is already deterministic (no Math.random / Date.now in the render
// path — CLAUDE.md §0.3; preset variants seed from content), so this holds and
// is enforced by test.
import type { Layer } from '../schema/types';

import type { ShorthandLayer } from './shorthand-helpers';

/** Field holding the model-authored spec on an expanded preset group. */
export const SPEC_FIELD = '_spec';
/** Field holding the engine-stamped expansion context. */
export const SPEC_ENV_FIELD = '_spec_env';

/** Engine markers: stamped by the engine, never authored by the model. */
const ENV_KEYS = ['__fillPage', '__fixedCanvas', '__variant', '__deckseed'] as const;

/** One preset's authored spec, as get_spec returns it. */
export interface SpecEntry {
  /** Layer id of the preset group in the design. */
  layer_id: string;
  /** Preset type as authored ("sections", "versus", …). */
  type: string;
  /** Page this preset lives on, for a paged design. */
  page_id?: string;
  /** The spec the model wrote. */
  spec: Record<string, unknown>;
}

// ── Attach ──────────────────────────────────────────────────

/** Split an authored shorthand into intent and engine context. */
function splitSpec(sh: ShorthandLayer): { spec: Record<string, unknown>; env: Record<string, unknown> } {
  const spec: Record<string, unknown> = {};
  const env: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(sh as Record<string, unknown>)) {
    if (v === undefined) continue;
    // __theme is re-resolved from the design on every expansion, so storing it
    // would duplicate the whole palette on every slide of a deck for nothing.
    if (k === '__theme') continue;
    if ((ENV_KEYS as readonly string[]).includes(k)) { env[k] = v; continue; }
    if (k.startsWith('__')) continue;
    spec[k] = v;
  }
  return { spec, env };
}

/** Record the spec that produced this preset group, on the group itself.
 *  Non-preset layers are returned untouched — a rect IS its own source. */
export function attachAuthoredSpec(sh: ShorthandLayer, layer: Layer, isPreset: boolean): Layer {
  if (!isPreset) return layer;
  const o = layer as unknown as Record<string, unknown>;
  if (o['type'] !== 'group') return layer;
  const { spec, env } = splitSpec(sh);
  o[SPEC_FIELD] = spec;
  if (Object.keys(env).length) o[SPEC_ENV_FIELD] = env;
  return layer;
}

// ── Read ────────────────────────────────────────────────────

/** Every authored spec in a layer tree, in document order. Sparse by design:
 *  the whole point is to answer "what is this page made of" without shipping
 *  the expanded tree. */
export function collectAuthoredSpecs(layers: Layer[], pageId?: string, out: SpecEntry[] = []): SpecEntry[] {
  for (const l of layers) {
    const o = l as unknown as Record<string, unknown>;
    const spec = o[SPEC_FIELD];
    if (spec && typeof spec === 'object' && !Array.isArray(spec)) {
      const s = spec as Record<string, unknown>;
      out.push({
        layer_id: String(o['id'] ?? ''),
        type: String(s['type'] ?? 'unknown'),
        ...(pageId ? { page_id: pageId } : {}),
        spec: s,
      });
      continue;                                   // a preset's children are output, not source
    }
    const kids = o['layers'];
    if (Array.isArray(kids)) collectAuthoredSpecs(kids as Layer[], pageId, out);
  }
  return out;
}

/** Find one preset group by layer id, anywhere in the tree. */
export function findSpecLayer(layers: Layer[], layerId: string): Layer | null {
  for (const l of layers) {
    const o = l as unknown as Record<string, unknown>;
    if (o['id'] === layerId && o[SPEC_FIELD]) return l;
    const kids = o['layers'];
    if (Array.isArray(kids)) {
      const hit = findSpecLayer(kids as Layer[], layerId);
      if (hit) return hit;
    }
  }
  return null;
}

// ── Patch ───────────────────────────────────────────────────

/** Merge `changes` into `spec`.
 *
 *  - a plain object merges KEY BY KEY, so {accent:"#0F0"} changes the accent
 *    and leaves the twelve other fields alone — the whole point of patching
 *    rather than re-sending;
 *  - an ARRAY replaces wholesale, because "blocks" is one ordered thing and a
 *    positional merge of two different-length lists is never what was meant;
 *  - `null` DELETES a key, so a field can be returned to its engine default
 *    (there is otherwise no way to say "stop overriding this"). */
export function mergeSpecChanges(spec: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...spec };
  for (const [k, v] of Object.entries(changes)) {
    if (v === null) { delete out[k]; continue; }
    const cur = out[k];
    const bothPlain = cur && typeof cur === 'object' && !Array.isArray(cur)
      && v && typeof v === 'object' && !Array.isArray(v);
    out[k] = bothPlain
      ? mergeSpecChanges(cur as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
}

/** Rebuild the shorthand to re-expand: the patched spec, the engine context it
 *  was originally expanded in, and the theme resolved fresh from the design. */
export function toShorthand(spec: Record<string, unknown>, env: Record<string, unknown> | undefined, theme: unknown): ShorthandLayer {
  const sh: Record<string, unknown> = { ...spec, ...(env ?? {}) };
  if (theme !== undefined && sh['__theme'] === undefined) sh['__theme'] = theme;
  return sh as unknown as ShorthandLayer;
}

/** Replace a layer in a tree, in place, keeping its position in z-order.
 *  Returns false when the id isn't there. */
export function replaceLayer(layers: Layer[], layerId: string, next: Layer): boolean {
  for (let i = 0; i < layers.length; i++) {
    const o = layers[i] as unknown as Record<string, unknown>;
    if (o['id'] === layerId) { layers[i] = next; return true; }
    const kids = o['layers'];
    if (Array.isArray(kids) && replaceLayer(kids as Layer[], layerId, next)) return true;
  }
  return false;
}

// ── Drift ───────────────────────────────────────────────────
// A patch REGENERATES the group from its spec, so anything done to the
// generated layers since — a hand-edited headline, a deleted row — is
// discarded. That is correct (the spec is the source) but it must never be
// silent. The check compares only what a person would call material: how many
// layers there are and what they SAY. Colour and position are excluded on
// purpose — the engine's own rescue passes re-light and reflow layers after
// expansion, and flagging that would make the warning fire on every patch and
// teach the model to ignore it.

/** Layer count + every text value in a subtree — a signature stable against
 *  the engine's own post-expansion passes but sensitive to real edits. */
export function contentSignature(layer: Layer): { count: number; text: string[] } {
  const text: string[] = [];
  let count = 0;
  const walk = (l: Layer): void => {
    count++;
    const o = l as unknown as Record<string, unknown>;
    const c = o['content'];
    const v = typeof c === 'string' ? c : (c && typeof c === 'object' ? (c as Record<string, unknown>)['value'] : undefined);
    if (typeof v === 'string' && v.trim()) text.push(v.trim());
    const kids = o['layers'];
    if (Array.isArray(kids)) for (const k of kids as Layer[]) walk(k);
  };
  const kids = (layer as unknown as Record<string, unknown>)['layers'];
  if (Array.isArray(kids)) for (const k of kids as Layer[]) walk(k);
  return { count, text: text.sort() };
}

/** How the layers on disk differ from what this spec produces today, or null
 *  when they still agree. */
export function describeDrift(current: Layer, fresh: Layer): string | null {
  const a = contentSignature(current), b = contentSignature(fresh);
  const sameText = a.text.length === b.text.length && a.text.every((t, i) => t === b.text[i]);
  if (a.count === b.count && sameText) return null;
  const gone = a.text.filter(t => !b.text.includes(t)).slice(0, 3);
  return `the layers on disk no longer match this spec (${a.count} layer(s) now vs ${b.count} from the spec`
    + `${gone.length ? `; text only on disk: ${gone.map(t => `"${t.slice(0, 40)}"`).join(', ')}` : ''}). `
    + 'Someone edited the generated layers directly. Patching REGENERATES them from the spec, so those edits are gone — fold them into the spec instead, or use edit_layer {op:"update"} to keep working on the layers.';
}

/** What changed between two specs — reported so a patch is auditable rather
 *  than a silent overwrite. */
export function diffSpecKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changed: string[] = [];
  for (const k of keys) {
    const a = JSON.stringify(before[k] ?? null);
    const b = JSON.stringify(after[k] ?? null);
    if (a === b) continue;
    changed.push(!(k in after) ? `-${k}` : !(k in before) ? `+${k}` : `~${k}`);
  }
  return changed.sort();
}

// Folio shorthand — turning whatever the model actually sent into layers.
//
// Split out of shorthand-expand.ts, which had grown past the 700-line ceiling.
// This half never expands anything: it takes the shapes a model reaches for
// when it does not follow the documented one — a JSON string of the whole
// array, a dict of id → compact string, a single bare preset object, a
// truncated blob missing its closing braces — and returns a ShorthandLayer[].
//
// It is where the silent-blank-design bugs live, so every branch here has a
// failure behind it. shorthand-expand.ts re-exports the lot, so callers that
// import from there are unchanged.
import yaml from 'js-yaml';

import { type ShorthandLayer } from './shorthand-helpers';

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

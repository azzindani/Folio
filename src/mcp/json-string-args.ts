// Decode object and array arguments that arrive as JSON strings.
//
// Found live (2026-09-14): a client whose cached tool list predated
// animation(op:scene) had no schema for `transition`, so it sent the object as
// a string — `"{\"type\": \"slide-left\", …}"` — and the op read the whole
// string as a transition NAME and refused it. Models that JSON-encode nested
// arguments produce the same shape against an up-to-date schema. It is not one
// op's problem: `steps`, `keyframes`, `playback`, `layers` and every other
// structured argument had the same door.
//
// The decision is DERIVED from the registries, like required-args: a string is
// decoded only where the published inputSchema says the argument is an object
// or an array, and only when it parses to exactly that. Anything else passes
// through untouched, so the op still reports a genuinely bad value itself.
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';

type Args = Record<string, unknown>;
type Shape = 'object' | 'array';

/** tool name → argument name → the structured shape its schema declares. */
const STRUCTURED: Record<string, Map<string, Shape>> = Object.fromEntries(
  [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS].map(t => {
    const props = (t as { inputSchema?: { properties?: Record<string, { type?: unknown }> } }).inputSchema?.properties ?? {};
    const shapes = new Map<string, Shape>();
    for (const [key, prop] of Object.entries(props)) {
      if (prop?.type === 'object' || prop?.type === 'array') shapes.set(key, prop.type);
    }
    return [t.name, shapes];
  }),
);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Args with every JSON-string object/array argument decoded. The input is never mutated. */
export function decodeJsonStringArgs(tool: string, args: Args): Args {
  const shapes = STRUCTURED[tool];
  if (!shapes || shapes.size === 0) return args;
  let out = args;
  for (const [key, shape] of shapes) {
    const raw = args[key];
    if (typeof raw !== 'string') continue;
    const text = raw.trim();
    if (!text.startsWith(shape === 'object' ? '{' : '[')) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { continue; }
    if (shape === 'object' ? !isPlainObject(parsed) : !Array.isArray(parsed)) continue;
    if (out === args) out = { ...args };
    out[key] = parsed;
  }
  return out;
}

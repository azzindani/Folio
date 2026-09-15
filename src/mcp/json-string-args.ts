// Decode arguments that arrive as strings when their schema says otherwise.
//
// Found live (2026-09-14): a client whose cached tool list predated
// animation(op:scene) had no schema for `transition`, so it sent the object as
// a string — `"{\"type\": \"slide-left\", …}"` — and the op read the whole
// string as a transition NAME and refused it. Models that JSON-encode nested
// arguments produce the same shape against an up-to-date schema. It is not one
// op's problem: `steps`, `keyframes`, `playback`, `layers` and every other
// structured argument had the same door.
//
// Found live again (2026-09-15), one type further down: the same kind of client
// sent op:wiggle's `frequency: 3` as "3" and op:text's `mask: true` as "true".
// Nothing decoded scalars, so a `typeof === 'number'` check failed and the
// wiggle ran at its default while replying as if all was well, and op:morph's
// `delay` stayed "700" until its next_action added 450 to it — t: 700450.
//
// The decision is DERIVED from the registries, like required-args: a string is
// decoded only where the published inputSchema declares an object, an array, a
// number (or integer) or a boolean, and only when it parses to exactly that.
// Anything else passes through untouched, so the op still reports a genuinely
// bad value itself.
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';

type Args = Record<string, unknown>;
type Shape = 'object' | 'array' | 'number' | 'boolean';

/** tool name → argument name → the non-string type its schema declares. */
const DECLARED: Record<string, Map<string, Shape>> = Object.fromEntries(
  [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS].map(t => {
    const props = (t as { inputSchema?: { properties?: Record<string, { type?: unknown }> } }).inputSchema?.properties ?? {};
    const shapes = new Map<string, Shape>();
    for (const [key, prop] of Object.entries(props)) {
      const type = prop?.type;
      if (type === 'object' || type === 'array' || type === 'number' || type === 'boolean') shapes.set(key, type);
      else if (type === 'integer') shapes.set(key, 'number');
    }
    return [t.name, shapes];
  }),
);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const NUMERIC = /^-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i;

/** The value a string stands for under a declared shape, or undefined when it is not exactly that. */
function decode(text: string, shape: Shape): { value: unknown } | undefined {
  if (shape === 'number') return NUMERIC.test(text) ? { value: Number(text) } : undefined;
  if (shape === 'boolean') return text === 'true' ? { value: true } : text === 'false' ? { value: false } : undefined;
  if (!text.startsWith(shape === 'object' ? '{' : '[')) return undefined;
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return undefined; }
  return (shape === 'object' ? isPlainObject(parsed) : Array.isArray(parsed)) ? { value: parsed } : undefined;
}

/** Args with every string argument decoded to the type its schema declares. The input is never mutated. */
export function decodeJsonStringArgs(tool: string, args: Args): Args {
  const shapes = DECLARED[tool];
  if (!shapes || shapes.size === 0) return args;
  let out = args;
  for (const [key, shape] of shapes) {
    const raw = args[key];
    if (typeof raw !== 'string') continue;
    const decoded = decode(raw.trim(), shape);
    if (!decoded) continue;
    if (out === args) out = { ...args };
    out[key] = decoded.value;
  }
  return out;
}

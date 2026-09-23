// tasks {op:"execute"} — a chain of Folio tool calls, as DATA, in one call.
//
// A model that scripts can chain anything, but slowly and unversioned; a flat
// tool surface is fast and validated but one call does one thing, so a long
// build is twenty round-trips and the model stops early. This runs the chain
// server-side through the SAME door every MCP call uses (the handler map:
// JSON-string decoding, the required-argument check, path normalisation, one
// lineage record per write), so a step behaves exactly as if it had been sent
// on its own — only the round-trips are gone.
//
// A step names a tool and its args; `as` keeps its result under a name, and any
// string in a later step may read it: "${made.design_path}". A whole-string ref
// passes the value through with its type (an array stays an array). The chain
// stops at the first step that fails and says which, with every result so far.
import type { ToolResult, NextAction } from '../types';
import { okResult, errResult, buildContext, pOk, pWarn } from './utils';
import { normalizeProjectPaths } from '../normalize-paths';
import { withOpScope } from '../design-lineage';

type Rec = Record<string, unknown>;
type Runner = (args: Rec) => ToolResult | Promise<ToolResult>;

export interface Step { tool: string; args?: Rec; as?: string }

export const MAX_STEPS = 50;
/** Keys of a result kept in a step's summary — the rest stays reachable by ref. */
const DROP = new Set(['progress', 'context', 'handover', 'token_estimate', 'next_action', 'suggested_next']);

let handlers: Record<string, Runner> | null = null;

/** handlers.ts hands over its map once built — importing it here would be a cycle. */
export function bindStepHandlers(map: Record<string, Runner>): void {
  handlers = map;
}

/** Read a dotted path out of the results so far: "made.design_path", "list.designs.0.path". */
export function lookup(results: Record<string, Rec>, ref: string): unknown {
  const [head, ...rest] = ref.split('.');
  let v: unknown = head !== undefined ? results[head] : undefined;
  for (const k of rest) v = v !== null && typeof v === 'object' ? (v as Rec)[k] : undefined;
  return v;
}

const WHOLE = /^\$\{([\w.-]+)\}$/;
const INLINE = /\$\{([\w.-]+)\}/g;

/** Substitute refs in any string of a value, recursively. Unknown refs are collected, not guessed. */
export function resolveRefs(v: unknown, results: Record<string, Rec>, missing: string[]): unknown {
  if (typeof v === 'string') {
    const whole = WHOLE.exec(v);
    if (whole?.[1]) {
      const got = lookup(results, whole[1]);
      if (got === undefined) missing.push(whole[1]);
      return got ?? v;
    }
    return v.replace(INLINE, (m, ref: string) => {
      const got = lookup(results, ref);
      if (got === undefined) { missing.push(ref); return m; }
      return typeof got === 'string' ? got : JSON.stringify(got);
    });
  }
  if (Array.isArray(v)) return v.map(x => resolveRefs(x, results, missing));
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(Object.entries(v as Rec).map(([k, x]) => [k, resolveRefs(x, results, missing)]));
  }
  return v;
}

/** A step's reply, small: its scalars, and arrays as counts. */
export function summarize(r: ToolResult): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(r as unknown as Rec)) {
    if (DROP.has(k) || v === undefined) continue;
    if (Array.isArray(v)) out[k] = `${v.length} item(s)`;
    else if (v === null || typeof v !== 'object') out[k] = typeof v === 'string' && v.length > 200 ? `${v.slice(0, 200)}…` : v;
  }
  return out;
}

/** Every ref a value makes, by its head name. */
export function refHeads(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') for (const m of v.matchAll(INLINE)) out.push((m[1] ?? '').split('.')[0] ?? '');
  else if (Array.isArray(v)) v.forEach(x => refHeads(x, out));
  else if (v !== null && typeof v === 'object') Object.values(v as Rec).forEach(x => refHeads(x, out));
  return out;
}

/** The chain, checked whole before any step runs: tools exist, names are unique, refs point back. */
export function parseSteps(raw: unknown, known: string[] = []): { steps: Step[] } | { error: string; hint: string } {
  const example = 'steps:[{tool:"create_design", args:{…}, as:"made"}, {tool:"add_layers", args:{design_path:"${made.design_path}", layers_shorthand:[…]}}]';
  if (!Array.isArray(raw) || !raw.length) return { error: 'steps is required — a list of {tool, args, as?}', hint: example };
  if (raw.length > MAX_STEPS) return { error: `${raw.length} steps — at most ${MAX_STEPS} in one execute`, hint: 'Split the chain into two execute calls.' };
  const steps: Step[] = [];
  const named = new Set<string>(known);
  for (const [i, s] of raw.entries()) {
    const at = `step ${i + 1}`;
    const o = (s !== null && typeof s === 'object' ? s : {}) as Rec;
    const tool = typeof o['tool'] === 'string' ? o['tool'] : '';
    if (!handlers?.[tool]) return { error: `${at}: unknown tool "${tool}"`, hint: `Tools: ${Object.keys(handlers ?? {}).join(', ')}.` };
    const args = o['args'] !== null && typeof o['args'] === 'object' && !Array.isArray(o['args']) ? o['args'] as Rec : {};
    if (tool === 'tasks' && args['op'] === 'execute') return { error: `${at}: an execute cannot run another execute`, hint: 'Put those steps in this list.' };
    const early = refHeads(args).find(h => !named.has(h) && !/^step\d+$/.test(h));
    if (early) return { error: `${at} refers to "\${${early}…}", which no earlier step is named`, hint: 'Name the step that produces it with as:"…", and put it first.' };
    const as = typeof o['as'] === 'string' && o['as'] ? o['as'] : undefined;
    if (as && (!/^[A-Za-z_][\w-]*$/.test(as) || /^step\d+$/.test(as) || named.has(as))) {
      return { error: `${at}: as:"${as}" is not a usable name`, hint: 'Letters, digits, _ and -; unique; not stepN (steps are already stepN by position).' };
    }
    if (as) named.add(as);
    named.add(`step${i + 1}`);
    steps.push({ tool, args, ...(as ? { as } : {}) });
  }
  return { steps };
}

/**
 * Run the chain; stop at the first failure. dry_run checks it and runs nothing.
 * `seed` pre-names values the steps may read — a recipe's ${params.…}.
 */
export async function executeSteps(a: { steps?: unknown; dry_run?: boolean }, seed: Record<string, Rec> = {}, op = 'execute'): Promise<ToolResult> {
  const parsed = parseSteps(a.steps, Object.keys(seed));
  if ('error' in parsed) return errResult(op, parsed.error, parsed.hint);
  const { steps } = parsed;
  if (a.dry_run) {
    return okResult(op, {
      dry_run: true, of: steps.length,
      steps: steps.map((s, i) => ({ step: i + 1, tool: `${s.tool}${typeof s.args?.['op'] === 'string' ? `:${s.args['op']}` : ''}`, ...(s.as ? { as: s.as } : {}) })),
      progress: [pOk('Checked', `${steps.length} step(s): tools exist, names unique, every ref points back — nothing ran`)],
      context: buildContext(op, `dry run of ${steps.length} step(s)`),
    });
  }
  const results: Record<string, Rec> = { ...seed };
  const ran: Rec[] = [];
  let last: ToolResult | undefined;
  for (const [i, s] of steps.entries()) {
    const missing: string[] = [];
    const args = normalizeProjectPaths(resolveRefs(s.args ?? {}, results, missing) as Rec);
    const label = `${s.tool}${typeof args['op'] === 'string' ? `:${args['op']}` : ''}`;
    let r: ToolResult;
    if (missing.length) {
      r = errResult(label, `Refers to ${missing.map(m => `\${${m}}`).join(', ')}, which the earlier result does not have`, 'Check the field name in that step\'s reply.');
    } else {
      const run = handlers?.[s.tool];
      try { r = run ? await withOpScope(label, args, () => run(args)) : errResult(label, 'Unknown tool', ''); }
      catch (e) { r = errResult(label, `Unexpected engine error: ${(e as Error).message}`, 'The steps before this one ran; fix this one and run the rest.'); }
    }
    last = r;
    results[`step${i + 1}`] = r as unknown as Rec;
    if (s.as) results[s.as] = r as unknown as Rec;
    ran.push({ step: i + 1, tool: label, ...(s.as ? { as: s.as } : {}), ...summarize(r) });
    if (!r.success) {
      const fail = errResult(op, `Step ${i + 1} of ${steps.length} (${label}) failed: ${r.error ?? 'no reason given'}`,
        `${r.hint ?? ''} Steps 1–${i} ran and their changes stand; send the rest from step ${i + 1} once it is fixed.`.trim(),
        [pWarn('Stopped', `at step ${i + 1}`)]);
      return { ...fail, ran: i, of: steps.length, steps: ran } as ToolResult;
    }
  }
  const next = last?.next_action as NextAction | undefined;
  return okResult(op, {
    ran: steps.length, of: steps.length, steps: ran,
    ...(next ? { next_action: next } : {}),
    progress: [pOk('Ran', `${steps.length} step(s), each through the same door as its own call`)],
    context: buildContext(op, `${steps.length} step(s) ran`),
  });
}

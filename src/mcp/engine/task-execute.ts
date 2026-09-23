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
import { readRecipe, type Step } from './recipe-store';

type Rec = Record<string, unknown>;
type Runner = (args: Rec) => ToolResult | Promise<ToolResult>;

export type { Step };

export const MAX_STEPS = 50;
/** Recipes inside recipes — deep enough to compose, shallow enough to read. */
export const MAX_DEPTH = 4;
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

/** Lists a step says to the model — kept as words, whatever their length. */
const SAID = new Set(['notes', 'warnings', 'hints', 'skipped', 'dropped', 'ignored']);
const clip = (s: string): string => (s.length > 200 ? `${s.slice(0, 200)}…` : s);

/** A list, small: words the model acts on stay words (first four); anything else is a count. */
function listOf(k: string, v: unknown[]): unknown {
  const words = v.length > 0 && v.every(x => typeof x === 'string');
  if (!words || (!SAID.has(k) && v.length > 6)) return `${v.length} item(s)`;
  const kept = (v as string[]).slice(0, 4).map(clip);
  return v.length > 4 ? [...kept, `…+${v.length - 4} more`] : kept;
}

/** An object's handles — the id and path a later step refers to — or nothing. */
function handles(o: Rec): Rec | undefined {
  const out: Rec = {};
  for (const k of ['id', 'path', 'src']) if (typeof o[k] === 'string') out[k] = o[k];
  return Object.keys(out).length ? out : undefined;
}

/**
 * A step's reply, small: its scalars, its words, and its handles. Lists used to
 * become bare counts and objects vanished, so a chain's replies read
 * notes:"4 item(s)" — the scene's warnings unread — and a fetched asset's path
 * was nowhere in the reply (one-shot benchmark r2).
 */
export function summarize(r: ToolResult): Rec {
  const out: Rec = {};
  for (const [k, v] of Object.entries(r as unknown as Rec)) {
    if (DROP.has(k) || v === undefined) continue;
    if (Array.isArray(v)) out[k] = listOf(k, v);
    else if (v !== null && typeof v === 'object') { const h = handles(v as Rec); if (h) out[k] = h; }
    else out[k] = typeof v === 'string' ? clip(v) : v;
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
    const obj = (v: unknown): Rec => (v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Rec : {});
    if ('for_each' in o) {
      const loop = parseLoop(o, at, named);
      if ('error' in loop) return loop;
      if (loop.step.as) named.add(loop.step.as);
      named.add(`step${i + 1}`);
      steps.push(loop.step);
      continue;
    }
    const recipe = typeof o['recipe'] === 'string' ? o['recipe'] : undefined;
    const tool = typeof o['tool'] === 'string' ? o['tool'] : '';
    if (recipe !== undefined && !readRecipe(recipe)) return { error: `${at}: no saved recipe "${recipe}"`, hint: 'tasks {op:"recipes"} lists them; save the inner chain first.' };
    if (recipe === undefined && !handlers?.[tool]) return { error: `${at}: unknown tool "${tool}"`, hint: `Tools: ${Object.keys(handlers ?? {}).join(', ')} — or {recipe:"name", params} to run a saved recipe.` };
    const args = obj(o['args']);
    const params = obj(o['params']);
    if (tool === 'tasks' && ['execute', 'run_recipe'].includes(String(args['op']))) return { error: `${at}: run a chain or recipe as a step with {recipe, params}, not through tasks`, hint: 'Or put those steps in this list.' };
    const early = refHeads(recipe !== undefined ? params : args).find(h => !named.has(h) && !/^step\d+$/.test(h));
    if (early) return { error: `${at} refers to "\${${early}…}", which no earlier step is named`, hint: 'Name the step that produces it with as:"…", and put it first.' };
    const as = typeof o['as'] === 'string' && o['as'] ? o['as'] : undefined;
    if (as && (!/^[A-Za-z_][\w-]*$/.test(as) || /^step\d+$/.test(as) || named.has(as))) {
      return { error: `${at}: as:"${as}" is not a usable name`, hint: 'Letters, digits, _ and -; unique; not stepN (steps are already stepN by position).' };
    }
    if (as) named.add(as);
    named.add(`step${i + 1}`);
    steps.push(recipe !== undefined ? { recipe, params, ...(as ? { as } : {}) } : { tool, args, ...(as ? { as } : {}) });
  }
  return { steps };
}

/**
 * Run the chain; stop at the first failure. dry_run checks it and runs nothing.
 * `seed` pre-names values the steps may read — a recipe's ${params.…}.
 */
export async function executeSteps(a: { steps?: unknown; dry_run?: boolean }, seed: Record<string, Rec> = {}, op = 'execute', stack: string[] = []): Promise<ToolResult> {
  const parsed = parseSteps(a.steps, Object.keys(seed));
  if ('error' in parsed) return errResult(op, parsed.error, parsed.hint);
  const { steps } = parsed;
  if (a.dry_run) {
    return okResult(op, {
      dry_run: true, of: steps.length,
      steps: steps.map((s, i) => ({ step: i + 1, tool: s.do ? 'for_each' : s.recipe !== undefined ? `recipe:${s.recipe}` : `${s.tool ?? ''}${typeof s.args?.['op'] === 'string' ? `:${s.args['op']}` : ''}`, ...(s.as ? { as: s.as } : {}) })),
      progress: [pOk('Checked', `${steps.length} step(s): tools exist, names unique, every ref points back — nothing ran`)],
      context: buildContext(op, `dry run of ${steps.length} step(s)`),
    });
  }
  const results: Record<string, Rec> = { ...seed };
  const ran: Rec[] = [];
  let last: ToolResult | undefined;
  for (const [i, s] of steps.entries()) {
    const missing: string[] = [];
    const input = resolveRefs(s.do ? {} : s.recipe !== undefined ? s.params ?? {} : s.args ?? {}, results, missing) as Rec;
    const args = s.recipe !== undefined ? input : normalizeProjectPaths(input);
    const label = s.do ? 'for_each' : s.recipe !== undefined ? `recipe:${s.recipe}` : `${s.tool ?? ''}${typeof args['op'] === 'string' ? `:${args['op']}` : ''}`;
    let r: ToolResult;
    if (missing.length) {
      r = errResult(label, `Refers to ${missing.map(m => `\${${m}}`).join(', ')}, which the earlier result does not have`, 'Check the field name in that step\'s reply.');
    } else if (s.do) {
      r = await runLoop(s, results, stack);
    } else if (s.recipe !== undefined) {
      r = await runNested(s.recipe, args, stack);
    } else {
      const run = handlers?.[s.tool ?? ''];
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

/** A saved recipe run as one step — a function calling a function. */
async function runNested(name: string, params: Rec, stack: string[]): Promise<ToolResult> {
  const label = `recipe:${name}`;
  if (stack.includes(name)) return errResult(label, `Recipe "${name}" would run itself: ${[...stack, name].join(' → ')}`, 'A recipe cannot run a recipe that runs it.');
  if (stack.length >= MAX_DEPTH) return errResult(label, `Recipes nested ${stack.length + 1} deep — at most ${MAX_DEPTH}`, 'Flatten one level into its caller.');
  const recipe = readRecipe(name);
  if (!recipe) return errResult(label, `No saved recipe "${name}"`, 'tasks {op:"recipes"} lists them.');
  const missing = Object.keys(recipe.params).filter(p => params[p] === undefined);
  if (missing.length) return errResult(label, `${name} needs ${missing.map(p => `${p} (${recipe.params[p] || 'no description'})`).join(', ')}`, 'Pass them in the step\'s params.');
  return executeSteps({ steps: recipe.steps }, { params }, label, [...stack, name]);
}

/** A loop step, checked: its list's refs point back and its inner chain parses with item + index known. */
function parseLoop(o: Rec, at: string, named: Set<string>): { step: Step } | { error: string; hint: string } {
  const item = typeof o['item'] === 'string' && o['item'] ? o['item'] : 'item';
  if (!/^[A-Za-z_][\w-]*$/.test(item) || named.has(item) || item === 'index') return { error: `${at}: item:"${item}" is not a usable name`, hint: 'A fresh name, not index or an earlier step\'s.' };
  const early = refHeads(o['for_each']).find(h => !named.has(h) && !/^step\d+$/.test(h));
  if (early) return { error: `${at}: for_each reads "\${${early}…}", which no earlier step is named`, hint: 'Loop over a list an earlier step made, a param, or a literal list.' };
  const inner = parseSteps(o['do'], [...named, item, 'index']);
  if ('error' in inner) return { error: `${at} do → ${inner.error}`, hint: inner.hint };
  const as = typeof o['as'] === 'string' && o['as'] ? o['as'] : undefined;
  if (as && (!/^[A-Za-z_][\w-]*$/.test(as) || named.has(as))) return { error: `${at}: as:"${as}" is not a usable name`, hint: 'Letters, digits, _ and -; unique.' };
  return { step: { for_each: o['for_each'], item, do: inner.steps, ...(as ? { as } : {}) } };
}

/** Run a loop step: its inner chain once per item, stopping at the first item that fails. */
async function runLoop(s: Step, results: Record<string, Rec>, stack: string[]): Promise<ToolResult> {
  const missing: string[] = [];
  const list = resolveRefs(s.for_each, results, missing);
  if (missing.length) return errResult('for_each', `for_each reads ${missing.map(m => `\${${m}}`).join(', ')}, which the earlier result does not have`, 'Check the field name.');
  if (!Array.isArray(list)) return errResult('for_each', `for_each needs a list — got ${typeof list}`, 'Pass a list, or a ref to one: for_each:"${params.items}".');
  if (list.length > MAX_STEPS) return errResult('for_each', `${list.length} items — at most ${MAX_STEPS}`, 'Split the list.');
  const runs: Rec[] = [];
  for (const [index, x] of list.entries()) {
    const seed = { ...results, [s.item ?? 'item']: x as Rec, index: index as unknown as Rec };
    const r = await executeSteps({ steps: s.do }, seed, `for_each[${index}]`, stack);
    runs.push({ index, ...summarize(r), steps: (r as unknown as Rec)['steps'] });
    if (!r.success) {
      const fail = errResult('for_each', `Item ${index + 1} of ${list.length} failed: ${r.error ?? ''}`, `Items 1–${index} ran and stand. ${r.hint ?? ''}`.trim());
      return { ...fail, runs } as ToolResult;
    }
  }
  return okResult('for_each', { ran: list.length, of: list.length, runs });
}

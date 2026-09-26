/**
 * Source formulas (phase 3, S2) — rules a design stores instead of results.
 *
 * A layer's `formulas: {prop: "=expr"}` (the Power Apps-style binding Folio
 * already had) was resolved only by the report runtime, with its state — every
 * export drew the literal values beside it. An expression that reads only the
 * design's NAMES (`names:` on the design, a page's own names over them), W and
 * H (the canvas) and utils is a SOURCE formula: it now resolves wherever the
 * design is drawn or measured. One that reads state, data or pages is a runtime
 * formula and is left to the report runtime, as before. One that fails is not
 * applied and is reported — the runtime path renders a failure as its raw text.
 * `prop` may be a dot path: "style.color", "fill".
 */

import type { Layer } from '../schema/types';
import { FORMULA_UTILS, isFormula } from './formula';

export interface SourceScope { names: Record<string, unknown>; W: number; H: number }
export interface SourceProblem { layer_id: string; prop: string; formula: string; error: string }

const RUNTIME = /\b(state|data|pages)\b/;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = new Set(['W', 'H', 'utils', 'state', 'data', 'pages', 'window', 'document', 'fetch', 'require', 'XMLHttpRequest', 'eval', 'Function', 'globalThis']);

/** A formula the report runtime evaluates with its state — not resolved from source. */
export const isRuntimeFormula = (f: string): boolean => RUNTIME.test(f.slice(1));

type Compiled = (...args: unknown[]) => unknown;
const compiled = new Map<string, Compiled>();

/** One source formula's value in `scope`, or why it has none. */
export function evalSource(formula: string, scope: SourceScope): { ok: true; value: unknown } | { ok: false; error: string } {
  const names = Object.keys(scope.names).filter(n => IDENT.test(n) && !RESERVED.has(n));
  const key = `${names.join(',')}|${formula}`;
  try {
    let fn = compiled.get(key);
    if (!fn) {
      // Globals a formula must not reach are shadowed by parameters that are never passed.
      fn = new Function('W', 'H', 'utils', ...names, 'window', 'document', 'fetch', 'require', 'XMLHttpRequest', 'globalThis',
        `"use strict"; return (${formula.slice(1)});`) as Compiled;
      compiled.set(key, fn);
    }
    const value = fn(scope.W, scope.H, FORMULA_UTILS, ...names.map(n => scope.names[n]));
    if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return { ok: false, error: `it gives ${String(value)}` };
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** The design's names, each "=…" one evaluated in order over the ones before it. */
export function resolveNames(raw: Record<string, unknown> | undefined, W: number, H: number, problems?: SourceProblem[]): Record<string, unknown> {
  const names: Record<string, unknown> = {};
  for (const [name, v] of Object.entries(raw ?? {})) {
    if (!isFormula(v)) { names[name] = v; continue; }
    const r = evalSource(v, { names, W, H });
    if (r.ok) names[name] = r.value;
    else problems?.push({ layer_id: '(names)', prop: name, formula: v, error: r.error });
  }
  return names;
}

/** A copy of `obj` with the dot path set. */
function setPath(obj: Record<string, unknown>, dotted: string, value: unknown): Record<string, unknown> {
  const [head = '', ...rest] = dotted.split('.');
  if (!rest.length) return { ...obj, [head]: value };
  const inner = obj[head];
  return { ...obj, [head]: setPath(inner && typeof inner === 'object' ? inner as Record<string, unknown> : {}, rest.join('.'), value) };
}

/** Whether a layer carries a formula this step resolves. */
export const hasSourceFormulas = (l: Layer): boolean =>
  Object.values((l as { formulas?: Record<string, unknown> }).formulas ?? {}).some(f => isFormula(f) && !isRuntimeFormula(f));

/**
 * The tree with every source formula applied. What was applied leaves the
 * layer's `formulas` (the runtime pass would evaluate it again without names);
 * runtime formulas and failures stay. Layers without source formulas are
 * returned as they were.
 */
export function resolveSourceFormulas(layers: Layer[], scope: SourceScope, problems?: SourceProblem[]): Layer[] {
  return layers.map(l => {
    let out = l;
    if (hasSourceFormulas(l)) {
      const formulas = (l as { formulas?: Record<string, string> }).formulas ?? {};
      let next = { ...(l as unknown as Record<string, unknown>) };
      const left: Record<string, string> = {};
      for (const [prop, f] of Object.entries(formulas)) {
        if (!isFormula(f) || isRuntimeFormula(f)) { left[prop] = f; continue; }
        const r = evalSource(f, scope);
        if (r.ok) next = setPath(next, prop, r.value);
        else { left[prop] = f; problems?.push({ layer_id: l.id, prop, formula: f, error: r.error }); }
      }
      if (Object.keys(left).length) next['formulas'] = left; else delete next['formulas'];
      out = next as unknown as Layer;
    }
    const kids = (out as Layer & { layers?: Layer[] }).layers;
    if (!Array.isArray(kids)) return out;
    const resolved = resolveSourceFormulas(kids, scope, problems);
    return resolved.every((k, i) => k === kids[i]) ? out : ({ ...out, layers: resolved } as Layer);
  });
}

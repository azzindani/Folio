/**
 * PowerApps-style formula binding system.
 *
 * Fields with a string starting with "=" are evaluated as expressions.
 * Example in YAML:
 *   formulas:
 *     fill: "=state.active ? '#6c5ce7' : '#636e72'"
 *     opacity: "=state.progress / 100"
 *     visible: "=data.rows.length > 0"
 *
 * Context available: state, data, pages, utils
 * Blocked: window, document, fetch, eval, require, XMLHttpRequest
 */

export interface FormulaContext {
  state?: Record<string, unknown>;
  data?: Record<string, unknown>;
  pages?: { id: string; index: number; active: boolean }[];
  utils?: typeof FORMULA_UTILS;
}

const FORMULA_UTILS = {
  clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)),
  lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  round: (v: number, dp = 0) => Number(v.toFixed(dp)),
  percent: (v: number, total: number) => total === 0 ? 0 : (v / total) * 100,
  px: (v: number) => `${Math.round(v)}px`,
  rgba: (r: number, g: number, b: number, a = 1) =>
    `rgba(${r},${g},${b},${a})`,
  if: (cond: unknown, t: unknown, f: unknown) => cond ? t : f,
  coerce: (v: unknown, type: 'number' | 'string' | 'boolean') =>
    type === 'number' ? Number(v) : type === 'boolean' ? Boolean(v) : String(v),
};

export function isFormula(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('=');
}

export function evaluateFormula(
  formula: string,
  ctx: FormulaContext = {},
): unknown {
  const expr = formula.slice(1); // strip leading "="
  const state  = ctx.state  ?? {};
  const data   = ctx.data   ?? {};
  const pages  = ctx.pages  ?? [];
  const utils  = ctx.utils  ?? FORMULA_UTILS;
  try {
    // Shadow dangerous globals via parameters (undefined) and var for eval (can't be a param in strict).
    const fn = new Function(
      'state', 'data', 'pages', 'utils',
      'window', 'document', 'fetch', 'require', 'XMLHttpRequest',
      `var eval=function(){throw new TypeError('eval blocked');};return (${expr});`,
    );
    return fn(state, data, pages, utils,
      undefined, undefined, undefined, undefined, undefined);
  } catch {
    return formula; // return raw formula string on error (graceful)
  }
}

/**
 * Resolves all `formulas` on a layer by evaluating each expression
 * and merging the result into a shallow property patch.
 * Non-formula values are passed through unchanged.
 */
export function resolveLayerFormulas(
  layer: Record<string, unknown>,
  ctx: FormulaContext,
): Record<string, unknown> {
  const formulas = layer['formulas'] as Record<string, string> | undefined;
  if (!formulas) return layer;

  const patch: Record<string, unknown> = {};
  for (const [prop, formula] of Object.entries(formulas)) {
    patch[prop] = isFormula(formula)
      ? evaluateFormula(formula, ctx)
      : formula;
  }
  return { ...layer, ...patch };
}

/**
 * Walk all layers (including nested groups) and resolve formulas.
 * Returns a new layer tree — does not mutate the original.
 */
export function resolveAllFormulas(
  layers: Record<string, unknown>[],
  ctx: FormulaContext,
): Record<string, unknown>[] {
  return layers.map(layer => {
    const resolved = resolveLayerFormulas(layer, ctx);
    if (Array.isArray(resolved['layers'])) {
      return {
        ...resolved,
        layers: resolveAllFormulas(
          resolved['layers'] as Record<string, unknown>[],
          ctx,
        ),
      };
    }
    return resolved;
  });
}

/** Build the page context array for formula evaluation. */
export function buildPagesContext(
  pages: { id: string; label?: string }[],
  activeIndex: number,
): FormulaContext['pages'] {
  return pages.map((p, i) => ({ id: p.id, index: i, active: i === activeIndex }));
}

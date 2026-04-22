// §28 — LLM input resilience
// Local models frequently provide alternate param names, nest args incorrectly,
// or omit fields. This module normalises those mistakes before dispatch.

type OpSignature = [ReadonlySet<string>, string];

// Infer the intended operation from parameter keys when 'op' is missing/malformed
const OP_SIGNATURES: OpSignature[] = [
  [new Set(['page_id', 'label', 'layers', 'template_ref']), 'append_page'],
  [new Set(['selectors']),                                   'patch_design'],
  [new Set(['layer', 'layer_id', 'props']),                  'update_layer'],
  [new Set(['layer']),                                       'add_layer'],
  [new Set(['layer_id']),                                    'remove_layer'],
  [new Set(['slots_array', 'template_id']),                  'batch_create'],
  [new Set(['layer_ids', 'component_name']),                 'save_as_component'],
  [new Set(['slots']),                                       'inject_template'],
];

// §28 — normalise 'op' when LLM nests it as an object or omits it
export function coerceOp(raw: Record<string, unknown>): Record<string, unknown> {
  const opVal = raw['op'];
  if (typeof opVal === 'string' && opVal) return raw;

  let params: Record<string, unknown>;
  if (typeof opVal === 'object' && opVal !== null) {
    params = { ...(opVal as Record<string, unknown>) };
    for (const [k, v] of Object.entries(raw)) {
      if (k !== 'op') (params as Record<string, unknown>)[k] ??= v;
    }
  } else {
    params = Object.fromEntries(Object.entries(raw).filter(([k]) => k !== 'op'));
  }

  const paramKeys = new Set(Object.keys(params));
  let inferred = '';
  for (const [sig, name] of OP_SIGNATURES) {
    if ([...sig].some(k => paramKeys.has(k))) { inferred = name; break; }
  }

  return { op: inferred, ...params };
}

// §28 — accept alternate spellings for the same parameter
export function dualKey<T>(
  obj: Record<string, unknown>,
  primary: string,
  fallback: string,
): T | undefined {
  return (obj[primary] ?? obj[fallback]) as T | undefined;
}

// §28 — safe string extraction with type guard
export function asString(
  obj: Record<string, unknown>,
  key: string,
  fallback = '',
): string {
  const v = obj[key];
  return typeof v === 'string' ? v : fallback;
}

// §28 — safe number extraction with coercion (LLMs sometimes send strings)
export function asNumber(
  obj: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = obj[key];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const n = Number(v); if (!Number.isNaN(n)) return n; }
  return fallback;
}

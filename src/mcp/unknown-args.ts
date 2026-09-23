// Name the arguments a tool does not take, instead of dropping them in silence.
//
// Found in the one-shot benchmark (r2): render_preview({page: 2}) rendered page
// ONE and replied success — the tool's argument is page_id, `page` fell on the
// floor, and three "previews" of three pages were the same image. Nothing said
// so; a blind model would have judged page 1 three times and moved on. Every
// tool had this door: an argument outside the published schema did nothing.
//
// Derived from the registries, like required-args and json-string-args: an
// argument is unknown when the tool's inputSchema does not publish it and it is
// not one of the few aliases a handler reads on purpose. The call still runs;
// the reply carries `ignored_args`, each with the published name it most likely
// meant, so the next call can be right.
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';
import type { ToolResult } from './types';

/** tool name → the argument names its inputSchema publishes. */
const PUBLISHED: Record<string, ReadonlySet<string>> = Object.fromEntries(
  [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS].map(t => [
    t.name,
    new Set(Object.keys((t as { inputSchema?: { properties?: Record<string, unknown> } }).inputSchema?.properties ?? {})),
  ]),
);

/** Unpublished names a handler reads on purpose: `path` becomes project_path
 *  (normalize-paths), asset_fetch reads `url` as its ref. */
const ACCEPTED: ReadonlySet<string> = new Set(['path', 'url']);

/** Edit distance where swapping two neighbouring letters is one edit (prosp → props). */
function distance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  const at = (i: number, j: number): number => d[i]?.[j] ?? 0;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, at(i - 2, j - 2) + 1);
      const row = d[i];
      if (row) row[j] = v;
    }
  }
  return at(a.length, b.length);
}

/** The published name an unknown argument most likely meant, if one is close. */
export function closestArg(name: string, published: ReadonlySet<string>): string | undefined {
  const names = [...published];
  const affix = names.filter(p => p.startsWith(`${name}_`) || p.endsWith(`_${name}`)).sort((a, b) => a.length - b.length);
  if (affix[0]) return affix[0];
  const near = names.map(p => ({ p, d: distance(name, p) })).filter(x => x.d <= (name.length >= 6 ? 2 : 1)).sort((a, b) => a.d - b.d);
  return near[0]?.p;
}

/** The arguments `tool` does not take, each with the name it likely meant. */
export function unknownArgs(tool: string, args: Record<string, unknown>): string[] {
  const published = PUBLISHED[tool];
  if (!published) return [];
  return Object.keys(args)
    .filter(k => !published.has(k) && !ACCEPTED.has(k) && !k.startsWith('_'))
    .map(k => {
      const meant = closestArg(k, published);
      return meant ? `${k} (did you mean ${meant}?)` : k;
    });
}

/** The reply, told which arguments were not used. */
export function withIgnoredArgs(result: ToolResult, ignored: string[]): ToolResult {
  if (!ignored.length) return result;
  const detail = `${ignored.join(', ')} — not an argument of this tool, so nothing read it.`;
  return {
    ...result,
    ignored_args: ignored,
    progress: [...(result.progress ?? []), { status: 'warn', message: 'Ignored argument(s)', detail }],
  };
}

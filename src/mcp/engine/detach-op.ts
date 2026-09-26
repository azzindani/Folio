/**
 * edit_layer op:detach (phase 3, S5) — a rule baked into what it draws.
 *
 * A formula, a gallery or a motion rule is edited AS a rule: change the name,
 * the row or the `at`, and the result follows. To hand-edit one card of twelve,
 * or drag one key of a rule's track, the rule is detached first: the layer gets
 * the literal values, cells and keyframes the resolver would have made (the
 * same function, so nothing moves), and the rule is gone. Without layer ids,
 * every rule on the page — or in the whole design — is baked: the file then
 * stores its full expansion, for a reader that knows no rules.
 */

import * as fs from 'fs';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn } from './utils';
import { resolveLayers, sourceOptions, unstampMarkers } from '../../renderer/resolve-source';
import { hasSourceFormulas, type SourceProblem } from '../../scripting/formula-source';
import { syncAnimationsToSpec } from './animation-sync';
import { toIdList } from './motion';

type Node = Layer & { layers?: Layer[]; gallery?: unknown; animation?: { rule?: unknown } };
export interface RuleCounts { formulas: number; galleries: number; rules: number }

/** How many layers under `layers` carry each kind of rule (a gallery's template is not counted). */
export function ruleCounts(layers: Layer[], c: RuleCounts = { formulas: 0, galleries: 0, rules: 0 }): RuleCounts {
  for (const l of layers as Node[]) {
    if (hasSourceFormulas(l)) c.formulas++;
    if (l.type === 'group' && l.gallery) c.galleries++;
    if (l.animation?.rule !== undefined) c.rules++;
    if (Array.isArray(l.layers)) ruleCounts(l.layers, c);
  }
  return c;
}

/** The layers with every rule under the named ones (all, when `ids` is null) baked; `hit` = ids found. */
function bake(layers: Layer[], ids: Set<string> | null, spec: DesignSpec, page: Page | undefined, problems: SourceProblem[]): { layers: Layer[]; hit: string[] } {
  const hit: string[] = [];
  const opts = sourceOptions(spec, page, problems);
  const walk = (ls: Layer[]): Layer[] => ls.map(l => {
    if (!ids || ids.has(l.id)) { hit.push(l.id); return unstampMarkers(resolveLayers([l], opts))[0] ?? l; }
    const kids = (l as Node).layers;
    return Array.isArray(kids) ? ({ ...l, layers: walk(kids) } as Layer) : l;
  });
  return { layers: walk(layers), hit };
}

export function detachLayers(args: { design_path: string; project_path?: string; page_id?: string; layer_id?: string; layer_ids?: unknown }): ToolResult {
  const op = 'detach';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  const wanted = toIdList(args.layer_ids ?? args.layer_id) ?? [];
  const ids = wanted.length ? new Set(wanted) : null;

  let surfaces: { page?: Page; layers: Layer[] }[];
  if (args.page_id) {
    const page = (spec.pages ?? []).find(p => p.id === args.page_id);
    if (!page) return errResult(op, `Page not found: ${args.page_id}`, 'Run manage_design(op:inspect) to list page ids.');
    surfaces = [{ page, layers: page.layers ?? [] }];
  } else {
    surfaces = [...(spec.layers?.length ? [{ layers: spec.layers }] : []), ...(spec.pages ?? []).map(p => ({ page: p, layers: p.layers ?? [] }))];
  }

  const before = ruleCounts(surfaces.flatMap(s => s.layers));
  const problems: SourceProblem[] = [];
  const found = new Set<string>();
  const baked = surfaces.map(s => { const b = bake(s.layers, ids, spec, s.page, problems); b.hit.forEach(h => found.add(h)); return { ...s, layers: b.layers }; });
  const missing = wanted.filter(id => !found.has(id));
  if (missing.length) return errResult(op, `No layer ${missing.map(m => `"${m}"`).join(', ')}${args.page_id ? ` on page ${args.page_id}` : ''}.`, 'Pass real layer ids (manage_design op:inspect); a gallery\'s cells are detached through the gallery layer.');
  const after = ruleCounts(baked.flatMap(s => s.layers));
  const done: RuleCounts = { formulas: before.formulas - after.formulas, galleries: before.galleries - after.galleries, rules: before.rules - after.rules };
  if (!done.formulas && !done.galleries && !done.rules) {
    return errResult(op, `Nothing to detach${ids ? ` on ${wanted.join(', ')}` : ''}: no formula, gallery or motion rule${problems.length ? ' that resolves' : ''}.`,
      problems.length ? 'A rule that fails stays a rule — diagnose_design names it (formula_error / rule_error); fix it, then detach.' : 'Detach bakes names formulas, a gallery or animation.rule; plain layers are already literal.');
  }

  const bak = snapshot(dPath);
  for (const s of baked) {
    if (s.page) s.page.layers = s.layers;
    else spec.layers = s.layers;
  }
  syncAnimationsToSpec(spec);
  writeYAML(dPath, spec);

  const what = [done.formulas ? `${done.formulas} layer(s) of formulas → values` : '', done.galleries ? `${done.galleries} gallery(ies) → literal cells` : '',
    done.rules ? `${done.rules} motion rule(s) → keyframes` : ''].filter(Boolean).join(', ');
  const progress: ProgressItem[] = [pOk(`Detached ${ids ? wanted.join(', ') : 'every rule'}`, `${what} — drawn exactly as before, now editable by hand`)];
  for (const p of problems) progress.push(pWarn('Kept as a rule', `"${p.layer_id}" ${p.prop}: ${p.error}`));
  return okResult(op, {
    design_path: dPath, detached: done, progress,
    next_action: { tool: 'manage_design', params: { op: 'inspect', design_path: dPath }, remaining: 0, hint: 'The cells and keys are ordinary layers now: edit_layer update or animation op:track edits one of them.' },
  }, bak);
}

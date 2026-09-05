// Folio MCP engine — the authored-spec round-trip tools.
//
//   manage_design {op:"get_spec"}   read what the design is MADE OF
//   edit_layer    {op:"patch_spec"} change that, and re-render from it
//
// Together they close the loop a design file could not close before: the file
// stored the expanded output but not the intent, so evolving a page meant
// hand-editing thirty generated layers or rebuilding it. See ./design-spec for
// how the spec is kept and why intent and engine context are stored apart.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult, ProgressItem, NextAction } from './types';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';
import { resolveThemeColors } from './engine-layer-predicates';
import { expandShorthandLayers } from './shorthand-parser';
import { resetPresetFitReports, drainPresetFitReports } from './preset-fit';
import {
  SPEC_FIELD, SPEC_ENV_FIELD, collectAuthoredSpecs, findSpecLayer,
  mergeSpecChanges, toShorthand, replaceLayer, diffSpecKeys, describeDrift, specOf, type SpecEntry,
} from './design-spec';
import { collectTokens, retokenize } from './design-tokens';

/** Every page's layers, tagged with the page they came from. */
function surfaces(spec: DesignSpec): { pageId?: string; layers: Layer[] }[] {
  if (spec.pages?.length) return spec.pages.map(p => ({ pageId: p.id, layers: p.layers ?? [] }));
  return [{ layers: spec.layers ?? [] }];
}

// ── get_spec ────────────────────────────────────────────────

/** Read back the specs the design was authored from — the sparse view. */
export function getDesignSpec(args: { design_path: string; page_id?: string; layer_id?: string; project_path?: string }): ToolResult {
  const op = 'get_spec';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  const spec = readYAML<DesignSpec>(dPath);

  let entries: SpecEntry[] = [];
  for (const s of surfaces(spec)) {
    if (args.page_id && s.pageId !== args.page_id) continue;
    entries = entries.concat(collectAuthoredSpecs(s.layers, s.pageId));
  }
  if (args.layer_id) entries = entries.filter(e => e.layer_id === args.layer_id);

  if (entries.length === 0) {
    // Hand-placed layers have no authored spec and never will — say so plainly
    // rather than letting the model read an empty list as a broken tool.
    const hand = surfaces(spec).reduce((n, s) => n + s.layers.length, 0);
    progress.push(pInfo('No authored specs on this design', `${hand} top-level layer(s) — hand-placed layers ARE their own source; edit them with edit_layer {op:"update"} or patch_design.`));
    return okResult(op, {
      specs: [], count: 0,
      note: args.layer_id
        ? `Layer "${args.layer_id}" was not built from a preset spec (or does not exist). Only preset groups — sections, versus, list, timeline, feature_grid… — carry one.`
        : 'This design has no preset groups: nothing was built from a spec, so there is nothing to patch. Designs composed before spec round-trip shipped also have none — re-adding the preset gives it one.',
      progress, context: buildContext(op, `No authored specs in ${path.basename(dPath)}`),
    });
  }

  progress.push(pOk(`${entries.length} authored spec(s)`, entries.map(e => `${e.layer_id}:${e.type}`).join(', ')));
  const first = entries[0];
  const next_action: NextAction = {
    tool: 'edit_layer',
    params: { op: 'patch_spec', design_path: dPath, layer_id: first.layer_id, ...(first.page_id ? { page_id: first.page_id } : {}), changes: {} },
    remaining: -1,
    hint: 'Change the INTENT, not the generated layers: pass only the fields you want different (null deletes one). The preset re-expands in place.',
  };
  return okResult(op, {
    specs: entries, count: entries.length,
    usage: 'These are the specs this design was built from. edit_layer {op:"patch_spec", layer_id, changes} merges into one and re-renders it — arrays replace wholesale, objects merge key by key, null deletes.',
    next_action, progress,
    context: buildContext(op, `${entries.length} authored spec(s) in ${path.basename(dPath)}`),
  });
}

// ── tokens ──────────────────────────────────────────────────

/** Read, or set, a design's palette by ROLE rather than by literal. */
export function designTokens(args: {
  design_path: string; set?: Record<string, string>; project_path?: string; dry_run?: boolean;
}): ToolResult {
  const op = 'tokens';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  const design = readYAML<DesignSpec>(dPath);

  if (!args.set || Object.keys(args.set).length === 0) {
    const { table, usage } = collectTokens(design);
    if (Object.keys(table).length === 0) {
      return okResult(op, {
        tokens: {}, usage: [],
        note: 'No colour roles found. Roles are read from preset specs (bg, accent, text_color, muted), so a design built entirely from hand-placed layers has none — recolor it with patch_design {path:"recolor"} instead.',
        progress, context: buildContext(op, `No tokens in ${path.basename(dPath)}`),
      });
    }
    progress.push(pOk(`${Object.keys(table).length} colour role(s)`, Object.entries(table).map(([k, v]) => `${k}=${v}`).join(' ')));
    return okResult(op, {
      tokens: table, usage,
      usage_note: 'Set a role and the whole design follows: presets are patched AT THEIR SPEC and rebuilt, so tints, rules and scrims DERIVED from that colour recompute instead of being left stale. Layers with no spec can only have the old value swapped for the new one — `literal_layers` counts those.',
      next_action: { tool: 'manage_design', params: { op: 'tokens', design_path: dPath, set: { accent: table.accent ?? '#0EA5E9' } }, remaining: -1, hint: 'Change a role; every preset that names it re-renders.' } as NextAction,
      progress, context: buildContext(op, `${Object.keys(table).length} colour role(s) in ${path.basename(dPath)}`),
    });
  }

  const theme = resolveThemeColors(design) ?? undefined;
  const reexpand = (layer: Layer, patch: Record<string, unknown>): Layer | null => {
    const s = specOf(layer);
    if (!s) return null;
    try {
      const id = (layer as unknown as Record<string, unknown>)['id'];
      const built = expandShorthandLayers([toShorthand({ ...s.spec, ...patch, id }, s.env, theme)]);
      return built.length ? built[0] : null;
    } catch { return null; }
  };

  if (args.dry_run) {
    // Work on a copy so the caller sees the outcome without it happening.
    const copy = JSON.parse(JSON.stringify(design)) as DesignSpec;
    const r = retokenize(copy, args.set as Record<string, string>, reexpand);
    progress.push(pInfo('Dry run — nothing written', r.changed.join(' · ') || 'no change'));
    return okResult(op, { changed: r.changed, would_respec: r.respecced, would_swap: r.swapped, ...(r.notes.length ? { notes: r.notes } : {}), progress, context: buildContext(op, `Dry run on ${path.basename(dPath)}`) });
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  resetPresetFitReports();
  const r = retokenize(design, args.set as Record<string, string>, reexpand);
  const fitNotes = drainPresetFitReports().map(x => x.note);
  if (r.changed.length === 0) {
    return okResult(op, { changed: [], tokens: collectTokens(design).table, note: 'Every role already had that value — nothing to change.', ...(r.notes.length ? { notes: r.notes } : {}), progress, context: buildContext(op, 'No-op tokens') }, bak);
  }

  design.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, design);
  progress.push(pOk(`Retokenized ${r.changed.length} role(s)`, `${r.respecced} preset(s) rebuilt from their spec, ${r.swapped} hand-placed layer(s) swapped`));
  for (const n of [...r.notes, ...fitNotes]) progress.push(pWarn('Token note', n));

  return okResult(op, {
    changed: r.changed, tokens: collectTokens(design).table,
    respecced: r.respecced, swapped: r.swapped,
    ...(r.notes.length || fitNotes.length ? { notes: [...r.notes, ...fitNotes] } : {}),
    next_action: { tool: 'render_preview', params: { design_path: dPath }, remaining: -1, hint: 'Look at the new palette, then seal_design.' } as NextAction,
    progress,
    context: buildContext(op, `Retokenized ${path.basename(dPath)}`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}

// ── patch_spec ──────────────────────────────────────────────

/** Merge changes into a preset's authored spec and re-expand it in place. */
export function patchDesignSpec(args: {
  design_path: string; layer_id: string; changes: Record<string, unknown>;
  page_id?: string; project_path?: string; dry_run?: boolean;
}): ToolResult {
  const op = 'patch_spec';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  if (!args.changes || typeof args.changes !== 'object' || Array.isArray(args.changes)) {
    return errResult(op, 'changes must be an object of spec fields to merge.', 'e.g. changes:{accent:"#0EA5E9", title:"New headline"} — or {footer:null} to drop a field.');
  }

  const design = readYAML<DesignSpec>(dPath);
  // A carousel's pages share layer ids, so an unscoped patch would rewrite the
  // same preset on every slide. Refuse rather than silently mass-edit.
  const owning = surfaces(design).filter(s => findSpecLayer(s.layers, args.layer_id));
  if (owning.length === 0) {
    return errResult(op, `No preset spec on layer "${args.layer_id}".`,
      'manage_design {op:"get_spec"} lists the layers that carry one. A hand-placed layer has no spec — edit it with edit_layer {op:"update"} instead.', progress);
  }
  const scoped = args.page_id ? owning.filter(s => s.pageId === args.page_id) : owning;
  if (scoped.length === 0) return errResult(op, `Layer "${args.layer_id}" is not on page "${args.page_id}".`, `It is on: ${owning.map(s => s.pageId).join(', ')}.`, progress);
  if (scoped.length > 1) {
    return errResult(op, `Layer id "${args.layer_id}" carries a spec on ${scoped.length} pages (${scoped.map(s => s.pageId).join(', ')}) — refusing to patch all of them.`,
      'Pass page_id to patch ONE slide (carousel pages share layer ids).', progress);
  }

  const surface = scoped[0];
  const target = findSpecLayer(surface.layers, args.layer_id) as Layer;
  const t = target as unknown as Record<string, unknown>;
  const before = t[SPEC_FIELD] as Record<string, unknown>;
  const env = t[SPEC_ENV_FIELD] as Record<string, unknown> | undefined;
  const after = mergeSpecChanges(before, args.changes);
  const changedKeys = diffSpecKeys(before, after);
  if (changedKeys.length === 0) {
    return okResult(op, { changed: [], spec: after, note: 'The patch matched the spec already stored — nothing to re-render.', progress, context: buildContext(op, 'No-op patch') });
  }

  // Re-expand from the merged spec, in the same engine context the original was
  // built in, with the theme resolved fresh from the design.
  const theme = resolveThemeColors(design) ?? undefined;
  const expand = (s: Record<string, unknown>): Layer => {
    const out = expandShorthandLayers([toShorthand({ ...s, id: args.layer_id }, env, theme)]);
    if (!out.length) throw new Error('expansion produced no layer');
    return out[0];
  };
  resetPresetFitReports();
  let rebuilt: Layer;
  let drift: string | null = null;
  try {
    // Regenerating from the spec discards anything done to the generated layers
    // since. Correct — the spec is the source — but never silent.
    drift = describeDrift(target, expand(before));
    resetPresetFitReports();
    rebuilt = expand(after);
  } catch (err) {
    return errResult(op, `Re-expansion failed: ${(err as Error).message}`, 'The merged spec is not valid for this preset. get_spec shows the current one; change one field at a time to isolate it.', progress);
  }
  const fitNotes = [...(drift ? [drift] : []), ...drainPresetFitReports().map(r => r.note)];

  if (args.dry_run) {
    progress.push(pInfo('Dry run — nothing written', changedKeys.join(' ')));
    return okResult(op, { changed: changedKeys, spec: after, layers_after: ((rebuilt as unknown as { layers?: unknown[] }).layers ?? []).length, ...(fitNotes.length ? { notes: fitNotes } : {}), progress, context: buildContext(op, `Dry run on "${args.layer_id}"`) });
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const before_layers = ((target as unknown as { layers?: unknown[] }).layers ?? []).length;
  if (!replaceLayer(surface.layers, args.layer_id, rebuilt)) {
    return errResult(op, `Could not replace layer "${args.layer_id}" after re-expansion.`, 'Re-read the design with manage_design {op:"get_spec"} and retry.', progress);
  }
  design.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, design);

  const after_layers = ((rebuilt as unknown as { layers?: unknown[] }).layers ?? []).length;
  progress.push(pOk(`Re-rendered "${args.layer_id}" from its spec`, `${changedKeys.join(' ')} · ${before_layers} → ${after_layers} layer(s)`));
  for (const n of fitNotes) progress.push(pWarn('Preset compressed to fit its box', n));

  const next_action: NextAction = { tool: 'render_preview', params: { design_path: dPath, ...(surface.pageId ? { page_id: surface.pageId } : {}) }, remaining: -1, hint: 'Look at the result, then patch again or seal_design.' };
  return okResult(op, {
    patched: args.layer_id, changed: changedKeys, spec: after,
    layers_before: before_layers, layers_after: after_layers,
    ...(surface.pageId ? { page_id: surface.pageId } : {}),
    ...(fitNotes.length ? { notes: fitNotes } : {}),
    next_action, progress,
    context: buildContext(op, `Patched "${args.layer_id}" in ${path.basename(dPath)}`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}

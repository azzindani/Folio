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

import { resolveDesignPath, snapshot, readYAML, writeYAML, writeRaw, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';
import { resolveThemeColors } from './engine-layer-predicates';
import { expandShorthandLayers } from './shorthand-parser';
import { honorPosterRatio } from './poster-ratio';
import { isFullBleedContentPreset } from './engine-finalize-presets';
import { fixInvisibleText, fixCapsTracking } from './engine-finalize-legibility';
import { themeSpecOf as resolveThemeSpec } from './engine-finalize-pages';
import { resetPresetFitReports, drainPresetFitReports } from './preset-fit';
import {
  SPEC_FIELD, SPEC_ENV_FIELD, collectAuthoredSpecs, findSpecLayer,
  mergeSpecChanges, toShorthand, replaceLayer, diffSpecKeys, describeDrift, specOf, type SpecEntry,
} from './design-spec';
import { collectTokens, retokenize } from './design-tokens';
import { readLineage, chainGaps, contentHash } from './design-lineage';
import { snapshotIndex, restorePoints, resolveRestoreTarget, keepCap } from './design-restore';

/** Every page's layers, tagged with the page they came from. */
function surfaces(spec: DesignSpec): { pageId?: string; layers: Layer[] }[] {
  if (spec.pages?.length) return spec.pages.map(p => ({ pageId: p.id, layers: p.layers ?? [] }));
  return [{ layers: spec.layers ?? [] }];
}

// ── get_spec ────────────────────────────────────────────────

/** Read back the specs the design was authored from — the sparse view. */

/**
 * Re-expansion has to land in the same PAGE CONTEXT as the original.
 *
 * add_layers expands a preset and THEN fits it to the page (honorPosterRatio,
 * for a poster on a deliberate standard ratio) and re-lights its text
 * (fixInvisibleText, fixCapsTracking). patch_spec re-expanded through the same
 * expander and skipped all of it, so a preset authored WITHOUT an explicit box
 * — which is how the guide teaches it — came back wrong in two ways.
 *
 * Measured live on a 1080x1350 poster, editing ONE field of a `sections`
 * preset: the container and its backgrounds rebuilt at 972px, so the bottom 378
 * rows (28% of the page) rendered BLACK where they had been #FAF5EC; and the
 * accent came back raw at #F28C28 (orange on cream) where the engine had
 * already darkened it to #613810 for contrast, with the ALL-CAPS tracking gone.
 *
 * Runs over the WHOLE surface, not the rebuilt layer alone — that distinction
 * matters: given only the group, fixInvisibleText cannot see what is behind the
 * text and re-lit it WHITE on a cream page.
 */
function finalizeAfterRespec(layers: Layer[], design: DesignSpec): void {
  const doc = design.document;
  for (const l of layers) {
    if (!isFullBleedContentPreset(l, doc.width, doc.height)) continue;
    let clone: Layer | null = null;
    try { clone = JSON.parse(JSON.stringify(l)) as Layer; } catch { clone = null; }
    if (!clone) continue;
    const fit = honorPosterRatio(clone, [], doc.width, doc.height);
    // Keep the fit only when it lands on the canvas the design ALREADY has.
    // add_layers would additionally grow the document to contain overflow; an
    // edit to one field must not silently resize the user's page, so an
    // overflowing rebuild is left alone for diagnose to report.
    if (fit && fit.width === doc.width && fit.height === doc.height) {
      Object.assign(l as unknown as Record<string, unknown>, clone as unknown as Record<string, unknown>);
    }
  }
  fixInvisibleText(layers, doc.width, doc.height, resolveThemeSpec(design));
  fixCapsTracking(layers);
}

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
  // Re-expansion replaces the WHOLE layer, so properties authored on the
  // container — ones the spec never described — went with it. Discarding what
  // was done to the generated CHILDREN is deliberate (that is what `drift`
  // reports); discarding the container's own flags is not.
  //
  // `locked` is the one that matters. The model sets it to tell the auto-rescue
  // passes to leave a hand-placed composition alone — the guide teaches exactly
  // that, and 248 of 276 library designs do it. Patching one spec field silently
  // un-locked the group, after which the next rescue pass was free to reflow the
  // composition it had been told not to touch. Measured: locked before 1, after 0.
  for (const k of ['locked', 'href'] as const) {
    const v = (target as unknown as Record<string, unknown>)[k];
    if (v !== undefined) (rebuilt as unknown as Record<string, unknown>)[k] = v;
  }
  if (!replaceLayer(surface.layers, args.layer_id, rebuilt)) {
    return errResult(op, `Could not replace layer "${args.layer_id}" after re-expansion.`, 'Re-read the design with manage_design {op:"get_spec"} and retry.', progress);
  }
  if (!design.pages) finalizeAfterRespec(surface.layers, design);
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

// ── restore ─────────────────────────────────────────────────

/** How big a design is, in the terms a restore changes. */
function shapeOf(spec: DesignSpec): { pages: number; layers: number } {
  const s = surfaces(spec);
  return { pages: spec.pages?.length ?? 0, layers: s.reduce((n, x) => n + x.layers.length, 0) };
}

/** Put a design back to a state its history recorded.
 *
 *  Not a rewrite of the past: the restore is itself a change, so it appends to
 *  the lineage like any other write. The history stays append-only and shows
 *  the rollback happening, which is what makes it auditable. */
export function restoreDesign(args: {
  design_path: string; to?: number | string; dry_run?: boolean; project_path?: string;
}): ToolResult {
  const op = 'restore';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const { records } = readLineage(dPath);
  const index = snapshotIndex(dPath);
  const points = restorePoints(records, index);
  const open = points.filter(p => p.available && !p.current);

  if (records.length === 0) {
    return errResult(op, 'This design has no recorded history, so there is no state to go back to.',
      'Lineage records from the first write onward — a design last touched before it shipped has none. Everything from the next change on is restorable.');
  }

  // No target → say what the choices are, rather than guessing one.
  if (args.to === undefined || args.to === null || args.to === '') {
    progress.push(pInfo(`${open.length} state(s) you can go back to`, `of ${records.length} recorded`));
    return okResult(op, {
      restore_points: points.map(p => ({ seq: p.seq, op: p.op, ts: p.ts, bytes: p.bytes, available: p.available, ...(p.current ? { current: true } : {}) })),
      count: points.length, available: open.map(p => p.seq),
      note: `Pass to:<seq> to go back to the state that change ended at. Snapshots are capped at ${keepCap()} per design, so entries marked available:false are readable history whose content has been pruned.`,
      progress, context: buildContext(op, `${open.length} restore point(s) for ${path.basename(dPath)}`),
    });
  }

  const resolved = resolveRestoreTarget(records, index, args.to);
  if (!resolved.ok) return errResult(op, resolved.message, resolved.hint, progress);
  const { point, entry } = resolved;

  const current = readYAML<DesignSpec>(dPath);
  const beforeShape = shapeOf(current);
  let target: DesignSpec;
  try {
    target = readYAML<DesignSpec>(entry.path);
  } catch (err) {
    return errResult(op, `The snapshot for #${point.seq} is on disk but will not parse: ${err instanceof Error ? err.message : String(err)}`,
      'Pick another restore point — manage_design {op:"restore"} with no `to` lists them.');
  }
  const afterShape = shapeOf(target);
  const delta = {
    layers: `${beforeShape.layers} → ${afterShape.layers}`,
    ...(beforeShape.pages || afterShape.pages ? { pages: `${beforeShape.pages} → ${afterShape.pages}` } : {}),
    bytes: `${Buffer.byteLength(fs.readFileSync(dPath, 'utf-8'))} → ${entry.bytes}`,
  };

  if (point.current) {
    progress.push(pInfo('Already in that state', `nothing to undo — the design already matches #${point.seq}`));
    return okResult(op, {
      restored: false, to: point.seq, unchanged: true,
      note: `The design's current content is exactly what change #${point.seq} (${point.op}) produced, so a restore would write the same bytes back.`,
      progress, context: buildContext(op, `No change needed for ${path.basename(dPath)}`),
    });
  }

  const discarded = records.filter(r => r.seq > point.seq).map(r => `#${r.seq} ${r.op}`);
  if (args.dry_run) {
    progress.push(pInfo(`Would restore to #${point.seq} (${point.op})`, delta.layers));
    return okResult(op, {
      dry_run: true, to: point.seq, target_op: point.op, target_ts: point.ts, delta,
      would_undo: discarded,
      note: discarded.length
        ? `${discarded.length} later change(s) would be undone in the file. They stay in the history — a restore appends, it never rewrites what came before.`
        : 'No later changes to undo.',
      progress, context: buildContext(op, `Dry run: restore ${path.basename(dPath)} to #${point.seq}`),
    });
  }

  // Snapshot the state we are leaving, so the restore is itself undoable.
  const bak = snapshot(dPath);
  const raw = fs.readFileSync(entry.path, 'utf-8');
  writeRaw(dPath, raw);

  // Verify against the FILE, not the log — the log entry for this very call is
  // not written until the op scope closes, and the question is anyway whether
  // the bytes on disk are the ones the target state recorded.
  const exact = contentHash(fs.readFileSync(dPath, 'utf-8')) === point.hash;
  progress.push(pOk(`Restored to #${point.seq} (${point.op})`, `${delta.layers} layer(s) · ${entry.bytes}B`));
  if (!exact) progress.push(pWarn('Restored content does not hash to the recorded state', 'the bytes were written, but they are not the ones #' + point.seq + ' recorded'));
  for (const d of discarded) progress.push(pInfo('Undone in the file', d));

  const next_action: NextAction = { tool: 'render_preview', params: { design_path: dPath }, remaining: -1, hint: 'Confirm the restored state looks right before building on it.' };
  return okResult(op, {
    restored: true, to: point.seq, target_op: point.op, target_ts: point.ts,
    from: entry.label, hash: point.hash, verified: exact, delta,
    undone: discarded,
    note: 'The rollback is appended to the history as its own change — the record it went back to is untouched, so restoring again is always possible while its snapshot survives.',
    next_action, progress,
    context: buildContext(op, `Restored ${path.basename(dPath)} to #${point.seq}`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}

// ── lineage ─────────────────────────────────────────────────

/** A design's append-only history: what changed it, when, and what it hashed to.
 *
 *  The review's complaint about receipts was not the missing rows — it was that
 *  nothing said they were missing, so a partial log got believed. This one
 *  states its scope in the reply, every time. */
export function designLineage(args: {
  design_path: string; limit?: number; project_path?: string;
}): ToolResult {
  const op = 'lineage';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const { records, skipped } = readLineage(dPath);
  const scope = 'Every write to this .design.yaml through the MCP tool surface, recorded at the single point all of them pass through. Edits made outside it (by hand, or by restoring a snapshot) are NOT entries — they show up as a break in the hash chain instead.';
  if (records.length === 0) {
    return okResult(op, {
      records: [], count: 0, scope,
      note: 'No history yet. Lineage records from the first write onward, so a design created before it shipped has none until the next change.',
      progress, context: buildContext(op, `No lineage for ${path.basename(dPath)}`),
    });
  }

  const limit = Math.max(1, Math.min(args.limit ?? 20, 200));
  const shown = records.slice(-limit);
  const gaps = chainGaps(records);
  // Which of these can still be UNDONE. Lineage is unbounded, snapshots are
  // capped, so the two diverge — and the agent has to know which entries are
  // merely readable before it plans a rollback, not after it tries one.
  const points = restorePoints(records, snapshotIndex(dPath));
  const byId = new Map(points.map(p => [p.seq, p]));
  const restorable = points.filter(p => p.available && !p.current).map(p => p.seq);
  const rows = shown.map(r => ({ ...r, restorable: byId.get(r.seq)?.available === true }));
  const total = records[records.length - 1].after.bytes;
  const ops = new Map<string, number>();
  for (const r of records) ops.set(r.op, (ops.get(r.op) ?? 0) + 1);

  progress.push(pOk(`${records.length} change(s)`, [...ops.entries()].map(([o, n]) => `${o}×${n}`).join(' · ')));
  for (const g of gaps) progress.push(pWarn(`Chain break at #${g.seq}`, `expected ${g.expected}, found ${g.found} — the file was changed outside the tool surface`));

  return okResult(op, {
    records: rows, count: records.length, showing: shown.length, scope,
    by_op: Object.fromEntries(ops),
    current_bytes: total,
    restorable: restorable.length
      ? { seqs: restorable, how: 'manage_design {op:"restore", to:<seq>} puts the design back to the state that change ended at — byte for byte, checked against the hash recorded here.' }
      : { seqs: [], how: `Nothing to roll back to: states are kept as snapshots, capped at ${keepCap()} per design, and none of this design's earlier ones survive.` },
    ...(gaps.length ? {
      chain_breaks: gaps,
      chain_note: `${gaps.length} record(s) do not follow on from the previous one — the design was edited outside the tool surface (hand-edited, restored from a snapshot, or synced). The history is complete for tool writes; it is not intact as a chain.`,
    } : { chain: 'intact — every record follows on from the one before it' }),
    ...(skipped ? { unreadable_lines: skipped } : {}),
    progress, context: buildContext(op, `${records.length} change(s) to ${path.basename(dPath)}`),
  });
}

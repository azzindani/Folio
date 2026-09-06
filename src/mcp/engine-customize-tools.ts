// Folio MCP engine — the customize twins.
//
//   report       {op:"generate"} → {op:"customize"}
//   presentation {op:"create"}   → {op:"customize"}
//
// A generator that has no customize twin can only be re-run, and re-running it
// throws away everything composed since: "today I can generate but not restyle
// without regenerating" (harness review, §PART III). Both of these documents
// already PERSIST what generated them — a report keeps its layout/navigation/
// accent/fonts, a presentation its transition/auto-advance/aspect — so the
// missing half was never storage, only a way to change it in place.
//
// Canvas resize is the one that could not exist before the spec round-trip.
// Re-shaping a deck from 1920×1080 to 1080×1350 used to mean every preset
// staying at its old geometry and clipping. Now a preset re-EXPANDS into the new
// page box from the spec that built it — it re-lays out rather than being
// stretched — and only hand-placed layers are scaled. Generate → customize →
// re-render, on the document, exactly as patch_spec does on one preset.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer, Page } from '../schema/types';
import type { ToolResult, ProgressItem, NextAction } from './types';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';
import { resolveThemeColors } from './engine-layer-predicates';
import { expandShorthandLayers } from './shorthand-parser';
import { FLOW_PAGE_PRESETS } from './shorthand-recover';
import { resetPresetFitReports, drainPresetFitReports, scaleSubtree } from './preset-fit';
import { SPEC_FIELD, SPEC_ENV_FIELD, mergeSpecChanges, diffSpecKeys, toShorthand } from './design-spec';

/** How a reflow rebuilt the document. */
export interface ReflowResult {
  /** Presets re-expanded into the new page box from their spec. */
  reexpanded: number;
  /** Hand-placed layers scaled to fit (no spec to re-expand from). */
  scaled: number;
  /** Notes raised while re-expanding (preset compression, mostly). */
  notes: string[];
}

/** Every page's layers, tagged with the page they belong to. */
function surfaces(design: DesignSpec): { page?: Page; layers: Layer[] }[] {
  if (design.pages?.length) return design.pages.map(p => ({ page: p, layers: p.layers ?? [] }));
  return [{ layers: design.layers ?? [] }];
}

// ── Reflow ──────────────────────────────────────────────────

/** Did this layer cover the old canvas? A full-bleed preset should be re-laid
 *  out to the NEW canvas rather than scaled down inside it. */
function coversCanvas(l: Layer, w: number, h: number): boolean {
  const o = l as unknown as Record<string, unknown>;
  const x = Number(o['x']) || 0, y = Number(o['y']) || 0;
  const lw = Number(o['width']) || 0, lh = Number(o['height']) || 0;
  return x <= w * 0.02 && y <= h * 0.02 && lw >= w * 0.9 && lh >= h * 0.9;
}

/** Re-shape a design's contents for a new canvas.
 *
 *  A preset with a stored spec is REBUILT for the new box — the engine lays it
 *  out again at the new proportions, which is what a human would do. Everything
 *  else is uniformly scaled and centred: non-uniform scaling would squash
 *  circles and letterforms, and a stretched design reads worse than a smaller
 *  correct one. */
export function reflowToCanvas(design: DesignSpec, W: number, H: number): ReflowResult {
  const oldW = design.document.width, oldH = design.document.height;
  const out: ReflowResult = { reexpanded: 0, scaled: 0, notes: [] };
  if (oldW === W && oldH === H) return out;

  const theme = resolveThemeColors(design) ?? undefined;
  const k = Math.min(W / oldW, H / oldH);
  const dx = (W - oldW * k) / 2;
  const dy = (H - oldH * k) / 2;

  for (const s of surfaces(design)) {
    for (let i = 0; i < s.layers.length; i++) {
      const l = s.layers[i];
      const o = l as unknown as Record<string, unknown>;
      const spec = o[SPEC_FIELD] as Record<string, unknown> | undefined;
      const full = coversCanvas(l, oldW, oldH);

      if (spec && full) {
        // The case the round-trip unlocks: hand the preset the NEW page box and
        // let it lay itself out again, instead of shrinking yesterday's layout.
        resetPresetFitReports();
        try {
          const env = o[SPEC_ENV_FIELD] as Record<string, unknown> | undefined;
          // It covered the OLD canvas, so it must cover the new one. A flow
          // preset content-SIZES by default: re-expanded into a taller box it
          // would stop at the height its content needs and leave an unpainted
          // strip below (a 1080x1350 slide painted only to y=972). __fillPage is
          // the engine's own "span this page and centre in it" marker — the same
          // one fillFlowPresetsToPage stamps when a slide is composed.
          const fills = FLOW_PAGE_PRESETS.has(String(spec['type'] ?? '').toLowerCase());
          const next = { ...spec, pos: [0, 0, W, H] };
          const built = expandShorthandLayers([toShorthand({ ...next, id: o['id'] }, { ...env, ...(fills ? { __fillPage: true } : {}) }, theme)]);
          if (built.length) {
            s.layers[i] = built[0];
            out.reexpanded++;
            out.notes.push(...drainPresetFitReports().map(r => r.note));
            continue;
          }
        } catch {
          // Fall through to scaling — a preset that will not rebuild is still
          // better carried across at the old layout than dropped.
        }
      }
      scaleSubtree(l, k, 0, 0, dx);
      // scaleSubtree only shifts x (it exists to centre a compressed preset
      // horizontally); a canvas whose ASPECT changed also needs the vertical
      // offset, or the content sits against the top edge.
      if (dy) shiftY(l, dy);
      // A SCALED preset keeps its spec, and the spec still described the box it
      // was authored at. patch_spec rebuilds from the spec, so editing a preset
      // after a resize resurrected yesterday's coordinates — a 1520-wide stat
      // reappearing on a 1080 canvas, 640px off the edge, reported as success.
      // The spec has to describe the design as it now IS, not as it was typed.
      syncSpecPos(l);
      out.scaled++;
    }
  }

  design.document.width = W;
  design.document.height = H;
  return out;
}

/**
 * Point a scaled layer's stored spec at the box it now occupies.
 *
 * Only `pos` is touched: everything else in the spec is authored intent, which
 * a resize does not change. Nested specs are synced too, so a preset inside a
 * `columns` container is corrected along with its parent.
 */
function syncSpecPos(layer: Layer): void {
  const o = layer as unknown as Record<string, unknown>;
  const spec = o[SPEC_FIELD] as Record<string, unknown> | undefined;
  if (spec) {
    const box = ['x', 'y', 'width', 'height'].map(k => o[k]);
    if (box.every(v => typeof v === 'number')) spec['pos'] = box as number[];
  }
  const kids = o['layers'];
  if (Array.isArray(kids)) for (const c of kids as Layer[]) syncSpecPos(c);
}

/** Move a subtree down by dy (absolute child coordinates, as everywhere here). */
function shiftY(layer: Layer, dy: number): void {
  const o = layer as unknown as Record<string, unknown>;
  for (const key of ['y', 'y1', 'y2'] as const) {
    if (typeof o[key] === 'number') o[key] = Math.round((o[key] as number) + dy);
  }
  const kids = o['layers'];
  if (Array.isArray(kids)) for (const c of kids as Layer[]) shiftY(c, dy);
}

// ── Shared customize body ───────────────────────────────────

interface CustomizeArgs {
  design_path: string;
  changes: Record<string, unknown>;
  project_path?: string;
  dry_run?: boolean;
}

/** `width` and `height` describe the CANVAS, not the settings block — split
 *  them out so a resize triggers a reflow and the rest is a plain merge. */
function splitCanvas(changes: Record<string, unknown>): { canvas: { w?: number; h?: number }; settings: Record<string, unknown> } {
  const settings = { ...changes };
  const canvas: { w?: number; h?: number } = {};
  if (typeof settings['width'] === 'number') { canvas.w = settings['width'] as number; delete settings['width']; }
  if (typeof settings['height'] === 'number') { canvas.h = settings['height'] as number; delete settings['height']; }
  return { canvas, settings };
}

/** The body both twins share: merge settings, resize + reflow, report. */
function customizeDocument(
  args: CustomizeArgs,
  op: string,
  kind: 'report' | 'presentation',
): ToolResult {
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  if (!args.changes || typeof args.changes !== 'object' || Array.isArray(args.changes)) {
    return errResult(op, 'changes must be an object of settings to merge.', `e.g. changes:{${kind === 'report' ? 'accent:"#0EA5E9", max_width:960' : 'theme:"light", transition:"fade"'}} — or {width:1080, height:1350} to re-shape the canvas.`);
  }

  const design = readYAML<DesignSpec>(dPath);
  if (design.meta.type !== kind) {
    return errResult(op, `"${design.meta.name}" is a ${design.meta.type}, not a ${kind}.`,
      kind === 'report'
        ? 'Use presentation {op:"customize"} for a deck, or edit_layer {op:"patch_spec"} for a preset on a poster.'
        : 'Use report {op:"customize"} for a report, or edit_layer {op:"patch_spec"} for a preset.', progress);
  }

  const { canvas, settings } = splitCanvas(args.changes);
  const current = ((design as unknown as Record<string, unknown>)[kind] ?? {}) as Record<string, unknown>;
  const merged = mergeSpecChanges(current, settings);
  const changedKeys = diffSpecKeys(current, merged);

  const W = canvas.w ?? design.document.width;
  const H = canvas.h ?? design.document.height;
  const resizing = W !== design.document.width || H !== design.document.height;
  if (changedKeys.length === 0 && !resizing) {
    return okResult(op, { changed: [], settings: merged, note: 'Every value already matched — nothing to change.', progress, context: buildContext(op, 'No-op customize') });
  }

  if (args.dry_run) {
    progress.push(pInfo('Dry run — nothing written', [...changedKeys, ...(resizing ? [`canvas ${design.document.width}×${design.document.height} → ${W}×${H}`] : [])].join(' · ')));
    return okResult(op, {
      changed: changedKeys, settings: merged,
      ...(resizing ? { canvas: `${design.document.width}×${design.document.height} → ${W}×${H}`, would_reflow: true } : {}),
      progress, context: buildContext(op, `Dry run on "${design.meta.name}"`),
    });
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  (design as unknown as Record<string, unknown>)[kind] = merged;

  let reflow: ReflowResult | null = null;
  if (resizing) {
    const from = `${design.document.width}×${design.document.height}`;
    reflow = reflowToCanvas(design, W, H);
    progress.push(pOk(`Canvas ${from} → ${W}×${H}`, `${reflow.reexpanded} preset(s) re-laid out from their spec, ${reflow.scaled} layer(s) scaled`));
    for (const n of reflow.notes) progress.push(pWarn('Preset compressed to fit its box', n));
  }
  if (changedKeys.length) progress.push(pOk(`Updated ${kind} settings`, changedKeys.join(' ')));

  design.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, design);

  const next_action: NextAction = { tool: 'render_preview', params: { design_path: dPath }, remaining: -1, hint: 'Look at the result, then customize again or seal_design.' };
  return okResult(op, {
    changed: changedKeys, settings: merged,
    ...(reflow ? { canvas: `${W}×${H}`, reflowed: { presets_reexpanded: reflow.reexpanded, layers_scaled: reflow.scaled } } : {}),
    ...(reflow?.notes.length ? { notes: reflow.notes } : {}),
    next_action, progress,
    context: buildContext(op, `Customized "${design.meta.name}"`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}

/** report {op:"customize"} — restyle a report in place. */
export function customizeReport(args: { design_path: string; changes: Record<string, unknown>; project_path?: string; dry_run?: boolean }): ToolResult {
  return customizeDocument(args, 'customize_report', 'report');
}

/** presentation {op:"customize"} — restyle or re-shape a deck in place. */
export function customizePresentation(args: { design_path: string; changes: Record<string, unknown>; project_path?: string; dry_run?: boolean }): ToolResult {
  return customizeDocument(args, 'customize_presentation', 'presentation');
}

// ── resize ──────────────────────────────────────────────────

/** manage_design {op:"resize"} — the twin for create_design's canvas.
 *
 *  A poster or carousel has no settings block to merge into; its one
 *  generation parameter that cannot be changed afterwards is its SHAPE. Same
 *  reflow as the two above, so a square poster becomes a portrait one by
 *  re-laying out its presets rather than by being rebuilt. */
export function resizeDesign(args: {
  design_path: string; width?: number; height?: number;
  project_path?: string; dry_run?: boolean;
}): ToolResult {
  const op = 'resize';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const design = readYAML<DesignSpec>(dPath);
  const W = typeof args.width === 'number' && args.width > 0 ? Math.round(args.width) : design.document.width;
  const H = typeof args.height === 'number' && args.height > 0 ? Math.round(args.height) : design.document.height;
  if (W === design.document.width && H === design.document.height) {
    return okResult(op, { changed: false, canvas: `${W}×${H}`, note: 'Already that size — nothing to do.', progress, context: buildContext(op, 'No-op resize') });
  }
  if (W < 80 || H < 80 || W > 20000 || H > 20000) {
    return errResult(op, `Refusing a ${W}×${H} canvas.`, 'Width and height must each be between 80 and 20000 px.', progress);
  }

  const from = `${design.document.width}×${design.document.height}`;
  if (args.dry_run) {
    const presets = surfaces(design).reduce((n, s) => n + s.layers.filter(l => (l as unknown as Record<string, unknown>)[SPEC_FIELD]).length, 0);
    progress.push(pInfo('Dry run — nothing written', `${from} → ${W}×${H}`));
    return okResult(op, { changed: true, canvas: `${from} → ${W}×${H}`, would_reflow: true, presets_with_spec: presets, progress, context: buildContext(op, `Dry run resize of "${design.meta.name}"`) });
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  const reflow = reflowToCanvas(design, W, H);
  design.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, design);

  progress.push(pOk(`Canvas ${from} → ${W}×${H}`, `${reflow.reexpanded} preset(s) re-laid out from their spec, ${reflow.scaled} layer(s) scaled`));
  for (const n of reflow.notes) progress.push(pWarn('Preset compressed to fit its box', n));
  const next_action: NextAction = { tool: 'render_preview', params: { design_path: dPath }, remaining: -1, hint: 'Look at the new shape, then patch_spec anything the re-layout got wrong.' };
  return okResult(op, {
    changed: true, canvas: `${W}×${H}`,
    reflowed: { presets_reexpanded: reflow.reexpanded, layers_scaled: reflow.scaled },
    ...(reflow.notes.length ? { notes: reflow.notes } : {}),
    ...(reflow.reexpanded === 0 && reflow.scaled > 0
      ? { note: 'No preset carried a spec, so every layer was SCALED rather than re-laid out. Scaling preserves the old composition at a new size; a preset built since spec round-trip shipped would have been rebuilt for the new shape instead.' }
      : {}),
    next_action, progress,
    context: buildContext(op, `Resized "${design.meta.name}" to ${W}×${H}`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}

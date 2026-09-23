/**
 * diagnose_design {gate:true} — the one call before export.
 *
 * Finishing a piece took calls a model had to know to make, in an order it had
 * to know: heal the spatial faults, diagnose, review:true for the canvas and
 * each shot's rest, then turn each finding's prose fix into a call. The
 * benchmark builds made them in different orders, and every fix was a sentence
 * to translate. The gate is all of it at once. Spatial faults are healed first
 * (the heal loop: off-canvas, tiny text, overflowing presets — never palette,
 * hierarchy or copy, §0.4); then everything is measured on the healed design —
 * the checks, the motion at each shot's rest, the soundtrack's beat (measured
 * by the handler before this runs), the review of each page. The answer is
 * whether the piece is ready, and the three things most worth doing next, each
 * with the exact call when the check can work it out.
 *
 * Ready means no error and no warning is left; suggestions and review notes
 * are for judgement and never hold a piece back.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../../schema/types';
import type { ToolResult, ProgressItem, NextAction } from '../types';
import type { FixCall } from './diagnose';
import { resolveDesignPath, readYAML, errResult, okResult, pOk, pInfo, buildContext } from './utils';
import { collectFindings, rankForDisplay, type PageFinding } from './diagnose-collect';
import { healDesign } from '../engine-heal-tools';
import { resolveImageAssets } from './asset-resolve';
import { reviewLayout } from './layout-review';
import { withMotion } from './layout-review-motion';
import { animationDuration } from '../../export/gif-frames';

/** One thing to do before export. */
export interface GateItem {
  severity: 'error' | 'warning' | 'suggestion' | 'note';
  code: string;
  page?: string;
  layer_id?: string;
  why: string;
  /** Ready to send as it is. */
  call?: FixCall;
  how?: string;
}

const TOP = 3;

/**
 * Severity first. Within one, a finding the gate can hand over as a call comes
 * before one the model has to work out, and one of each kind before a second
 * of any (rankForDisplay) — three copies of one problem would hide the rest.
 */
export function rankGate(items: GateItem[]): GateItem[] {
  const out: GateItem[] = [];
  for (const sev of ['error', 'warning', 'suggestion'] as const) {
    const here = items.filter(i => i.severity === sev);
    out.push(...rankForDisplay([...here.filter(i => i.call), ...here.filter(i => !i.call)], Infinity));
  }
  return [...out, ...items.filter(i => i.severity === 'note')];
}

/** A finding as a gate item, its call addressed to this design. */
function asItem(f: PageFinding, target: Record<string, string>): GateItem {
  return {
    severity: f.severity, code: f.code, ...(f.page ? { page: f.page } : {}), ...(f.layer_id ? { layer_id: f.layer_id } : {}),
    why: f.message,
    ...(f.call ? { call: { tool: f.call.tool, params: { ...target, ...f.call.params } } } : {}),
    ...(f.fix ? { how: f.fix } : {}),
  };
}

/** The review's measured facts, page by page and shot by shot — notes for the model to judge. */
function reviewItems(spec: DesignSpec, dPath: string, projectPath: string | undefined, progress: ProgressItem[]): GateItem[] {
  try {
    const seen = JSON.parse(JSON.stringify(spec)) as DesignSpec;
    resolveImageAssets(seen, dPath, projectPath);
    const projDir = projectPath ?? path.dirname(path.dirname(dPath));
    const pages = withMotion(reviewLayout(seen, projDir), seen, projDir);
    const note = (why: string, page?: string): GateItem => ({ severity: 'note', code: 'review', ...(page ? { page } : {}), why });
    return pages.flatMap(p => [
      ...p.notes.map(n => note(n, p.page)),
      ...(p.motion?.shots ?? []).flatMap(s => s.notes.map(n => note(`In "${s.shot}": ${n}`, p.page))),
      ...(p.motion?.notes ?? []).map(n => note(n, p.page)),
    ]);
  } catch (err) {
    progress.push(pInfo('Review skipped', (err as Error).message));
    return [];
  }
}

/** Whether anything on any page moves. */
function moves(spec: DesignSpec): boolean {
  const trees: Layer[][] = [spec.layers ?? [], ...(spec.pages ?? []).map(p => p.layers ?? [])];
  return trees.some(t => animationDuration(t) > 0);
}

/** What to send next: the first fix while anything holds the piece back, else the export. */
function nextAction(ready: boolean, top: GateItem[], spec: DesignSpec, dPath: string, left: number): NextAction {
  const first = top[0];
  if (!ready && first?.call) {
    return { tool: first.call.tool, params: first.call.params, remaining: left, hint: `${first.why} Send it as it is, then run diagnose_design {gate:true} again.` };
  }
  if (!ready) return { tool: 'render_preview', params: { design_path: dPath }, remaining: left, hint: first?.how ?? 'Look at what is left — it needs a judgement, not a mechanical fix.' };
  return moves(spec)
    ? { tool: 'animation', params: { op: 'export', design_path: dPath }, remaining: 0, hint: 'Ready. type: gif, or mp4 / webm to carry the sound.' }
    : { tool: 'export_design', params: { design_path: dPath, format: 'png' }, remaining: 0, hint: 'Ready. format: png, or pdf / svg / pptx.' };
}

export function gateDesign(args: { design_path: string; project_path?: string; dry_run?: boolean }): ToolResult {
  const op = 'gate';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const progress: ProgressItem[] = [];

  // 1. Heal what is spatial — or, on a dry run, say what healing would do.
  const heal = healDesign({ design_path: dPath, ...(args.project_path ? { project_path: args.project_path } : {}), ...(args.dry_run ? { dry_run: true } : {}) }) as ToolResult & { fixed?: string[]; would_fix?: string[] };
  const healed = (args.dry_run ? heal.would_fix : heal.fixed) ?? [];
  progress.push(healed.length ? pOk(args.dry_run ? 'Would heal' : 'Healed', healed.join(' · ')) : pInfo('Nothing spatial to heal', 'on canvas, readable sizes'));

  // 2. Everything measured on the design as it now is.
  const spec = readYAML<DesignSpec>(dPath);
  const findings = collectFindings(spec, dPath, args.project_path);
  const target = { design_path: dPath, ...(args.project_path ? { project_path: args.project_path } : {}) };
  const items = rankGate([...findings.map(f => asItem(f, target)), ...reviewItems(spec, dPath, args.project_path, progress)]);

  // 3. The verdict and the three things most worth doing.
  const count = (s: GateItem['severity']): number => items.filter(i => i.severity === s).length;
  const counts = { errors: count('error'), warnings: count('warning'), suggestions: count('suggestion'), notes: count('note') };
  const ready = counts.errors === 0 && counts.warnings === 0;
  const top = items.slice(0, TOP);
  const verdict = !ready
    ? `Not ready — ${counts.errors} error(s) and ${counts.warnings} warning(s) left. The first fix is next_action.`
    : items.length ? `Ready to export — nothing holds it back; ${items.length} thing(s) to judge, the top ${top.length} below.` : 'Ready to export — nothing left to fix or judge.';
  progress.push(pOk('Gate', verdict));

  return okResult(op, {
    ready, verdict,
    ...(healed.length ? { [args.dry_run ? 'would_heal' : 'healed']: healed } : {}),
    counts, top,
    ...(items.length > TOP ? { more: `${items.length - TOP} more — diagnose_design (review:true) lists them all.` } : {}),
    next_action: nextAction(ready, top, spec, dPath, counts.errors + counts.warnings),
    progress, context: buildContext(op, `Gate on "${spec.meta?.name ?? path.basename(dPath)}" — ${ready ? 'ready' : 'not ready'}`),
  }, typeof heal.backup === 'string' ? heal.backup : undefined);
}

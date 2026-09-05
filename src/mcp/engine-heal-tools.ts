// Folio MCP engine — the self-heal loop.
//
//     diagnose  →  fix  →  re-diagnose  →  repeat until clean or stuck
//
// Every piece this needs was built in the three commits before it, and none of
// them worked alone:
//   · diagnose had to stop lying, or the loop would "fix" a design that was
//     already fine and pass one that was broken (it scored a clipped deck
//     "0 errors" before);
//   · presets had to carry their spec, or a fix could only nudge coordinates on
//     thirty generated layers it does not understand — the loop would fight the
//     layout instead of changing the intent behind it;
//   · a design needed a token table, or "the background is missing" had no
//     principled colour to fill it with.
//
// WHAT IT WILL FIX, and the line it does not cross. CLAUDE.md §0.4: the model
// designs, the engine assists. So this heals SPATIAL CORRECTNESS and LEGIBILITY
// — content off the canvas, text too small to read, text the same colour as what
// is behind it, layers with no position, a page with no ground. It does not
// touch palette, hierarchy, composition or copy: a loop that quietly re-made
// aesthetic decisions would make every output converge, which is the failure
// §0.4 exists to prevent. Those findings are REPORTED for the model to judge.
//
// Progress is the stop condition, not a round count: if a pass fixes nothing,
// looping again cannot help, so it stops and says what is left and why.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult, ProgressItem, NextAction } from './types';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';
import { analyzeLayers, type Finding } from './engine/diagnose';
import { finalizeSpecPages } from './engine-finalize-pages';
import { resolveThemeColors } from './engine-layer-predicates';
import { expandShorthandLayers } from './shorthand-parser';
import { resetPresetFitReports, drainPresetFitReports, PRESET_FIT_MIN_SCALE } from './preset-fit';
import { specOf, toShorthand } from './design-spec';
import { collectTokens } from './design-tokens';

/** Findings this loop is allowed to act on — correctness and legibility only. */
const HEALABLE = new Set(['off_canvas', 'tiny_text', 'invisible_text', 'low_contrast', 'text_overflow', 'missing_background']);

/** Smallest comfortable body size; below this diagnose calls it tiny_text. */
const MIN_FONT = 14;

/** One pass of the loop. */
export interface HealRound {
  round: number;
  errors_before: number;
  errors_after: number;
  fixed: string[];
}

/** Every page's layers, tagged. */
function surfaces(design: DesignSpec): { pageId?: string; layers: Layer[] }[] {
  if (design.pages?.length) return design.pages.map(p => ({ pageId: p.id, layers: p.layers ?? [] }));
  return [{ layers: design.layers ?? [] }];
}

/** Diagnose the whole design, page by page. */
function diagnoseAll(design: DesignSpec): (Finding & { page?: string })[] {
  const W = design.document?.width ?? 1080, H = design.document?.height ?? 1080;
  const out: (Finding & { page?: string })[] = [];
  for (const s of surfaces(design)) {
    for (const f of analyzeLayers(s.layers, W, H)) out.push(s.pageId ? { ...f, page: s.pageId } : f);
  }
  return out;
}

// ── Fix: a preset whose content leaves the canvas ───────────

/** Re-expand a preset into the FULL canvas box so preset-fit compresses it to
 *  fit, instead of drawing past the edge.
 *
 *  This is the fix the spec round-trip bought. Without a spec the only move is
 *  to shove generated children back inside one by one, which breaks the layout
 *  the builder computed — the group ends up inside the canvas and looking wrong.
 *  Rebuilding from the intent re-lays it out at the size it actually has. */
function healPresetOverflow(design: DesignSpec, fixed: string[]): number {
  // A flow report has no fixed canvas: computeFlowLayout derives geometry at
  // render time from span/flow_h, so the stored coordinates are not where the
  // content ends up and "outside the canvas" means nothing here.
  if (design.meta?.type === 'report') return 0;
  const W = design.document?.width ?? 1080, H = design.document?.height ?? 1080;
  const theme = resolveThemeColors(design) ?? undefined;
  let n = 0;
  for (const s of surfaces(design)) {
    for (let i = 0; i < s.layers.length; i++) {
      const l = s.layers[i];
      const o = l as unknown as Record<string, unknown>;
      const spec = specOf(l);
      if (!spec) continue;
      // Does anything in this group actually render outside the canvas?
      if (!subtreeEscapes(l, W, H)) continue;
      resetPresetFitReports();
      try {
        const built = expandShorthandLayers([
          toShorthand({ ...spec.spec, pos: [0, 0, W, H], id: o['id'] }, { ...spec.env, __fixedCanvas: true, __fillPage: true }, theme),
        ]);
        if (!built.length) continue;
        const reports = drainPresetFitReports();
        // Still overflowing at the compression floor? Then this is a CONTENT
        // problem, not a geometry one, and no amount of engine work fixes it —
        // leave the design alone and let the report say what has to be cut.
        const stuck = reports.some(r => r.overflow > 0);
        if (stuck) continue;
        s.layers[i] = built[0];
        n++;
        fixed.push(`re-laid out preset "${o['id']}" into the ${W}×${H} canvas${reports.length ? ` (compressed ${reports[0].scale}×)` : ''}`);
      } catch { /* a preset that will not rebuild is left for the model */ }
    }
  }
  return n;
}

/** Does any content-bearing descendant render outside the canvas? */
function subtreeEscapes(layer: Layer, W: number, H: number, depth = 0): boolean {
  const o = layer as unknown as Record<string, unknown>;
  const kids = o['layers'];
  if (Array.isArray(kids)) {
    for (const c of kids as Layer[]) if (subtreeEscapes(c, W, H, depth + 1)) return true;
    return false;
  }
  if (depth === 0) return false;
  const x = Number(o['x']) || 0, y = Number(o['y']) || 0;
  const w = Number(o['width']) || 0, h = Number(o['height']) || 0;
  if (w <= 0 || h <= 0) return false;
  return Math.max(-x, -y, x + w - W, y + h - H) > 8;
}

// ── Fix: text too small to read ─────────────────────────────

/** Raise sub-legible text to the floor. On a preset this goes through the SPEC
 *  where the preset exposes a size, so the builder re-derives its whole type
 *  scale rather than one layer drifting out of the ladder. */
function healTinyText(design: DesignSpec, fixed: string[]): number {
  let n = 0;
  const bump = (l: Layer): void => {
    const o = l as unknown as Record<string, unknown>;
    if (o['type'] === 'text') {
      const style = o['style'] as Record<string, unknown> | undefined;
      const size = typeof style?.['font_size'] === 'number' ? style['font_size'] as number : undefined;
      if (style && size !== undefined && size > 0 && size < MIN_FONT) {
        style['font_size'] = MIN_FONT;
        n++;
        fixed.push(`raised text "${o['id']}" from ${size}px to ${MIN_FONT}px`);
      }
    }
    const kids = o['layers'];
    if (Array.isArray(kids)) for (const c of kids as Layer[]) bump(c);
  };
  for (const s of surfaces(design)) for (const l of s.layers) bump(l);
  return n;
}

// ── Fix: content stranded off the canvas ────────────────────

/** Pull a hand-placed layer back inside. Only for layers with no spec: a preset
 *  is re-laid out (above), never shoved. */
function healStrayLayers(design: DesignSpec, fixed: string[]): number {
  const W = design.document?.width ?? 1080, H = design.document?.height ?? 1080;
  let n = 0;
  for (const s of surfaces(design)) {
    for (const l of s.layers) {
      const o = l as unknown as Record<string, unknown>;
      if (specOf(l)) continue;
      const x = Number(o['x']), y = Number(o['y']);
      const w = Number(o['width']) || 0, h = Number(o['height']) || 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || w <= 0 || h <= 0) continue;
      // A layer deliberately bled off one edge is a design move; one that is
      // ENTIRELY outside is a mistake with no other reading.
      const outside = x + w <= 0 || y + h <= 0 || x >= W || y >= H;
      if (!outside) continue;
      o['x'] = Math.max(0, Math.min(x, W - w));
      o['y'] = Math.max(0, Math.min(y, H - h));
      n++;
      fixed.push(`pulled "${o['id']}" back onto the canvas from (${Math.round(x)}, ${Math.round(y)})`);
    }
  }
  return n;
}

// ── The loop ────────────────────────────────────────────────

/** Everything the loop deliberately did not touch, phrased for the model. */
function handOff(findings: (Finding & { page?: string })[]): { code: string; message: string; fix?: string; page?: string }[] {
  return findings.map(f => ({ code: f.code, message: f.message, ...(f.fix ? { fix: f.fix } : {}), ...(f.page ? { page: f.page } : {}) }));
}

export function healDesign(args: {
  design_path: string; project_path?: string; max_rounds?: number; dry_run?: boolean;
}): ToolResult {
  const op = 'heal';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');
  const design = readYAML<DesignSpec>(dPath);

  const rounds = Math.max(1, Math.min(args.max_rounds ?? 3, 5));
  const before = diagnoseAll(design);
  const errorsBefore = before.filter(f => f.severity === 'error').length;
  const log: HealRound[] = [];
  const allFixed: string[] = [];

  for (let r = 1; r <= rounds; r++) {
    const errsBefore = diagnoseAll(design).filter(f => f.severity === 'error').length;
    if (errsBefore === 0 && r > 1) break;
    const fixed: string[] = [];

    // The rescue chain that only ever ran at compose time: null layers,
    // positionless layers, a missing ground, collisions, invisible text.
    const t = finalizeSpecPages(design);
    for (const [n, what] of [[t.nulls, 'null layer(s) dropped'], [t.recovered, 'JSON-in-text layer(s) recovered'], [t.placed, 'positionless layer(s) flowed'], [t.bgFilled, 'background filled'], [t.reflowed, 'overlapping layer(s) reflowed'], [t.relit, 'invisible text re-lit']] as [number, string][]) {
      if (n) fixed.push(`${n} ${what}`);
    }
    healPresetOverflow(design, fixed);
    healStrayLayers(design, fixed);
    healTinyText(design, fixed);

    const errsAfter = diagnoseAll(design).filter(f => f.severity === 'error').length;
    log.push({ round: r, errors_before: errsBefore, errors_after: errsAfter, fixed });
    allFixed.push(...fixed);
    progress.push(pInfo(`Round ${r}`, fixed.length ? `${fixed.length} fix(es) · ${errsBefore} → ${errsAfter} error(s)` : 'nothing left this pass could fix'));
    // Progress, not a round count, is the stop condition: another identical pass
    // cannot do better than the one that just changed nothing.
    if (fixed.length === 0 || errsAfter === 0) break;
  }

  const after = diagnoseAll(design);
  const errorsAfter = after.filter(f => f.severity === 'error').length;
  const remaining = after.filter(f => f.severity === 'error' || f.severity === 'warning');
  const forModel = remaining.filter(f => !HEALABLE.has(f.code));
  const stuck = remaining.filter(f => HEALABLE.has(f.code));

  if (args.dry_run) {
    progress.push(pInfo('Dry run — nothing written', `${allFixed.length} fix(es) would apply`));
    return okResult(op, {
      would_fix: allFixed, rounds: log,
      errors_before: errorsBefore, errors_after: errorsAfter,
      progress, context: buildContext(op, `Dry run heal of ${path.basename(dPath)}`),
    });
  }

  let bak: string | undefined;
  if (allFixed.length) {
    bak = snapshot(dPath);
    progress.push(pInfo('Snapshot created', path.basename(bak)));
    design.meta.modified = new Date().toISOString().split('T')[0];
    writeYAML(dPath, design);
    progress.push(pOk(`Healed ${allFixed.length} issue(s)`, `${errorsBefore} → ${errorsAfter} error(s) in ${log.length} round(s)`));
  } else {
    progress.push(pOk('Nothing to heal', errorsBefore === 0 ? 'the design was already clean' : 'no finding was mechanically fixable'));
  }
  for (const f of stuck) progress.push(pWarn(`Could not fix [${f.code}]`, f.message));

  // The honest hand-off: what is left, and WHY the loop did not touch it. A
  // finding it could have fixed but did not is a different situation from one it
  // is not allowed to fix, and the model needs to be able to tell them apart.
  const next_action: NextAction = errorsAfter > 0
    ? { tool: 'render_preview', params: { design_path: dPath }, remaining: -1, hint: 'Look at what is left — the remaining findings need a judgement call (cut content, change the palette, restructure), not a mechanical fix.' }
    : { tool: 'seal_design', params: { design_path: dPath }, remaining: 0, hint: 'No errors left. Seal it.' };

  const tokens = collectTokens(design).table;
  return okResult(op, {
    fixed: allFixed, rounds: log,
    errors_before: errorsBefore, errors_after: errorsAfter,
    ...(stuck.length ? { could_not_fix: handOff(stuck) } : {}),
    ...(forModel.length ? { for_you_to_judge: handOff(forModel) } : {}),
    ...(forModel.length ? { note: 'These are design decisions, not correctness bugs — palette, hierarchy, density and copy are yours. The loop only fixes spatial correctness and legibility, so that repeated healing never converges every design on one look.' } : {}),
    ...(Object.keys(tokens).length ? { tokens } : {}),
    next_action, progress,
    context: buildContext(op, `Healed ${path.basename(dPath)} — ${errorsBefore} → ${errorsAfter} error(s)`, [{ type: 'design', path: dPath, role: 'updated' }]),
    handover: buildHandover('PATCH', { design_path: dPath }),
  }, bak);
}

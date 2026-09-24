// What is wrong with this design — the ONE composition of the checks.
//
// diagnose_design assembles its findings from five sources: the geometry/
// contrast analysis per surface, the image audit, the flat-text-style walk,
// (since the group-alias find) the renderer itself, and — last to arrive — the
// schema validator. Nothing else could ask the same question without restating
// that list, and one caller very much needed to.
//
// `seal_design` is the last gate before a design is called complete and its
// share link handed to a user. It refuses a blank poster and a blank carousel
// page, runs its rescue sweep — and never consults the diagnosis. Measured on
// the live corpus: 7 of 276 designs are `_mode: complete` with errors their own
// diagnostic reports, one of them with 38 clipped layers. Live, end to end:
//
//     diagnose_design → "1 error(s) + 0 warning(s) to fix."
//     seal_design     → status: sealed, remaining: 0,
//                       "give the user this link EXACTLY as written"
//
// Restating the list here would have been the session's most-repeated mistake
// (a rule with two implementations, drifting), so both callers share this.

import type { DesignSpec, Layer, Page } from '../../schema/types';
import { analyzeLayers, flatTextStyleFindings, type Finding } from './diagnose';
import { auditImageAssets } from './asset-resolve';
import { renderFailureFindings } from './diagnose-render';
import { motionFindings } from './diagnose-motion';
import { safeAreaFindings } from './diagnose-safe';
import { beatFindings } from './diagnose-beats';
import { glyphFindings } from './diagnose-glyphs';
import { overprintFindings } from './diagnose-overprint';
import { orphanFindings } from './diagnose-orphan';
import { moments } from './diagnose-safe';
import { accentNote } from './ai-slop-lint';
import { validateDesignSpec } from '../../schema/validator';
import { resolveAutoLayouts } from '../../renderer/auto-layout-place';

export type PageFinding = Finding & { page?: string };

/**
 * What the SCHEMA says is wrong — the source that ran nowhere but export.
 *
 * `validateDesignSpec` knows exactly what a broken layer is and where it sits
 * (`pages[0].layers[1].type  Unknown layer type: "bg"`), and it was consulted
 * only by export_design, at the very last step. So a design could be
 * diagnosed clean, sealed, and its share link handed over, while carrying an
 * error that its own validator names precisely. Same shape as every door
 * fault this codebase keeps finding: the right capability, wired to one door.
 *
 * ERRORS ONLY, deliberately. Across the live corpus the validator's warnings
 * are 9,934 findings on 117 designs and almost all of them are "Duplicate
 * z-index", which is harmless here — the renderer sorts stably, so equal z
 * keeps document order. Adding those would bury the findings diagnose exists
 * to surface. The errors are 7 designs in 432, and every one of them would
 * fail export today.
 */
export function schemaFindings(spec: DesignSpec): Finding[] {
  let errors;
  try {
    errors = validateDesignSpec(spec).filter(e => e.severity === 'error');
  } catch {
    return []; // a validator crash must not take the whole diagnosis with it
  }
  return errors.map(e => ({
    code: 'schema',
    severity: 'error' as const,
    message: `${e.message} (${e.path})`,
    fix: 'Fix the field the path names. This is a hard schema error — export_design refuses it.',
  }));
}

/**
 * Every finding for `spec`, across each surface it has.
 *
 * `pageId` scopes to one page of a paged design — the renderer audit is skipped
 * there, because it draws the whole document and would report other pages.
 */
const ACCENT = /^one accent hue appears on /;

/**
 * A moving page's accent count as seen: at its shot rests, not over every layer it
 * ever shows (r7, b27: six mint surfaces over four beats, three at most on screen).
 */
function asSeen(spec: DesignSpec, still: Finding[], layers: Layer[], page?: Page): Finding[] {
  const shots = moments(spec, layers, page);
  if (shots.length === 0 || shots[0]?.t === null) return still;
  const note = accentNote(layers, shots.map(m => m.frame));
  const kept = still.filter(f => !(f.code === 'ai_slop' && ACCENT.test(f.message)));
  return note ? [...kept, { code: 'ai_slop', severity: 'suggestion', message: note }] : kept;
}

export function collectFindings(
  spec: DesignSpec,
  designPath: string,
  projectPath?: string,
  pageId?: string,
): PageFinding[] {
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  // A moving surface is also judged where each shot rests (diagnose-motion.ts).
  const run = (raw: Layer[] | undefined, page?: Page): PageFinding[] => {
    // Measured where the renderer draws: an auto-layout container's children carry no x/y of their own.
    const layers = resolveAutoLayouts(raw ?? []);
    const moving = motionFindings(spec, layers, page);
    // A pair judged where the shots rest is not judged again as authored.
    // The static message names its pair first: "a" and "b" (both text) overlap …
    const pair = (f: Finding): string => (f.layers ?? [...f.message.matchAll(/"([^"]+)"/g)].slice(0, 2).map(m => m[1] ?? '')).slice().sort().join('+');
    const atRest = new Set(moving.filter(f => f.code === 'motion_overlap' || f.code === 'motion_collision').map(pair));
    const safe = safeAreaFindings(spec, layers, page);
    // The critic's left-edge note is the old, narrower form of title_safe (declared boxes, one edge).
    const edged = safe.some(f => f.code === 'title_safe');
    const still = analyzeLayers(layers, W, H, page ? page.world : spec.world)
      .filter(f => f.code !== 'collision' || !atRest.has(pair(f)))
      .filter(f => !(edged && /crowds the edge/.test(f.message)));
    const glyphs = glyphFindings(layers, designPath, projectPath);
    const overprint = overprintFindings(layers, W, H);
    const orphans = orphanFindings(spec, layers, page);
    return [...asSeen(spec, still, layers, page), ...moving, ...safe, ...glyphs, ...overprint, ...orphans].map(f => (page ? { ...f, page: page.id } : f));
  };

  const findings: PageFinding[] = [];
  if (pageId && spec.pages) {
    const page = spec.pages.find(p => p.id === pageId);
    findings.push(...(page ? run(page.layers, page) : []));
  } else if (spec.pages) {
    for (const page of spec.pages) findings.push(...run(page.layers, page));
  } else {
    findings.push(...run(spec.layers));
  }

  // Scene cuts off the soundtrack's beat — once the music is measured (diagnose-beats.ts).
  if (!pageId) findings.push(...beatFindings(spec, designPath));
  // Unresolvable image srcs (blank in exports) + distortion/upscale.
  findings.push(...auditImageAssets(spec, designPath, projectPath));
  // Styling written at layer level that the renderer ignores (see diagnose.ts).
  findings.push(...flatTextStyleFindings(spec));
  // Ask the renderer whether every layer actually draws.
  if (!pageId) findings.push(...renderFailureFindings(spec));
  // Ask the SCHEMA. Whole-spec, so it is skipped when scoped to one page —
  // its paths address the document, not the surface.
  if (!pageId) findings.push(...schemaFindings(spec));
  return findings;
}

/**
 * The `limit` findings most worth showing, when there are more than fit.
 *
 * The reply caps its findings list to stay small, and it used to keep whichever
 * ones were gathered FIRST. Two things went wrong with that. Late passes were
 * cut wholesale on a busy design — the schema validator among them, so a hard
 * "Unknown layer type" was collected and never shown. And forty copies of one
 * problem crowded out every other KIND of problem, so a model fixed the
 * off-canvas layers, re-diagnosed, and only then discovered the next thing.
 *
 * So: errors before warnings before suggestions, and within each severity, one
 * of each code before a second of any. A model reading the visible list now
 * sees every kind of problem its design has, not one kind forty times.
 */
export function rankForDisplay<T extends { severity: string; code: string }>(
  findings: T[],
  limit: number,
): T[] {
  const out: T[] = [];
  for (const sev of ['error', 'warning', 'suggestion']) {
    const byCode = new Map<string, T[]>();
    for (const f of findings) {
      if (f.severity !== sev) continue;
      const bucket = byCode.get(f.code);
      if (bucket) bucket.push(f); else byCode.set(f.code, [f]);
    }
    // Round-robin the buckets: one of each code, then a second of each, …
    for (let round = 0; out.length < limit; round++) {
      let placed = false;
      for (const bucket of byCode.values()) {
        const f = bucket[round];
        if (!f) continue;
        out.push(f);
        placed = true;
        if (out.length >= limit) break;
      }
      if (!placed) break;
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** Just the errors — what a gate needs to decide whether a design is finished. */
export function errorFindings(
  spec: DesignSpec,
  designPath: string,
  projectPath?: string,
): PageFinding[] {
  return collectFindings(spec, designPath, projectPath).filter(f => f.severity === 'error');
}

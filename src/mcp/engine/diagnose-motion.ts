/**
 * diagnose_design on a page that MOVES: what collides where each shot rests,
 * and how the piece is paced.
 *
 * The static checks judge the page as authored, and for a moving piece that is
 * only its opening state — or, with in/out points, several states piled on one
 * spot. The composition lint judges each shot at its rest (text on text, text
 * buried under a shape, objects the motion cut into each other, text off the
 * frame, links to nothing), but only op:lint and op:storyboard replied with it:
 * a model calling diagnose_design — the door a one-shot build goes through —
 * never heard that two things collide in shot 2. The pacing notes stayed behind
 * that door longer still: words gone before they are read, lines landing all
 * at once, a piece that never holds still, a dead stretch.
 */

import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { Finding } from './diagnose';
import { animationDuration } from '../../export/gif-frames';
import { lintComposition, type LintKind } from './motion-lint';
import { readMarkers } from './motion-time';

/** Each lint note as a finding: where things rest, then how the piece is paced. */
const AS_FINDING: Record<LintKind, { severity: Finding['severity']; fix: string }> = {
  collision: { severity: 'warning', fix: 'Move one clear at that shot, tuck it wholly behind or inside on purpose, or retime so they are not both there (animation op:storyboard / op:span).' },
  overlap: { severity: 'warning', fix: 'Move one line, or hide it before the other lands (op:storyboard state "hidden", or op:span out).' },
  buried: { severity: 'error', fix: 'Give the text (or its group) a z above the shape, or move one of them.' },
  off_canvas: { severity: 'warning', fix: 'Bring it inside the frame at that shot, or let the camera frame it.' },
  link: { severity: 'warning', fix: 'Point the link at a layer that moves (animation op:link / op:parent), or clear it.' },
  reading: { severity: 'warning', fix: 'Give the words time: animation op:retime at the shot\'s rest with shift_ms > 0 (op:scene length_ms for a page), bring them in sooner, or cut words.' },
  crowd: { severity: 'suggestion', fix: 'Stagger them in reading order — animation op:sequence or op:storyboard stagger_ms 80–200 — or land the headline first.' },
  restless: { severity: 'suggestion', fix: 'Open a rest: animation op:retime at a landing with shift_ms ≥ 1000, or make a background move a slow drift.' },
  busy: { severity: 'suggestion', fix: 'Stagger the moves, or let some land before the others start (op:sequence at / stagger_ms).' },
  idle: { severity: 'suggestion', fix: 'Hold on purpose, or close the gap: animation op:retime at the start of the still stretch with a negative shift_ms.' },
};

/** The time-aware findings of one surface, or none when nothing on it moves. */
export function motionFindings(spec: DesignSpec, layers: Layer[], page?: Page): Finding[] {
  const moving = animationDuration(layers);
  if (moving <= 0) return [];
  const held = page?.auto_advance;
  const end = typeof held === 'number' && held > 0 ? held : moving;
  const canvas = { width: spec.document?.width ?? 1080, height: spec.document?.height ?? 1080 };
  const marks = Object.entries(readMarkers(spec, page)).map(([id, at]) => ({ id, at: Number(at) })).filter(m => Number.isFinite(m.at));
  const pageId = page?.id && (spec.pages?.length ?? 0) > 1 ? { page_id: page.id } : {};
  return lintComposition(layers, canvas, marks, end).map((n): Finding => {
    const how = AS_FINDING[n.kind];
    // Words short of time: open that much at their landing — everything after it, the page's length included, moves later.
    const call = n.kind === 'reading' && n.at_ms !== undefined && n.short_ms
      ? { call: { tool: 'animation', params: { op: 'retime', ...pageId, at: String(n.at_ms), shift_ms: Math.ceil(n.short_ms / 100) * 100 } } } : {};
    return { code: `motion_${n.kind}`, severity: how.severity, message: n.note, fix: how.fix, ...call,
      ...(n.layers?.[0] ? { layer_id: n.layers[0] } : {}), ...(n.layers && n.layers.length > 1 ? { layers: n.layers } : {}) };
  });
}

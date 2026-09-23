/**
 * diagnose_design on a page that MOVES: what collides where each shot rests.
 *
 * The static checks judge the page as authored, and for a moving piece that is
 * only its opening state — or, with in/out points, several states piled on one
 * spot. The composition lint judges each shot at its rest (text on text, text
 * buried under a shape, objects the motion cut into each other, text off the
 * frame, links to nothing), but only op:lint and op:storyboard replied with it:
 * a model calling diagnose_design — the door a one-shot build goes through —
 * never heard that two things collide in shot 2.
 */

import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { Finding } from './diagnose';
import { animationDuration } from '../../export/gif-frames';
import { lintComposition, type LintKind } from './motion-lint';
import { readMarkers } from './motion-time';

/** The lint's spatial notes — where things are at rest. Pacing (idle, busy, reading) is not a collision. */
const SPATIAL: Partial<Record<LintKind, { severity: Finding['severity']; fix: string }>> = {
  collision: { severity: 'warning', fix: 'Move one clear at that shot, tuck it wholly behind or inside on purpose, or retime so they are not both there (animation op:storyboard / op:span).' },
  overlap: { severity: 'warning', fix: 'Move one line, or hide it before the other lands (op:storyboard state "hidden", or op:span out).' },
  buried: { severity: 'error', fix: 'Give the text (or its group) a z above the shape, or move one of them.' },
  off_canvas: { severity: 'warning', fix: 'Bring it inside the frame at that shot, or let the camera frame it.' },
  link: { severity: 'warning', fix: 'Point the link at a layer that moves (animation op:link / op:parent), or clear it.' },
};

/** The time-aware findings of one surface, or none when nothing on it moves. */
export function motionFindings(spec: DesignSpec, layers: Layer[], page?: Page): Finding[] {
  const moving = animationDuration(layers);
  if (moving <= 0) return [];
  const held = page?.auto_advance;
  const end = typeof held === 'number' && held > 0 ? held : moving;
  const canvas = { width: spec.document?.width ?? 1080, height: spec.document?.height ?? 1080 };
  const marks = Object.entries(readMarkers(spec, page)).map(([id, at]) => ({ id, at: Number(at) })).filter(m => Number.isFinite(m.at));
  return lintComposition(layers, canvas, marks, end).flatMap((n): Finding[] => {
    const how = SPATIAL[n.kind];
    return how ? [{ code: `motion_${n.kind}`, severity: how.severity, message: n.note, fix: how.fix, ...(n.layers?.[0] ? { layer_id: n.layers[0] } : {}) }] : [];
  });
}

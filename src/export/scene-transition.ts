/**
 * Scene transitions as group poses — how both scenes look mid-change.
 *
 * The HTML slideshow plays a PageTransition as CSS on whole slides. A GIF or
 * MP4 frame has no CSS, so each name becomes a pose for each scene's group — a
 * transform, an opacity, a blur, a clip — and the frame renders once, as
 * vectors: a zoom stays sharp and no pixels are blended by hand.
 *
 * Cube and flip turn in perspective (scene-transition-3d.ts). Anything a frame
 * can only approximate is named in APPROXIMATED, so a reply can say so rather
 * than swap it silently — nothing is, now.
 */

import type { PageTransitionType } from '../schema/types';
import type { ClipRect } from '../renderer/clip-rect';
import { resolveEasing } from '../animation/easing';
import { faceStrips, cubeFace, cardFace, type Face } from './scene-transition-3d';

/** How a scene is drawn mid-change: one pose (blur in canvas px), or — for a turning face — its strips (scene-transition-3d.ts). */
export interface ScenePose { transform?: string; opacity?: number; clip_rect?: ClipRect; blur?: number; face?: Face }

export interface TransitionPoses {
  from: ScenePose;
  to: ScenePose;
  /** Draw the outgoing scene above the incoming one (the first half of a flip). */
  fromOnTop: boolean;
  /** Part of the canvas is uncovered mid-transition — paint a backdrop under both. */
  backdrop: boolean;
  /** The backdrop is a stage a turning face moves in front of — darkened, so the face reads against it. */
  stage?: boolean;
}

export const APPROXIMATED: Partial<Record<PageTransitionType, string>> = {};

/** The slideshow's dissolve blurs each scene this far (canvas px) as it fades (animation/transition-css.ts). */
const DISSOLVE_BLUR = 8;

const f = (n: number): string => String(Number(n.toFixed(2)));
const move = (dx: number, dy: number): string => `translate(${f(dx)} ${f(dy)})`;
const scaleAbout = (sx: number, sy: number, cx: number, cy: number): string =>
  `translate(${f(cx)} ${f(cy)}) scale(${f(sx)} ${f(sy)}) translate(${f(-cx)} ${f(-cy)})`;

/** A turning face's pose — or nothing drawn when it is turned away. */
const turned = (face: Face | null): ScenePose => (face ? { face } : { opacity: 0 });

export function transitionPoses(type: PageTransitionType, progress: number, w: number, h: number, easing?: string): TransitionPoses {
  const p = resolveEasing(easing ?? 'ease-in-out')(Math.min(1, Math.max(0, progress)));
  const cx = w / 2, cy = h / 2;
  const both = (from: ScenePose, to: ScenePose, backdrop = false): TransitionPoses => ({ from, to, fromOnTop: false, backdrop });

  switch (type) {
    case 'fade':
      return both({}, { opacity: p });
    case 'dissolve':
      // As the HTML slideshow plays it: the old scene blurs out as it fades, the new one sharpens in.
      return both({ opacity: 1 - p, blur: DISSOLVE_BLUR * p }, { opacity: p, blur: DISSOLVE_BLUR * (1 - p) }, true);
    case 'slide-left':
      return both({ transform: move(-p * w, 0) }, { transform: move((1 - p) * w, 0) });
    case 'slide-right':
      return both({ transform: move(p * w, 0) }, { transform: move(-(1 - p) * w, 0) });
    case 'cube-left':
    case 'cube-right': {
      // The cube turns a quarter: the outgoing face swings away, its neighbour comes round to face us.
      const turn = (type === 'cube-left' ? -90 : 90) * p, next = turn + (type === 'cube-left' ? 90 : -90);
      return { ...both(turned(faceStrips('y', w, h, cubeFace(turn, w))), turned(faceStrips('y', w, h, cubeFace(next, w))), true), stage: true };
    }
    case 'slide-up':
      return both({ transform: move(0, -p * h) }, { transform: move(0, (1 - p) * h) });
    case 'slide-down':
      return both({ transform: move(0, p * h) }, { transform: move(0, -(1 - p) * h) });
    case 'zoom-in': {
      const grow = 1 + 0.1 * p, arrive = 0.85 + 0.15 * p;
      return both({ transform: scaleAbout(grow, grow, cx, cy) }, { transform: scaleAbout(arrive, arrive, cx, cy), opacity: p });
    }
    case 'zoom-out': {
      const shrink = 1 - 0.15 * p, arrive = 1.1 - 0.1 * p;
      return both({ transform: scaleAbout(shrink, shrink, cx, cy) }, { transform: scaleAbout(arrive, arrive, cx, cy), opacity: p }, true);
    }
    case 'morph': {
      const arrive = 0.96 + 0.04 * p;
      return both({}, { transform: scaleAbout(arrive, arrive, cx, cy), opacity: p });
    }
    case 'reveal':
    case 'wipe-left':
      return both({}, { clip_rect: { x: 0, y: 0, width: p * w, height: h } });
    case 'wipe-right':
      return both({}, { clip_rect: { x: (1 - p) * w, y: 0, width: p * w, height: h } });
    case 'flip-h':
    case 'flip-v': {
      // A card turning over about its centre line: the front shows to the half-turn, the back after.
      const axis = type === 'flip-h' ? 'y' : 'x', turn = 180 * p;
      return { ...both(turned(faceStrips(axis, w, h, cardFace(turn))), turned(faceStrips(axis, w, h, cardFace(turn - 180))), true), stage: true };
    }
    default:
      return both({}, {}); // 'none' — the caller plays it as a cut
  }
}

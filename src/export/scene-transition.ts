/**
 * Scene transitions as group poses — how both scenes look mid-change.
 *
 * The HTML slideshow plays a PageTransition as CSS on whole slides. A GIF or
 * MP4 frame has no CSS, so each name becomes a pose for each scene's group — a
 * transform, an opacity, a clip — and the frame renders once, as vectors: a
 * zoom stays sharp and no pixels are blended by hand.
 *
 * 3D names have no flat equivalent. cube-left/right play as slides and
 * flip-h/v as a squash through the centre line; APPROXIMATED names them so a
 * reply can say so rather than swap them silently.
 */

import type { PageTransitionType } from '../schema/types';
import type { ClipRect } from '../renderer/clip-rect';
import { resolveEasing } from '../animation/easing';

export interface ScenePose { transform?: string; opacity?: number; clip_rect?: ClipRect }

export interface TransitionPoses {
  from: ScenePose;
  to: ScenePose;
  /** Draw the outgoing scene above the incoming one (the first half of a flip). */
  fromOnTop: boolean;
  /** Part of the canvas is uncovered mid-transition — paint a backdrop under both. */
  backdrop: boolean;
}

export const APPROXIMATED: Partial<Record<PageTransitionType, string>> = {
  'cube-left': 'plays as slide-left — a flat frame has no 3D',
  'cube-right': 'plays as slide-right — a flat frame has no 3D',
  'flip-h': 'plays as a horizontal squash through the centre',
  'flip-v': 'plays as a vertical squash through the centre',
  dissolve: 'plays as a fade',
};

const f = (n: number): string => String(Number(n.toFixed(2)));
const move = (dx: number, dy: number): string => `translate(${f(dx)} ${f(dy)})`;
const scaleAbout = (sx: number, sy: number, cx: number, cy: number): string =>
  `translate(${f(cx)} ${f(cy)}) scale(${f(sx)} ${f(sy)}) translate(${f(-cx)} ${f(-cy)})`;

export function transitionPoses(type: PageTransitionType, progress: number, w: number, h: number, easing?: string): TransitionPoses {
  const p = resolveEasing(easing ?? 'ease-in-out')(Math.min(1, Math.max(0, progress)));
  const cx = w / 2, cy = h / 2;
  const both = (from: ScenePose, to: ScenePose, backdrop = false): TransitionPoses => ({ from, to, fromOnTop: false, backdrop });

  switch (type) {
    case 'fade':
    case 'dissolve':
      return both({}, { opacity: p });
    case 'slide-left':
    case 'cube-left':
      return both({ transform: move(-p * w, 0) }, { transform: move((1 - p) * w, 0) });
    case 'slide-right':
    case 'cube-right':
      return both({ transform: move(p * w, 0) }, { transform: move(-(1 - p) * w, 0) });
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
      const firstHalf = p < 0.5;
      const k = firstHalf ? 1 - 2 * p : 2 * p - 1;
      const squash = type === 'flip-h' ? scaleAbout(k, 1, cx, cy) : scaleAbout(1, k, cx, cy);
      return {
        from: firstHalf ? { transform: squash } : { opacity: 0 },
        to: firstHalf ? { opacity: 0 } : { transform: squash },
        fromOnTop: firstHalf,
        backdrop: true,
      };
    }
    default:
      return both({}, {}); // 'none' — the caller plays it as a cut
  }
}

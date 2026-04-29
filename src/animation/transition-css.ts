import type { PageTransition, PageTransitionType, EasingFunction } from '../schema/types';

const DEFAULT_DURATION = 400;
const DEFAULT_EASING: EasingFunction = 'ease-in-out';

/** Returns a unique CSS class name for a transition type/duration/easing combo. */
export function transitionClassName(t: PageTransition): string {
  return `ft-${t.type}-${t.duration ?? DEFAULT_DURATION}`;
}

/** Generates all @keyframes + .ft-* rule pairs needed for a set of transitions. */
export function generateTransitionCSS(transitions: PageTransition[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [BASE_TRANSITION_CSS];

  for (const t of transitions) {
    const cls = transitionClassName(t);
    if (seen.has(cls)) continue;
    seen.add(cls);
    const ms   = t.duration ?? DEFAULT_DURATION;
    const ease = t.easing   ?? DEFAULT_EASING;
    blocks.push(buildTransitionRule(t.type, cls, ms, ease));
  }
  return blocks.join('\n');
}

function buildTransitionRule(
  type: PageTransitionType,
  cls: string,
  ms: number,
  ease: EasingFunction,
): string {
  const rules: Record<PageTransitionType, string> = {
    none:        '',
    fade:        `@keyframes ${cls}-in{from{opacity:0}to{opacity:1}}@keyframes ${cls}-out{from{opacity:1}to{opacity:0}}`,
    'slide-left':`@keyframes ${cls}-in{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes ${cls}-out{from{transform:translateX(0)}to{transform:translateX(-100%)}}`,
    'slide-right':`@keyframes ${cls}-in{from{transform:translateX(-100%)}to{transform:translateX(0)}}@keyframes ${cls}-out{from{transform:translateX(0)}to{transform:translateX(100%)}}`,
    'slide-up':  `@keyframes ${cls}-in{from{transform:translateY(100%)}to{transform:translateY(0)}}@keyframes ${cls}-out{from{transform:translateY(0)}to{transform:translateY(-100%)}}`,
    'slide-down':`@keyframes ${cls}-in{from{transform:translateY(-100%)}to{transform:translateY(0)}}@keyframes ${cls}-out{from{transform:translateY(0)}to{transform:translateY(100%)}}`,
    'zoom-in':   `@keyframes ${cls}-in{from{opacity:0;transform:scale(.85)}to{opacity:1;transform:scale(1)}}@keyframes ${cls}-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.1)}}`,
    'zoom-out':  `@keyframes ${cls}-in{from{opacity:0;transform:scale(1.1)}to{opacity:1;transform:scale(1)}}@keyframes ${cls}-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(.85)}}`,
    'flip-h':    `@keyframes ${cls}-in{from{transform:rotateY(90deg);opacity:0}to{transform:rotateY(0);opacity:1}}@keyframes ${cls}-out{from{transform:rotateY(0);opacity:1}to{transform:rotateY(-90deg);opacity:0}}`,
    'flip-v':    `@keyframes ${cls}-in{from{transform:rotateX(90deg);opacity:0}to{transform:rotateX(0);opacity:1}}@keyframes ${cls}-out{from{transform:rotateX(0);opacity:1}to{transform:rotateX(-90deg);opacity:0}}`,
    'cube-left': `@keyframes ${cls}-in{from{transform:rotateY(-90deg) translateZ(50px);opacity:0}to{transform:rotateY(0) translateZ(0);opacity:1}}@keyframes ${cls}-out{from{transform:rotateY(0);opacity:1}to{transform:rotateY(90deg) translateZ(50px);opacity:0}}`,
    'cube-right':`@keyframes ${cls}-in{from{transform:rotateY(90deg) translateZ(50px);opacity:0}to{transform:rotateY(0) translateZ(0);opacity:1}}@keyframes ${cls}-out{from{transform:rotateY(0);opacity:1}to{transform:rotateY(-90deg) translateZ(50px);opacity:0}}`,
    reveal:      `@keyframes ${cls}-in{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0% 0 0)}}@keyframes ${cls}-out{from{opacity:1}to{opacity:0}}`,
    'wipe-left': `@keyframes ${cls}-in{from{clip-path:inset(0 100% 0 0)}to{clip-path:inset(0 0 0 0)}}@keyframes ${cls}-out{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 0 0 100%)}}`,
    'wipe-right':`@keyframes ${cls}-in{from{clip-path:inset(0 0 0 100%)}to{clip-path:inset(0 0 0 0)}}@keyframes ${cls}-out{from{clip-path:inset(0 0 0 0)}to{clip-path:inset(0 100% 0 0)}}`,
    dissolve:    `@keyframes ${cls}-in{from{opacity:0;filter:blur(8px)}to{opacity:1;filter:blur(0)}}@keyframes ${cls}-out{from{opacity:1;filter:blur(0)}to{opacity:0;filter:blur(8px)}}`,
    morph:       `@keyframes ${cls}-in{from{opacity:0;transform:scale(.9) skewX(-3deg)}to{opacity:1;transform:scale(1) skewX(0)}}@keyframes ${cls}-out{from{opacity:1;transform:scale(1)}to{opacity:0;transform:scale(1.05)}}`,
  };

  const kf = rules[type];
  if (!kf) return '';
  return `${kf}
.${cls}-enter{animation:${cls}-in ${ms}ms ${ease} both}
.${cls}-leave{animation:${cls}-out ${ms}ms ${ease} both}`;
}

const BASE_TRANSITION_CSS = `
.ft-slide{position:absolute;top:0;left:0;width:100%;height:100%;will-change:transform,opacity}
.ft-slide.active{z-index:2}
.ft-slide.leaving{z-index:1;pointer-events:none}
`;

import type {
  AnimationSpec, LoopAnimation,
  EnterAnimationType, ExitAnimationType,
} from './types';

// ── Enter Animation CSS Keyframes ───────────────────────────
const ENTER_KEYFRAMES: Record<EnterAnimationType, string> = {
  fade_in: `from { opacity: 0; } to { opacity: 1; }`,
  fade_up: `from { opacity: 0; transform: translateY(30px); } to { opacity: 1; transform: translateY(0); }`,
  fade_down: `from { opacity: 0; transform: translateY(-30px); } to { opacity: 1; transform: translateY(0); }`,
  fade_left: `from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); }`,
  fade_right: `from { opacity: 0; transform: translateX(-30px); } to { opacity: 1; transform: translateX(0); }`,
  scale_in: `from { opacity: 0; transform: scale(0.8); } to { opacity: 1; transform: scale(1); }`,
  scale_up: `from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); }`,
  slide_up: `from { transform: translateY(100%); } to { transform: translateY(0); }`,
  slide_down: `from { transform: translateY(-100%); } to { transform: translateY(0); }`,
  slide_left: `from { transform: translateX(100%); } to { transform: translateX(0); }`,
  slide_right: `from { transform: translateX(-100%); } to { transform: translateX(0); }`,
  flip_in: `from { opacity: 0; transform: perspective(400px) rotateY(90deg); } to { opacity: 1; transform: perspective(400px) rotateY(0); }`,
  rotate_in: `from { opacity: 0; transform: rotate(-180deg) scale(0.5); } to { opacity: 1; transform: rotate(0) scale(1); }`,
  blur_in: `from { opacity: 0; filter: blur(20px); } to { opacity: 1; filter: blur(0); }`,
  bounce_in: `0% { opacity: 0; transform: scale(0.3); } 50% { opacity: 1; transform: scale(1.05); } 70% { transform: scale(0.9); } 100% { transform: scale(1); }`,
};

// ── Exit Animation CSS Keyframes ────────────────────────────
const EXIT_KEYFRAMES: Record<ExitAnimationType, string> = {
  fade_out: `from { opacity: 1; } to { opacity: 0; }`,
  fade_up_out: `from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-30px); }`,
  fade_down_out: `from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(30px); }`,
  scale_out: `from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.8); }`,
  slide_up_out: `from { transform: translateY(0); } to { transform: translateY(-100%); }`,
  slide_down_out: `from { transform: translateY(0); } to { transform: translateY(100%); }`,
  blur_out: `from { opacity: 1; filter: blur(0); } to { opacity: 0; filter: blur(20px); }`,
};

// ── Loop Animation CSS Keyframes ────────────────────────────
function getLoopKeyframes(loop: LoopAnimation): string {
  const amp = loop.amplitude ?? 8;
  const sc = loop.scale ?? 1.02;

  switch (loop.type) {
    case 'float':
      return `0% { transform: translateY(0); } 50% { transform: translateY(-${amp}px); } 100% { transform: translateY(0); }`;
    case 'pulse':
      return `0% { transform: scale(1); } 50% { transform: scale(${sc}); } 100% { transform: scale(1); }`;
    case 'glow':
      return `0% { filter: drop-shadow(0 0 0 transparent); } 50% { filter: drop-shadow(0 0 ${amp}px ${loop.color ?? 'currentColor'}); } 100% { filter: drop-shadow(0 0 0 transparent); }`;
    case 'spin':
      return `from { transform: rotate(0deg); } to { transform: rotate(360deg); }`;
    case 'shake':
      return `0%,100% { transform: translateX(0); } 25% { transform: translateX(-${amp}px); } 75% { transform: translateX(${amp}px); }`;
    case 'bounce':
      return `0%,100% { transform: translateY(0); } 50% { transform: translateY(-${amp * 2}px); }`;
    case 'breathe':
      return `0%,100% { opacity: 1; } 50% { opacity: 0.6; }`;
  }
}

// ── Generate CSS for a single layer ─────────────────────────
export function generateLayerCSS(layerId: string, anim: AnimationSpec): string {
  const rules: string[] = [];
  const animations: string[] = [];
  const selector = `[data-layer-id="${layerId}"]`;

  if (anim.enter) {
    const name = `enter-${layerId}`;
    rules.push(`@keyframes ${name} { ${ENTER_KEYFRAMES[anim.enter.type]} }`);
    const duration = anim.enter.duration ?? 600;
    const delay = anim.enter.delay ?? 0;
    const easing = anim.enter.easing ?? 'ease-out';
    animations.push(`${name} ${duration}ms ${easing} ${delay}ms both`);
  }

  if (anim.exit) {
    const name = `exit-${layerId}`;
    rules.push(`@keyframes ${name} { ${EXIT_KEYFRAMES[anim.exit.type]} }`);
    const duration = anim.exit.duration ?? 300;
    const delay = anim.exit.delay ?? 0;
    const easing = anim.exit.easing ?? 'ease-in';
    animations.push(`${name} ${duration}ms ${easing} ${delay}ms both`);
  }

  if (anim.loop) {
    const name = `loop-${layerId}`;
    rules.push(`@keyframes ${name} { ${getLoopKeyframes(anim.loop)} }`);
    const duration = anim.loop.duration ?? 2000;
    animations.push(`${name} ${duration}ms ease-in-out infinite`);
  }

  if (animations.length > 0) {
    rules.push(`${selector} { animation: ${animations.join(', ')}; }`);
  }

  return rules.join('\n');
}

// ── Keyframe timeline → CSS ─────────────────────────────────

/**
 * Turn a keyframe timeline into a real `@keyframes` rule.
 *
 * This is the half of the animation model that `generateLayerCSS` never
 * covered: `animation(op:keyframe)` writes `layer.animation.keyframes`, and
 * nothing downstream read them, so a hand-authored timeline produced no motion
 * at all. Enter/exit/loop are canned effects; this is the arbitrary case.
 *
 * Positions are emitted as a translate DELTA from the first keyframe rather
 * than absolute coordinates, because the layer is already drawn at its own x/y
 * by the renderer — animating absolute values would double the offset and
 * throw the layer off-canvas. `transform-box: fill-box` makes rotate/scale turn
 * about the layer's own centre instead of the SVG root origin, which is what
 * anyone writing `rotation: 90` means.
 */
export function generateKeyframeCSS(layerId: string, anim: AnimationSpec): string {
  const frames = anim.keyframes;
  if (!frames || frames.length < 2) return '';

  const sorted = [...frames].sort((a, b) => a.t - b.t);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const playback = anim.playback;
  // A timeline whose frames end at 0ms has no duration to divide by; fall back
  // to the declared playback duration, then to a sane default.
  const span = last.t - first.t;
  const duration = playback?.duration ?? (span > 0 ? span : 1000);
  if (duration <= 0) return '';

  // With origin:'offset' the values are already deltas from where the renderer
  // drew the layer, so there is nothing to subtract. Under the default the
  // first frame defines rest. See KeyframeAnimation.playback.origin.
  const offsetOrigin = playback?.origin === 'offset';
  const baseX = offsetOrigin ? 0 : (typeof first.x === 'number' ? first.x : 0);
  const baseY = offsetOrigin ? 0 : (typeof first.y === 'number' ? first.y : 0);

  const steps: string[] = [];
  for (const kf of sorted) {
    const pct = Math.max(0, Math.min(100, ((kf.t - first.t) / duration) * 100));
    const decls: string[] = [];

    const parts: string[] = [];
    const dx = typeof kf.x === 'number' ? kf.x - baseX : 0;
    const dy = typeof kf.y === 'number' ? kf.y - baseY : 0;
    if (dx !== 0 || dy !== 0) parts.push(`translate(${dx}px, ${dy}px)`);
    if (typeof kf.rotation === 'number' && kf.rotation !== 0) parts.push(`rotate(${kf.rotation}deg)`);
    if (typeof kf.scale === 'number' && kf.scale !== 1) parts.push(`scale(${kf.scale})`);
    if (parts.length > 0) decls.push(`transform: ${parts.join(' ')};`);

    if (typeof kf.opacity === 'number') decls.push(`opacity: ${kf.opacity};`);
    const fill = kf['fill.color'];
    if (typeof fill === 'string') decls.push(`fill: ${fill};`);
    const stroke = kf['stroke.color'];
    if (typeof stroke === 'string') decls.push(`stroke: ${stroke};`);

    if (decls.length > 0) steps.push(`${Number(pct.toFixed(3))}% { ${decls.join(' ')} }`);
  }

  if (steps.length === 0) return '';

  const name = `kf-${layerId}`;
  const easing = playback?.easing ?? 'ease-in-out';
  const iteration = playback?.loop ? 'infinite' : '1';
  const direction = playback?.direction ?? 'normal';
  const delay = Math.max(0, playback?.delay ?? 0);

  return [
    `@keyframes ${name} { ${steps.join(' ')} }`,
    `[data-layer-id="${layerId}"] { transform-box: fill-box; transform-origin: center; ` +
      `animation: ${name} ${duration}ms ${easing} ${delay}ms ${iteration} ${direction} both; }`,
  ].join('\n');
}

// ── Generate stagger CSS ────────────────────────────────────
export function generateStaggerCSS(sequence: AnimationSpec['sequence']): string {
  if (!sequence) return '';

  const rules: string[] = [];
  const baseDelay = 0;

  for (let i = 0; i < sequence.items.length; i++) {
    const item = sequence.items[i];
    const name = `stagger-${item.ref}`;
    const keyframes = ENTER_KEYFRAMES[item.animate];
    if (!keyframes) continue;

    rules.push(`@keyframes ${name} { ${keyframes} }`);
    const delay = baseDelay + i * sequence.stagger;
    rules.push(`[data-layer-id="${item.ref}"] { animation: ${name} 600ms ease-out ${delay}ms both; }`);
  }

  return rules.join('\n');
}

// ── Generate all animation CSS for a design ─────────────────
export function generateDesignAnimationCSS(
  layerAnimations: Map<string, AnimationSpec>,
): string {
  const parts: string[] = [];

  for (const [layerId, anim] of layerAnimations) {
    const css = generateLayerCSS(layerId, anim);
    if (css) parts.push(css);

    const kf = generateKeyframeCSS(layerId, anim);
    if (kf) parts.push(kf);

    if (anim.sequence) {
      parts.push(generateStaggerCSS(anim.sequence));
    }
  }

  return parts.join('\n\n');
}

import type {
  AnimationSpec, LoopAnimation,
  EnterAnimationType, ExitAnimationType,
} from './types';
import { generateKeyframeCSS } from './keyframe-css';
import { opacityBase } from './opacity-base';
import type { Layer } from '../schema/types';
import { windowOf, lifeCSS, type LifeWindow } from './lifespan';

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
// Lives in keyframe-css.ts (per-segment easing, baked curves, skew/blur/draw).
export { generateKeyframeCSS } from './keyframe-css';

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

// ── Authored opacity per layer ──────────────────────────────
/** Each layer's own opacity, by id — what its opacity track scales (opacity-base.ts). */
export function authoredOpacities(layers: Layer[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const o = l as unknown as { id?: unknown; opacity?: unknown; layers?: unknown };
      if (typeof o.id === 'string' && typeof o.opacity === 'number') out.set(o.id, o.opacity);
      if (Array.isArray(o.layers)) visit(o.layers as Layer[]);
    }
  };
  if (layers) visit(layers);
  return out;
}

// ── Authored letter-spacing per layer ───────────────────────
/**
 * The letter-spacing each text layer is authored with, by id — what a
 * `tracking` track adds to. CSS cannot read the <text>'s own attribute into a
 * calc, so the base travels with the layers every caller already holds.
 */
export function letterSpacingBases(layers: Layer[] | undefined): Map<string, number> {
  const out = new Map<string, number>();
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const o = l as unknown as { id?: unknown; style?: { letter_spacing?: unknown }; track?: unknown; layers?: unknown };
      // `track` is the layer-level alias the renderer lifts into style.letter_spacing.
      const s = o.style?.letter_spacing ?? o.track;
      if (typeof o.id === 'string' && typeof s === 'number' && s !== 0) out.set(o.id, s);
      if (Array.isArray(o.layers)) visit(o.layers as Layer[]);
    }
  };
  if (layers) visit(layers);
  return out;
}

/** The two outlines a `morph` track moves between, by id — a path's own `d` and its `morph_to`. */
export function morphSources(layers: Layer[] | undefined): Map<string, { from: string; to: string }> {
  const out = new Map<string, { from: string; to: string }>();
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const o = l as unknown as { id?: unknown; d?: unknown; morph_to?: unknown; layers?: unknown };
      if (typeof o.id === 'string' && typeof o.d === 'string' && typeof o.morph_to === 'string') out.set(o.id, { from: o.d, to: o.morph_to });
      if (Array.isArray(o.layers)) visit(o.layers as Layer[]);
    }
  };
  if (layers) visit(layers);
  return out;
}

/** Every layer's in/out window, by id — already resolved onto the scene clock and clipped to its ancestors. */
export function lifeWindows(layers: Layer[] | undefined): Map<string, LifeWindow> {
  const out = new Map<string, LifeWindow>();
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const w = windowOf(l);
      if (w && typeof l.id === 'string') out.set(l.id, w);
      const kids = (l as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(kids)) visit(kids);
    }
  };
  if (layers) visit(layers);
  return out;
}

// ── Generate all animation CSS for a design ─────────────────
/**
 * `lifespans` plays each layer's in/out window as stepped `visibility`. Only
 * the exports ask for it: the editor canvas replays its CSS on every render,
 * and a layer that vanished after its out point there could not be edited.
 */
export function generateDesignAnimationCSS(
  layerAnimations: Map<string, AnimationSpec>,
  layers?: Layer[],
  opts: { lifespans?: boolean } = {},
): string {
  const parts: string[] = [];
  const spacing = letterSpacingBases(layers);
  const opacities = authoredOpacities(layers);
  const morphs = morphSources(layers);
  const lives = new Map<string, { keyframes: string; animation: string }>();
  if (opts.lifespans) {
    for (const [id, w] of lifeWindows(layers)) {
      const css = lifeCSS(id, w);
      if (css) lives.set(id, css);
    }
  }

  for (const [layerId, anim] of layerAnimations) {
    const css = generateLayerCSS(layerId, anim);
    if (css) parts.push(css);

    const life = lives.get(layerId);
    const kf = generateKeyframeCSS(layerId, anim, spacing.get(layerId) ?? 0, morphs.get(layerId), life ? [life.animation] : [],
      opacityBase(opacities.get(layerId), anim.keyframes as unknown as Array<Record<string, unknown>>));
    if (kf) {
      parts.push(kf);
      if (life) { parts.push(life.keyframes); lives.delete(layerId); }
    }

    if (anim.sequence) {
      parts.push(generateStaggerCSS(anim.sequence));
    }
  }

  // Windows on layers with no track of their own play alone.
  for (const [layerId, life] of lives) {
    parts.push(`${life.keyframes}\n[data-layer-id="${layerId}"] { animation: ${life.animation}; }`);
  }

  return parts.join('\n\n');
}

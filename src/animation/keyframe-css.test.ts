import { describe, it, expect } from 'vitest';
import { generateKeyframeCSS, poseAt, anchorToOrigin, usesDraw } from './keyframe-css';
import { interpolateKeyframes } from './keyframe-engine';
import type { AnimationSpec } from './types';

describe('generateKeyframeCSS v2', () => {
  it('emits per-segment timing functions', () => {
    const css = generateKeyframeCSS('a', {
      keyframes: [
        { t: 0, x: 0, easing: 'ease-out-expo' },
        { t: 500, x: 100, easing: 'linear' },
        { t: 1000, x: 0 },
      ],
      playback: { duration: 1000, origin: 'offset' },
    });
    expect(css).toContain('@keyframes kf-a');
    expect(css).toContain('0% { transform: none;');
    expect(css).toMatch(/0% \{[^}]*animation-timing-function: cubic-bezier\(0\.16, 1, 0\.3, 1\)/);
    expect(css).toMatch(/50% \{[^}]*translate\(100px, 0px\)[^}]*animation-timing-function: linear/);
    // The animation itself runs linear; the per-step functions carry the shape.
    expect(css).toMatch(/animation: kf-a 1000ms linear 0ms 1 normal both/);
  });

  it('bakes bounce into sub-steps CSS can play', () => {
    const css = generateKeyframeCSS('b', {
      keyframes: [{ t: 0, y: -200, easing: 'bounce' }, { t: 800, y: 0 }],
      playback: { duration: 800, origin: 'offset' },
    });
    const steps = css.match(/[\d.]+% \{/g) ?? [];
    expect(steps.length).toBeGreaterThan(10);
    // Bounce dips: some intermediate translateY must move away from 0 again.
    const ys = [...css.matchAll(/translate\(0px, (-?[\d.]+)px\)/g)].map(m => parseFloat(m[1]));
    let dips = 0;
    for (let i = 1; i < ys.length; i++) if (ys[i] < ys[i - 1]) dips++;
    expect(dips).toBeGreaterThan(0);
  });

  it('holds a keyframe with steps(1, end)', () => {
    const css = generateKeyframeCSS('h', {
      keyframes: [{ t: 0, opacity: 0, hold: true }, { t: 300, opacity: 1 }],
      playback: { duration: 300 },
    });
    expect(css).toMatch(/0% \{[^}]*animation-timing-function: steps\(1, end\)/);
  });

  it('carries forward channels a later frame omits', () => {
    const css = generateKeyframeCSS('c', {
      keyframes: [{ t: 0, x: 0, opacity: 0 }, { t: 500, x: 40 }, { t: 1000, opacity: 1 }],
      playback: { duration: 1000, origin: 'offset' },
    });
    // At 100% x is still 40 — a frame that only says opacity does not snap x back.
    expect(css).toMatch(/100% \{[^}]*translate\(40px, 0px\)[^}]*opacity: 1/);
    expect(css).toMatch(/50% \{[^}]*opacity: 0/);
  });

  it('writes skew, non-uniform scale, blur and anchor', () => {
    const css = generateKeyframeCSS('s', {
      keyframes: [{ t: 0, skew_x: 12, scale_x: 0.5, blur: 10 }, { t: 400, skew_x: 0, scale_x: 1, blur: 0 }],
      playback: { duration: 400, anchor: 'bottom left' },
    });
    expect(css).toContain('skew(12deg, 0deg)');
    expect(css).toContain('scale(0.5, 1)');
    expect(css).toContain('filter: blur(10px)');
    expect(css).toContain('filter: none');
    expect(css).toContain('transform-origin: 0% 100%');
  });

  it('turns draw into a stroke-dashoffset track on the layer and its children', () => {
    const anim: AnimationSpec = {
      keyframes: [{ t: 0, draw: 0 }, { t: 1200, draw: 1 }],
      playback: { duration: 1200 },
    };
    expect(usesDraw(anim)).toBe(true);
    const css = generateKeyframeCSS('line', anim);
    expect(css).toContain('stroke-dasharray: 1;');
    expect(css).toMatch(/0% \{[^}]*stroke-dashoffset: 1;/);
    expect(css).toMatch(/100% \{[^}]*stroke-dashoffset: 0;/);
    expect(css).toContain('[data-layer-id="line"], [data-layer-id="line"] *');
  });

  it('finite iterations and delay reach the animation shorthand', () => {
    const css = generateKeyframeCSS('l', {
      keyframes: [{ t: 0, scale: 1 }, { t: 600, scale: 1.1 }],
      playback: { duration: 600, loop: true, iterations: 3, direction: 'alternate', delay: 250 },
    });
    expect(css).toMatch(/animation: kf-l 600ms linear 250ms 3 alternate both/);
  });

  it('returns nothing for fewer than two frames', () => {
    expect(generateKeyframeCSS('x', { keyframes: [{ t: 0, x: 1 }] })).toBe('');
    expect(generateKeyframeCSS('x', {})).toBe('');
  });

  it('anchor mapping covers every corner', () => {
    expect(anchorToOrigin(undefined)).toBe('50% 50%');
    expect(anchorToOrigin('top right')).toBe('100% 0%');
    expect(anchorToOrigin('left')).toBe('0% 50%');
  });
});

describe('poseAt agrees with the interpolation engine', () => {
  it('per-segment easing shapes the sampled pose', () => {
    const anim: AnimationSpec = {
      keyframes: [{ t: 0, x: 0, easing: 'linear' }, { t: 100, x: 100, easing: 'hold' }, { t: 200, x: 200 }],
      playback: { duration: 200, origin: 'offset' },
    };
    expect(poseAt(anim, 50).x).toBeCloseTo(50, 6);
    expect(poseAt(anim, 150).x).toBeCloseTo(100, 6); // held
    expect(poseAt(anim, 200).x).toBeCloseTo(200, 6);
    // The engine used by the GIF route says the same.
    expect(interpolateKeyframes(anim.keyframes!, 50, 'ease-in-out')['x']).toBeCloseTo(50, 6);
    expect(interpolateKeyframes(anim.keyframes!, 150, 'ease-in-out')['x']).toBeCloseTo(100, 6);
  });

  it('the engine tweens a property first named in a later frame from its last known value', () => {
    const v = interpolateKeyframes([{ t: 0, opacity: 0 }, { t: 100, x: 5 }, { t: 200, opacity: 1 }], 150, 'linear');
    expect(v['opacity']).toBeCloseTo(0.5, 6);
  });
});

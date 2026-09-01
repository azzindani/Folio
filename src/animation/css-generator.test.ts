import { describe, it, expect } from 'vitest';
import { generateLayerCSS, generateStaggerCSS, generateDesignAnimationCSS, generateKeyframeCSS } from './css-generator';
import type { AnimationSpec } from './types';

describe('generateLayerCSS', () => {
  it('generates enter animation CSS', () => {
    const css = generateLayerCSS('heading', {
      enter: { type: 'fade_up', duration: 600, delay: 0, easing: 'ease-out' },
    });
    expect(css).toContain('@keyframes enter-heading');
    expect(css).toContain('translateY');
    expect(css).toContain('600ms');
    expect(css).toContain('ease-out');
  });

  it('generates exit animation CSS', () => {
    const css = generateLayerCSS('card', {
      exit: { type: 'fade_out', duration: 300 },
    });
    expect(css).toContain('@keyframes exit-card');
    expect(css).toContain('opacity');
    expect(css).toContain('300ms');
  });

  it('generates loop animation CSS', () => {
    const css = generateLayerCSS('dot', {
      loop: { type: 'float', duration: 3000, amplitude: 8 },
    });
    expect(css).toContain('@keyframes loop-dot');
    expect(css).toContain('translateY');
    expect(css).toContain('infinite');
    expect(css).toContain('3000ms');
  });

  it('generates pulse loop', () => {
    const css = generateLayerCSS('btn', {
      loop: { type: 'pulse', duration: 1500, scale: 1.05 },
    });
    expect(css).toContain('scale(1.05)');
  });

  it('generates glow loop', () => {
    const css = generateLayerCSS('glow-el', {
      loop: { type: 'glow', duration: 2000, color: '#E94560' },
    });
    expect(css).toContain('drop-shadow');
    expect(css).toContain('#E94560');
  });

  it('generates spin loop', () => {
    const css = generateLayerCSS('spinner', {
      loop: { type: 'spin', duration: 1000 },
    });
    expect(css).toContain('rotate(360deg)');
  });

  it('combines enter + loop animations', () => {
    const css = generateLayerCSS('combo', {
      enter: { type: 'fade_in', duration: 500 },
      loop: { type: 'float', duration: 2000 },
    });
    expect(css).toContain('@keyframes enter-combo');
    expect(css).toContain('@keyframes loop-combo');
    expect(css).toContain('animation:');
    // Both animations should be comma-separated
    const animLine = css.split('\n').find(l => l.includes('animation:'));
    expect(animLine).toContain(',');
  });

  it('uses default values for missing properties', () => {
    const css = generateLayerCSS('test', {
      enter: { type: 'scale_in' },
    });
    expect(css).toContain('600ms'); // default duration
    expect(css).toContain('ease-out'); // default easing
    expect(css).toContain('0ms'); // default delay
  });

  it('generates all enter animation types', () => {
    const types = [
      'fade_in', 'fade_up', 'fade_down', 'fade_left', 'fade_right',
      'scale_in', 'scale_up', 'slide_up', 'slide_down', 'slide_left', 'slide_right',
      'flip_in', 'rotate_in', 'blur_in', 'bounce_in',
    ] as const;
    for (const type of types) {
      const css = generateLayerCSS(`l-${type}`, { enter: { type } });
      expect(css).toContain(`@keyframes enter-l-${type}`);
    }
  });

  it('generates all exit animation types', () => {
    const types = [
      'fade_out', 'fade_up_out', 'fade_down_out',
      'scale_out', 'slide_up_out', 'slide_down_out', 'blur_out',
    ] as const;
    for (const type of types) {
      const css = generateLayerCSS(`l-${type}`, { exit: { type } });
      expect(css).toContain(`@keyframes exit-l-${type}`);
    }
  });
});

describe('generateStaggerCSS', () => {
  it('generates staggered delay CSS', () => {
    const css = generateStaggerCSS({
      stagger: 150,
      items: [
        { ref: 'step_1', animate: 'fade_up' },
        { ref: 'step_2', animate: 'fade_up' },
        { ref: 'step_3', animate: 'fade_up' },
      ],
    });
    expect(css).toContain('stagger-step_1');
    expect(css).toContain('stagger-step_2');
    expect(css).toContain('stagger-step_3');
    expect(css).toContain('0ms'); // first delay
    expect(css).toContain('150ms'); // second delay
    expect(css).toContain('300ms'); // third delay
  });

  it('returns empty string for undefined sequence', () => {
    const css = generateStaggerCSS(undefined);
    expect(css).toBe('');
  });
});

describe('generateDesignAnimationCSS', () => {
  it('generates CSS for multiple layers', () => {
    const animations = new Map<string, AnimationSpec>([
      ['heading', { enter: { type: 'fade_up', duration: 600 } }],
      ['subtitle', { enter: { type: 'fade_up', delay: 200, duration: 600 } }],
      ['icon', { loop: { type: 'float', duration: 3000 } }],
    ]);

    const css = generateDesignAnimationCSS(animations);
    expect(css).toContain('enter-heading');
    expect(css).toContain('enter-subtitle');
    expect(css).toContain('loop-icon');
  });

  it('returns empty string for empty map', () => {
    const css = generateDesignAnimationCSS(new Map());
    expect(css).toBe('');
  });

  it('includes stagger CSS when sequence is present', () => {
    const animations = new Map<string, AnimationSpec>([
      ['lyr', {
        enter: { type: 'fade_up', duration: 600 },
        sequence: {
          stagger: 100,
          items: [
            { ref: 'a', animate: 'fade_up' },
            { ref: 'b', animate: 'fade_up' },
          ],
        },
      }],
    ]);
    const css = generateDesignAnimationCSS(animations);
    expect(css).toContain('stagger');
  });
});

describe('generateLayerCSS — loop types shake/bounce/breathe', () => {
  it('generates shake loop CSS', () => {
    const css = generateLayerCSS('el', { loop: { type: 'shake', duration: 800, amplitude: 5 } });
    expect(css).toContain('translateX');
  });

  it('generates bounce loop CSS', () => {
    const css = generateLayerCSS('el', { loop: { type: 'bounce', duration: 1000, amplitude: 10 } });
    expect(css).toContain('translateY');
  });

  it('generates breathe loop CSS', () => {
    const css = generateLayerCSS('el', { loop: { type: 'breathe', duration: 2000, amplitude: 1 } });
    expect(css).toContain('opacity');
  });
});

describe('generateKeyframeCSS', () => {
  it('emits a @keyframes rule bound to the layer selector', () => {
    const css = generateKeyframeCSS('box', {
      keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }],
      playback: { duration: 500 },
    });
    expect(css).toContain('@keyframes kf-box');
    expect(css).toContain('[data-layer-id="box"]');
    expect(css).toMatch(/0% \{[^}]*opacity: 0;/);
    expect(css).toMatch(/100% \{[^}]*opacity: 1;/);
  });

  it('emits position as a delta from the first keyframe', () => {
    // The renderer already draws the layer at its own x/y. Emitting absolute
    // coordinates here would add the offset twice and eject it from the canvas.
    const css = generateKeyframeCSS('m', {
      keyframes: [{ t: 0, x: 100, y: 50 }, { t: 1000, x: 160, y: 50 }],
      playback: { duration: 1000 },
    });
    expect(css).toContain('translate(60px, 0px)');
    expect(css).not.toContain('translate(160px');
    // The 0% frame is rest — v2 writes it explicitly (transform: none) so the
    // per-segment timing function has a step to sit on.
    expect(css).toMatch(/0% \{ transform: none;/);
  });

  it('rotates about the layer centre, not the SVG origin', () => {
    const css = generateKeyframeCSS('r', {
      keyframes: [{ t: 0, rotation: 0 }, { t: 800, rotation: 90 }],
      playback: { duration: 800 },
    });
    expect(css).toContain('transform-box: fill-box');
    expect(css).toContain('transform-origin: 50% 50%');
    expect(css).toContain('rotate(90deg)');
  });

  it('marks a looping timeline infinite', () => {
    const css = generateKeyframeCSS('l', {
      keyframes: [{ t: 0, scale: 1 }, { t: 1000, scale: 1.2 }],
      playback: { duration: 1000, loop: true, direction: 'alternate' },
    });
    expect(css).toContain('infinite');
    expect(css).toContain('alternate');
  });

  it('returns nothing for a timeline that cannot animate', () => {
    expect(generateKeyframeCSS('a', {})).toBe('');
    expect(generateKeyframeCSS('a', { keyframes: [{ t: 0, opacity: 1 }] })).toBe('');
  });

  it('falls back to the playback duration when all frames share a time', () => {
    const css = generateKeyframeCSS('z', {
      keyframes: [{ t: 0, opacity: 0 }, { t: 0, opacity: 1 }],
      playback: { duration: 400 },
    });
    expect(css).toContain('400ms');
  });
});

describe('generateKeyframeCSS — origin', () => {
  it('origin:"offset" ends an entrance at rest, not displaced', () => {
    // The bug this pins: under the default the FIRST frame is rest, so a "rise"
    // authored as y:24 → y:0 started at rest and ENDED at translate(0,-24px) —
    // the layer finished 24px above where it was drawn.
    const css = generateKeyframeCSS('e', {
      keyframes: [{ t: 0, y: 24, opacity: 0 }, { t: 700, y: 0, opacity: 1 }],
      playback: { duration: 700, origin: 'offset' },
    });
    expect(css).toContain('translate(0px, 24px)');
    expect(css).not.toContain('-24px');
  });

  it('default origin keeps delta-from-first for hand-authored motion', () => {
    const css = generateKeyframeCSS('h', {
      keyframes: [{ t: 0, x: 100 }, { t: 500, x: 160 }],
      playback: { duration: 500 },
    });
    expect(css).toContain('translate(60px, 0px)');
    expect(css).not.toContain('translate(100px');
  });
});

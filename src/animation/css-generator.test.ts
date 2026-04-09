import { describe, it, expect } from 'vitest';
import { generateLayerCSS, generateStaggerCSS, generateDesignAnimationCSS } from './css-generator';
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
});

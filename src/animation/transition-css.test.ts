import { describe, it, expect } from 'vitest';
import { transitionClassName, generateTransitionCSS } from './transition-css';
import type { PageTransition } from '../schema/types';

describe('transitionClassName', () => {
  it('includes type and duration', () => {
    expect(transitionClassName({ type: 'fade', duration: 400 })).toBe('ft-fade-400');
  });

  it('uses default duration when omitted', () => {
    expect(transitionClassName({ type: 'slide-left' })).toBe('ft-slide-left-400');
  });

  it('uses custom duration', () => {
    expect(transitionClassName({ type: 'zoom-in', duration: 600 })).toBe('ft-zoom-in-600');
  });
});

describe('generateTransitionCSS', () => {
  it('includes base transition CSS', () => {
    const css = generateTransitionCSS([]);
    expect(css).toContain('.ft-slide');
    expect(css).toContain('position:absolute');
  });

  it('generates keyframes for fade', () => {
    const css = generateTransitionCSS([{ type: 'fade', duration: 400 }]);
    expect(css).toContain('@keyframes ft-fade-400-in');
    expect(css).toContain('@keyframes ft-fade-400-out');
    expect(css).toContain('opacity:0');
    expect(css).toContain('opacity:1');
  });

  it('generates enter/leave classes', () => {
    const css = generateTransitionCSS([{ type: 'fade', duration: 400 }]);
    expect(css).toContain('.ft-fade-400-enter');
    expect(css).toContain('.ft-fade-400-leave');
  });

  it('deduplicates identical transitions', () => {
    const t: PageTransition = { type: 'fade', duration: 400 };
    const css = generateTransitionCSS([t, t, t]);
    const count = (css.match(/@keyframes ft-fade-400-in/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('generates slide-left keyframes', () => {
    const css = generateTransitionCSS([{ type: 'slide-left', duration: 300 }]);
    expect(css).toContain('translateX(100%)');
    expect(css).toContain('translateX(-100%)');
  });

  it('generates zoom-in keyframes', () => {
    const css = generateTransitionCSS([{ type: 'zoom-in', duration: 400 }]);
    expect(css).toContain('scale(.85)');
  });

  it('generates flip-h keyframes', () => {
    const css = generateTransitionCSS([{ type: 'flip-h', duration: 400 }]);
    expect(css).toContain('rotateY(90deg)');
  });

  it('generates dissolve keyframes with blur', () => {
    const css = generateTransitionCSS([{ type: 'dissolve', duration: 400 }]);
    expect(css).toContain('blur(8px)');
  });

  it('generates reveal keyframes with clip-path', () => {
    const css = generateTransitionCSS([{ type: 'reveal', duration: 400 }]);
    expect(css).toContain('clip-path');
  });

  it('generates morph keyframes with skew', () => {
    const css = generateTransitionCSS([{ type: 'morph', duration: 400 }]);
    expect(css).toContain('skewX');
  });

  it('handles none type — no keyframes emitted', () => {
    const css = generateTransitionCSS([{ type: 'none', duration: 400 }]);
    expect(css).not.toContain('@keyframes');
  });

  it('applies custom easing to animation rule', () => {
    const css = generateTransitionCSS([{ type: 'fade', duration: 400, easing: 'linear' }]);
    expect(css).toContain('linear');
  });

  it('generates multiple distinct transitions', () => {
    const css = generateTransitionCSS([
      { type: 'fade', duration: 400 },
      { type: 'slide-right', duration: 500 },
    ]);
    expect(css).toContain('ft-fade-400-enter');
    expect(css).toContain('ft-slide-right-500-enter');
  });
});

/**
 * Unit tests for pattern-renderer.ts — generative SVG <pattern> fills.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderPattern } from './pattern-renderer';
import { createSVGRoot, getOrCreateDefs, resetDefIdCounter } from './svg-utils';
import type { PatternName } from '../schema/types';

const ALL: PatternName[] = [
  'dots', 'dot_grid', 'grid', 'graph_paper', 'isometric', 'stripes',
  'diagonal_stripes', 'crosshatch', 'checkerboard', 'chevron', 'zigzag',
  'triangles', 'waves', 'scallop', 'plus', 'cross', 'scatter', 'confetti',
  'halftone', 'blueprint', 'carbon', 'houndstooth', 'brick',
];

beforeEach(() => resetDefIdCounter());

function setup() {
  const svg = createSVGRoot(200, 200);
  return { svg, defs: getOrCreateDefs(svg) };
}

describe('renderPattern — every preset', () => {
  it('produces a tiling <pattern> def with content for all names', () => {
    for (const pattern of ALL) {
      const { svg, defs } = setup();
      const ref = renderPattern({ type: 'pattern', pattern, fg: '#222222' }, defs);
      expect(ref).toMatch(/^url\(#pat-\d+\)$/);
      const pat = svg.querySelector('pattern');
      expect(pat, `pattern ${pattern}`).toBeTruthy();
      expect(pat!.getAttribute('patternUnits')).toBe('userSpaceOnUse');
      expect(Number(pat!.getAttribute('width'))).toBeGreaterThan(0);
      // The mark group must have rendered at least one child element.
      const g = pat!.querySelector('g');
      expect(g, `group ${pattern}`).toBeTruthy();
      expect(g!.childElementCount, `marks ${pattern}`).toBeGreaterThan(0);
    }
  });
});

describe('renderPattern — options', () => {
  it('paints a background rect when bg is set', () => {
    const { svg, defs } = setup();
    renderPattern({ type: 'pattern', pattern: 'dots', fg: '#111', bg: '#FAF5EC' }, defs);
    const bg = svg.querySelector('pattern > rect');
    expect(bg).toBeTruthy();
    expect(bg!.getAttribute('fill')).toBe('#FAF5EC');
  });

  it('omits the background rect when bg is absent (floats over fills below)', () => {
    const { svg, defs } = setup();
    renderPattern({ type: 'pattern', pattern: 'dots', fg: '#111' }, defs);
    expect(svg.querySelector('pattern > rect')).toBeNull();
  });

  it('scales the tile size', () => {
    const { svg: a, defs: da } = setup();
    renderPattern({ type: 'pattern', pattern: 'grid', fg: '#111', scale: 1 }, da);
    const base = Number(a.querySelector('pattern')!.getAttribute('width'));
    resetDefIdCounter();
    const { svg: b, defs: db } = setup();
    renderPattern({ type: 'pattern', pattern: 'grid', fg: '#111', scale: 2 }, db);
    const scaled = Number(b.querySelector('pattern')!.getAttribute('width'));
    expect(scaled).toBeCloseTo(base * 2, 0);
  });

  it('applies rotation via patternTransform', () => {
    const { svg, defs } = setup();
    renderPattern({ type: 'pattern', pattern: 'stripes', fg: '#111', angle: 30 }, defs);
    expect(svg.querySelector('pattern')!.getAttribute('patternTransform')).toBe('rotate(30)');
  });

  it('applies mark opacity to the group', () => {
    const { svg, defs } = setup();
    renderPattern({ type: 'pattern', pattern: 'dots', fg: '#111', opacity: 0.4 }, defs);
    expect(svg.querySelector('pattern > g')!.getAttribute('opacity')).toBe('0.4');
  });

  it('falls back to dots for an unknown pattern name', () => {
    const { svg, defs } = setup();
    renderPattern({ type: 'pattern', pattern: 'nope' as PatternName, fg: '#111' }, defs);
    expect(svg.querySelector('pattern > g')!.childElementCount).toBeGreaterThan(0);
  });

  it('produces unique ids across calls', () => {
    const { defs } = setup();
    const r1 = renderPattern({ type: 'pattern', pattern: 'dots', fg: '#111' }, defs);
    const r2 = renderPattern({ type: 'pattern', pattern: 'dots', fg: '#111' }, defs);
    expect(r1).not.toBe(r2);
  });
});

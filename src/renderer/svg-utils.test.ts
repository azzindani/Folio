import { describe, it, expect, beforeEach } from 'vitest';
import { createSVGElement, createSVGRoot, getOrCreateDefs, defIdFor, appendDefOnce } from './svg-utils';

beforeEach(() => {
});

describe('createSVGElement', () => {
  it('creates element with no attrs', () => {
    const el = createSVGElement('rect');
    expect(el.tagName).toBe('rect');
  });

  it('sets defined attrs', () => {
    const el = createSVGElement('rect', { width: 100, height: 50 });
    expect(el.getAttribute('width')).toBe('100');
    expect(el.getAttribute('height')).toBe('50');
  });

  it('skips undefined attr values (line 20 FALSE branch)', () => {
    const el = createSVGElement('rect', { width: undefined, height: 50, x: undefined, y: 10 });
    expect(el.getAttribute('width')).toBeNull();
    expect(el.getAttribute('x')).toBeNull();
    expect(el.getAttribute('height')).toBe('50');
    expect(el.getAttribute('y')).toBe('10');
  });

  it('handles empty attrs object', () => {
    const el = createSVGElement('circle', {});
    expect(el.tagName).toBe('circle');
  });

  it('converts number values to string', () => {
    const el = createSVGElement('line', { x1: 0, y1: 0, x2: 100, y2: 100 });
    expect(el.getAttribute('x1')).toBe('0');
    expect(el.getAttribute('x2')).toBe('100');
  });
});

describe('createSVGRoot', () => {
  it('creates an SVG element with correct dimensions', () => {
    const svg = createSVGRoot(800, 600);
    expect(svg.tagName).toBe('svg');
    expect(svg.getAttribute('width')).toBe('800');
    expect(svg.getAttribute('height')).toBe('600');
    expect(svg.getAttribute('viewBox')).toBe('0 0 800 600');
  });
});

describe('getOrCreateDefs', () => {
  it('creates defs element when none exists', () => {
    const svg = createSVGRoot(100, 100);
    const defs = getOrCreateDefs(svg);
    expect(defs.tagName).toBe('defs');
    expect(svg.querySelector('defs')).not.toBeNull();
  });

  it('returns existing defs without creating a second one', () => {
    const svg = createSVGRoot(100, 100);
    const defs1 = getOrCreateDefs(svg);
    const defs2 = getOrCreateDefs(svg);
    expect(defs1).toBe(defs2);
    expect(svg.querySelectorAll('defs').length).toBe(1);
  });
});

describe('defIdFor', () => {
  // The test this replaces asserted `grad-1` then `grad-2` — "increments
  // counter on each call". It pinned the non-determinism as intended
  // behaviour, which is why nine test files could reset the counter in
  // beforeEach and none of them ever noticed production never did.
  it('the same content always gives the same id', () => {
    const fill = { type: 'linear', angle: 135, stops: [{ color: '#101820', position: 0 }] };
    expect(defIdFor('lg', fill)).toBe(defIdFor('lg', { ...fill }));
  });

  it('different content gives different ids', () => {
    expect(defIdFor('lg', { angle: 135 })).not.toBe(defIdFor('lg', { angle: 90 }));
  });

  it('does not depend on how many ids were minted before it', () => {
    const first = defIdFor('noise', { frequency: 0.9 });
    for (let i = 0; i < 50; i++) defIdFor('noise', { frequency: i });
    expect(defIdFor('noise', { frequency: 0.9 })).toBe(first);
  });

  it('keeps the prefix, so url(#…) references stay readable', () => {
    expect(defIdFor('clip', 'M0,0')).toMatch(/^clip-[0-9a-z]+$/);
  });

  it('separates prefixes even for identical content', () => {
    expect(defIdFor('lg', 'x')).not.toBe(defIdFor('rg', 'x'));
  });
});

describe('appendDefOnce', () => {
  it('adds the def', () => {
    const svg = createSVGRoot(10, 10);
    const defs = getOrCreateDefs(svg);
    appendDefOnce(defs, createSVGElement('filter', { id: 'f-1' }));
    expect(defs.children.length).toBe(1);
  });

  it('does not add a second element under the same id', () => {
    // Content-derived ids mean two layers sharing a gradient build the SAME id.
    const svg = createSVGRoot(10, 10);
    const defs = getOrCreateDefs(svg);
    appendDefOnce(defs, createSVGElement('filter', { id: 'f-1' }));
    appendDefOnce(defs, createSVGElement('filter', { id: 'f-1' }));
    expect(defs.children.length).toBe(1);
  });

  it('still adds defs with different ids', () => {
    const svg = createSVGRoot(10, 10);
    const defs = getOrCreateDefs(svg);
    appendDefOnce(defs, createSVGElement('filter', { id: 'f-1' }));
    appendDefOnce(defs, createSVGElement('filter', { id: 'f-2' }));
    expect(defs.children.length).toBe(2);
  });
});

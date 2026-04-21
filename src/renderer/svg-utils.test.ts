import { describe, it, expect, beforeEach } from 'vitest';
import { createSVGElement, createSVGRoot, getOrCreateDefs, uniqueDefId, resetDefIdCounter } from './svg-utils';

beforeEach(() => {
  resetDefIdCounter();
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

describe('uniqueDefId', () => {
  it('increments counter on each call', () => {
    const id1 = uniqueDefId('grad');
    const id2 = uniqueDefId('grad');
    expect(id1).toBe('grad-1');
    expect(id2).toBe('grad-2');
  });

  it('uses prefix in returned id', () => {
    const id = uniqueDefId('clip');
    expect(id).toContain('clip');
  });
});

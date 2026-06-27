import { describe, it, expect } from 'vitest';
import { makeBlankDesign } from './blank-design';
import { validateDesignSpec } from '../schema/validator';

describe('makeBlankDesign', () => {
  it('produces a valid single-page design at the requested size', () => {
    const d = makeBlankDesign({ width: 1080, height: 1350, now: '2026-06-27' });
    expect(d.document.width).toBe(1080);
    expect(d.document.height).toBe(1350);
    expect(d._protocol).toBe('design/v1');
    expect(d.layers && d.layers.length).toBe(1); // one bg rect
    const errors = validateDesignSpec(d).filter(e => e.severity === 'error');
    expect(errors).toEqual([]);
  });

  it('rounds + floors dimensions to >=1', () => {
    const d = makeBlankDesign({ width: 0.4, height: -10, now: '' });
    expect(d.document.width).toBe(1);
    expect(d.document.height).toBe(1);
  });

  it('derives meta name + id, defaults to Untitled', () => {
    expect(makeBlankDesign({ width: 100, height: 100 }).meta.name).toBe('Untitled');
    const named = makeBlankDesign({ width: 100, height: 100, name: 'My Poster!' });
    expect(named.meta.name).toBe('My Poster!');
    expect(named.meta.id).toBe('design-my-poster');
  });

  it('honors unit + dpi overrides', () => {
    const d = makeBlankDesign({ width: 794, height: 1123, unit: 'mm', dpi: 300 });
    expect(d.document.unit).toBe('mm');
    expect(d.document.dpi).toBe(300);
  });
});

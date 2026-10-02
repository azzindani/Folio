import { describe, it, expect } from 'vitest';
import { svgKey, RasterMemo } from './raster-memo';

describe('svgKey', () => {
  it('gives two renders of one drawing the same key despite fresh def ids', () => {
    const a = '<svg><defs><linearGradient id="lg-1"/><clipPath id="cp-2"/></defs><rect fill="url(#lg-1)" clip-path="url(#cp-2)" data-layer-id="bg"/><use href="#lg-1"/></svg>';
    const b = a.replace(/lg-1/g, 'lg-7').replace(/cp-2/g, 'cp-9');
    expect(svgKey(a)).toBe(svgKey(b));
    expect(svgKey(a)).toContain('data-layer-id="bg"');
  });
  it('keeps different drawings apart', () => {
    expect(svgKey('<svg><rect id="a" x="1"/></svg>')).not.toBe(svgKey('<svg><rect id="a" x="2"/></svg>'));
  });
});

describe('RasterMemo', () => {
  it('renders a key once, keeps the last few, and counts hits', async () => {
    const memo = new RasterMemo<number>(2);
    let made = 0;
    const make = (v: number) => (): Promise<number> => { made++; return Promise.resolve(v); };
    expect(await memo.get('a', make(1))).toBe(1);
    expect(await memo.get('a', make(9))).toBe(1);
    await memo.get('b', make(2));
    await memo.get('c', make(3));            // evicts a
    await memo.get('a', make(4));
    expect(made).toBe(4);
    expect(memo.hits).toBe(1);
  });
  it('forgets a failed render', async () => {
    const memo = new RasterMemo<number>(2);
    await expect(memo.get('x', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(await memo.get('x', () => Promise.resolve(5))).toBe(5);
  });
});

import { describe, it, expect } from 'vitest';
import { pageToShow } from './page-index';

describe('pageToShow', () => {
  it('shows a page the design has', () => {
    expect(pageToShow(2, 6)).toBe(2);
    expect(pageToShow(5, 6)).toBe(5);
  });

  it('stays put for the first page, a missing index, or one the design lacks', () => {
    expect(pageToShow(0, 6)).toBeUndefined();
    expect(pageToShow(undefined, 6)).toBeUndefined();
    expect(pageToShow(6, 6)).toBeUndefined();
    expect(pageToShow(2, 0)).toBeUndefined();
    expect(pageToShow(1.5, 6)).toBeUndefined();
  });
});

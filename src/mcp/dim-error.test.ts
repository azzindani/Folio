import { describe, it, expect } from 'vitest';
import { dimError } from './engine-edit-tools';
import type { Layer } from '../schema/types';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;

describe('dimError — the write-time "renders invisibly" gate', () => {
  // The renderer draws a circle/ellipse from cx/cy/rx/ry when they are set, so a
  // shape authored that way is sized. add_layers refused one as "needs a positive
  // width" even though the renderer, the pivot box and autoplace all read it.
  it('accepts a circle or ellipse drawn from its centre and radii', () => {
    expect(dimError(L({ id: 'dot', type: 'ellipse', cx: 540, cy: 960, rx: 30, ry: 30 }))).toBeNull();
    expect(dimError(L({ id: 'ring', type: 'circle', cx: 100, cy: 100, rx: 50, ry: 50 }))).toBeNull();
  });

  it('still refuses a shape that would draw nothing', () => {
    expect(dimError(L({ id: 'bare', type: 'ellipse' }))).toMatch(/needs a positive width/);
    expect(dimError(L({ id: 'flat', type: 'ellipse', cx: 10, cy: 10, rx: 0, ry: 5 }))).toMatch(/needs a positive width/);
    expect(dimError(L({ id: 'box', type: 'rect', cx: 10, cy: 10, rx: 5, ry: 5 }))).toMatch(/needs a positive width/);
  });
});

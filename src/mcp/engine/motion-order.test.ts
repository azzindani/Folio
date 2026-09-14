import { describe, it, expect } from 'vitest';
import { staggerRanks, isStaggerOrder } from './motion-order';
import type { Layer } from '../../schema/types';

const box = (id: string, x: number, y = 0): Layer =>
  ({ id, type: 'rect', z: 1, x, y, width: 40, height: 40 }) as unknown as Layer;
const row = (n: number): Layer[] => Array.from({ length: n }, (_, i) => box(`l${i}`, i * 50));

describe('staggerRanks', () => {
  it('runs forward by default and backward on reverse', () => {
    expect(staggerRanks(row(4))).toEqual([0, 1, 2, 3]);
    expect(staggerRanks(row(4), 'reverse')).toEqual([3, 2, 1, 0]);
  });

  it('opens from the centre with mirrored pairs together, and closes in from the edges', () => {
    expect(staggerRanks(row(5), 'center')).toEqual([2, 1, 0, 1, 2]);
    expect(staggerRanks(row(4), 'center')).toEqual([1, 0, 0, 1]);
    expect(staggerRanks(row(5), 'edges')).toEqual([0, 1, 2, 1, 0]);
  });

  it('shuffles the same way on every call, as a permutation', () => {
    const ranks = staggerRanks(row(8), 'random');
    expect(staggerRanks(row(8), 'random')).toEqual(ranks);
    expect([...ranks].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(ranks).not.toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('orders by where layers sit, not the order they were listed', () => {
    const scrambled = [box('c', 200), box('a', 0), box('b', 100)];
    expect(staggerRanks(scrambled, 'left_to_right')).toEqual([2, 0, 1]);
    expect(staggerRanks(scrambled, 'right_to_left')).toEqual([0, 2, 1]);
    // A column at one x sweeps in as one.
    expect(staggerRanks([box('top', 0, 0), box('low', 0, 300), box('next', 100, 0)], 'left_to_right')).toEqual([0, 0, 1]);
    expect(staggerRanks([box('low', 0, 300), box('top', 0, 0)], 'top_to_bottom')).toEqual([1, 0]);
  });

  it('knows its vocabulary', () => {
    expect(isStaggerOrder('center')).toBe(true);
    expect(isStaggerOrder('diagonal')).toBe(false);
  });
});

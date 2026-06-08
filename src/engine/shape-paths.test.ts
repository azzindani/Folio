import { describe, it, expect } from 'vitest';
import { shapePath, type ShapeName, type ShapeBox } from './shape-paths';

const BOX: ShapeBox = { x: 100, y: 50, w: 200, h: 160 };
const ALL: ShapeName[] = [
  'star', 'burst', 'seal', 'blob', 'wave', 'arc', 'ring', 'donut', 'bubble',
  'speech_bubble', 'heart', 'lightning', 'bolt', 'shield', 'gear', 'cog',
  'arrow', 'cross_shape', 'plus_shape',
];

const nums = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('shapePath — all shapes', () => {
  it('every shape returns a valid absolute path starting with M, all-finite coords', () => {
    for (const name of ALL) {
      const { d } = shapePath(name, BOX);
      expect(d.startsWith('M'), `${name} starts with M`).toBe(true);
      const ns = nums(d);
      expect(ns.length, `${name} has coords`).toBeGreaterThan(2);
      expect(ns.every(Number.isFinite), `${name} all finite`).toBe(true);
    }
  });
});

describe('shapePath — specifics', () => {
  it('star has 2×points vertices', () => {
    const { d } = shapePath('star', BOX, { points: 6 });
    expect((d.match(/[ML]/g) ?? []).length).toBe(12);
  });

  it('arc is an open path (has an arc command, no close)', () => {
    const { d } = shapePath('arc', BOX, { start: 0, end: 180 });
    expect(d).toMatch(/A/);
    expect(d).not.toMatch(/Z/);
  });

  it('ring / donut / gear punch a hole via evenodd + two subpaths', () => {
    for (const name of ['ring', 'donut', 'gear'] as ShapeName[]) {
      const { d, fillRule } = shapePath(name, BOX);
      expect(fillRule, name).toBe('evenodd');
      expect((d.match(/M/g) ?? []).length, `${name} subpaths`).toBeGreaterThanOrEqual(2);
    }
  });

  it('blob is deterministic per seed and varies across seeds', () => {
    expect(shapePath('blob', BOX, { seed: 1 }).d).toBe(shapePath('blob', BOX, { seed: 1 }).d);
    expect(shapePath('blob', BOX, { seed: 1 }).d).not.toBe(shapePath('blob', BOX, { seed: 2 }).d);
  });

  it('polygon shapes stay within (or near) the box bounds', () => {
    const { d } = shapePath('arrow', BOX);
    const ns = nums(d);
    const xs = ns.filter((_, i) => i % 2 === 0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(BOX.x - 1);
    expect(Math.max(...xs)).toBeLessThanOrEqual(BOX.x + BOX.w + 1);
  });
});

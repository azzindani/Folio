import { describe, it, expect } from 'vitest';
import { drawnBox, anchorPoint } from './frame-geometry';
import type { Layer } from '../schema/types';

const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;

describe('drawnBox', () => {
  it('measures shapes from their own geometry', () => {
    expect(drawnBox(L({ type: 'rect', x: 10, y: 20, width: 30, height: 40 }))).toEqual({ x: 10, y: 20, width: 30, height: 40 });
    expect(drawnBox(L({ type: 'line', x1: 540, y1: 720, x2: 540, y2: 640 }))).toEqual({ x: 540, y: 640, width: 0, height: 80 });
    expect(drawnBox(L({ type: 'ellipse', cx: 50, cy: 60, rx: 10, ry: 5 }))).toEqual({ x: 40, y: 55, width: 20, height: 10 });
    expect(drawnBox(L({ type: 'path', d: 'M 10 10 L 90 10 L 90 50' }))).toEqual({ x: 10, y: 10, width: 80, height: 40 });
    expect(drawnBox(L({ type: 'polygon', points: '0,0 100,0 50,80' }))).toEqual({ x: 0, y: 0, width: 100, height: 80 });
  });

  it('uses a group\'s declared box, or the union of its children when it has none', () => {
    expect(drawnBox(L({ type: 'group', x: 0, y: 0, width: 1080, height: 1350, layers: [] }))).toEqual({ x: 0, y: 0, width: 1080, height: 1350 });
    const loose = L({ type: 'group', layers: [{ type: 'rect', x: 10, y: 10, width: 10, height: 10 }, { type: 'rect', x: 50, y: 30, width: 20, height: 20 }] });
    expect(drawnBox(loose)).toEqual({ x: 10, y: 10, width: 60, height: 40 });
  });

  it('measures text by its words, not its box — a left-aligned headline pivots on the headline', () => {
    const style = { font_size: 100, font_family: 'Inter' };
    const left = drawnBox(L({ type: 'text', x: 80, y: 100, width: 920, content: { type: 'plain', value: 'Hi' }, style })) as { x: number; width: number };
    expect(left.x).toBe(80);
    expect(left.width).toBeGreaterThan(50);
    expect(left.width).toBeLessThan(200);
    const centred = drawnBox(L({ type: 'text', x: 80, y: 100, width: 920, content: { type: 'plain', value: 'Hi' }, style: { ...style, align: 'center' } })) as { x: number; width: number };
    expect(centred.x + centred.width / 2).toBeCloseTo(540, 0);
  });

  it('reserves the descender band only for a last line that descends', () => {
    // benchmark r1: a 400px "24" reached 80px into the "HOURS" set under it.
    const style = { font_size: 400, font_family: 'Archivo', line_height: 1 };
    const box = (value: string): { y: number; height: number } =>
      drawnBox(L({ type: 'text', x: 0, y: 0, width: 1000, content: { type: 'plain', value }, style })) as { y: number; height: number };
    const digits = box('24'), lower = box('gy');
    expect(digits.y).toBe(lower.y);
    expect(lower.height - digits.height).toBeCloseTo(400 * 0.18, 5);
    expect(box('quip\nHOME').height).toBeLessThan(box('HOME\nquip').height);   // only the LAST line counts
  });
});

describe('anchorPoint', () => {
  const b = { x: 100, y: 100, width: 200, height: 100 };
  it('matches keyframe-css transform-origin fractions', () => {
    expect(anchorPoint(b)).toEqual({ x: 200, y: 150 });
    expect(anchorPoint(b, 'bottom')).toEqual({ x: 200, y: 200 });
    expect(anchorPoint(b, 'top left')).toEqual({ x: 100, y: 100 });
    expect(anchorPoint(b, 'right')).toEqual({ x: 300, y: 150 });
  });
});

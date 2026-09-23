import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { collectFindings } from './diagnose-collect';

const rect = (id: string, x: number, y: number, w: number, h: number, extra: object = {}): Layer =>
  ({ id, type: 'rect', z: 2, x, y, width: w, height: h, fill: '#E4572E', ...extra } as unknown as Layer);
const slide = (dx: number): object => ({ animation: { keyframes: [{ t: 0, x: 0 }, { t: 1000, x: dx }], playback: { duration: 1000, origin: 'offset' } } });
const ground = rect('bg', 0, 0, 1080, 1080, { z: 0, fill: '#FAF5EC' });
const doc = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 } };
const codes = (spec: object, page?: string): Array<{ code: string; page?: string; layer_id?: string }> =>
  collectFindings(spec as DesignSpec, '/nowhere/d.design.yaml', undefined, page).filter(f => f.code.startsWith('motion_'));

describe('diagnose_design on a page that moves', () => {
  const cut = [ground, rect('ice', 100, 100, 100, 100, slide(300)), rect('bottle', 450, 50, 200, 400, { z: 5 })];

  it('reports what the motion cuts into each other at a shot\'s rest — as authored they were apart', () => {
    expect(codes({ ...doc, layers: cut })).toEqual([expect.objectContaining({ code: 'motion_collision', layer_id: 'bottle' })]);
  });

  it('scopes to the page it was found on, and says nothing about a still page', () => {
    const spec = { ...doc, pages: [{ id: 'still', layers: [ground, rect('a', 100, 100, 100, 100)] }, { id: 'moving', layers: cut }] };
    expect(codes(spec).map(f => f.page)).toEqual(['moving']);
    expect(codes(spec, 'still')).toEqual([]);
  });

  it('does not call two lines on one spot a collision when one leaves before the other arrives', () => {
    const line = (id: string, value: string, win: object): object =>
      ({ id, type: 'text', z: 5, x: 80, y: 300, width: 800, height: 90, content: { type: 'plain', value }, style: { font_size: 64 }, ...win });
    const static_ = (a: object, b: object): string[] =>
      collectFindings({ ...doc, layers: [ground, line('k1', 'First line here', a), line('k3', 'Second line now', b)] } as unknown as DesignSpec, '/nowhere/d.design.yaml')
        .filter(f => f.code === 'collision').map(f => f.layer_id ?? '');
    expect(static_({ out: 3000 }, { in: 3200 })).toEqual([]);
    expect(static_({ out: 3000 }, { in: 2000 })).toEqual(['k1']);
  });
});

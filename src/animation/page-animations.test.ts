import { describe, it, expect } from 'vitest';
import { pageAnimations } from './page-animations';
import type { Layer } from '../schema/types';
import type { AnimationSpec } from './types';

const anim = (delay: number): AnimationSpec => ({ keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400, delay } } as AnimationSpec);
const layer = (id: string, animation?: AnimationSpec, layers?: Layer[]): Layer =>
  ({ id, type: layers ? 'group' : 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, ...(animation ? { animation } : {}), ...(layers ? { layers } : {}) } as unknown as Layer);

describe('pageAnimations', () => {
  // benchmark r2: six scenes, each with its own "title"; the flat map held the
  // last one's, and the canvas played it on every slide.
  it('gives an id repeated across pages the track of the layer on screen', () => {
    const p1 = [layer('title', anim(200)), layer('kicker', anim(0))];
    const p2 = [layer('title', anim(900))];
    const flat = { title: anim(900), kicker: anim(0) };
    const out = pageAnimations(flat, p1, [p1, p2]);
    expect(out.get('title')?.playback?.delay).toBe(200);
    expect(out.get('kicker')?.playback?.delay).toBe(0);
  });

  it('keeps only the page on screen, in the map order', () => {
    const p1 = [layer('b', anim(1)), layer('a', anim(2))];
    const p2 = [layer('c', anim(3))];
    const out = pageAnimations({ a: anim(2), b: anim(1), c: anim(3) }, p1, [p1, p2]);
    expect([...out.keys()]).toEqual(['a', 'b']);
  });

  it('trusts the map for an id only one page has (editor panel edits live there)', () => {
    const p1 = [layer('solo', anim(0))];
    const out = pageAnimations({ solo: anim(700) }, p1, [p1]);
    expect(out.get('solo')?.playback?.delay).toBe(700);
  });

  it('drops a repeated id whose layer here is still, and reaches into groups', () => {
    const p1 = [layer('title'), layer('g', undefined, [layer('chip', anim(50))])];
    const p2 = [layer('title', anim(900)), layer('chip', anim(999))];
    const out = pageAnimations({ title: anim(900), chip: anim(999) }, p1, [p1, p2]);
    expect(out.has('title')).toBe(false);
    expect(out.get('chip')?.playback?.delay).toBe(50);
  });
});

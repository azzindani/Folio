import { describe, it, expect } from 'vitest';
import { pageAnimations, withAnimationMirror } from './page-animations';
import type { DesignSpec, Layer } from '../schema/types';
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

  // B4, seen live: a keyframe dragged on the timeline played on the canvas at the timing the file was opened with.
  it('plays the layer\'s own track over the map loaded with the file, and a track the map never had', () => {
    const p1 = [layer('solo', anim(440)), layer('fresh', anim(90)), layer('legacy')];
    const out = pageAnimations({ solo: anim(500), legacy: anim(300) }, p1, [p1]);
    expect(out.get('solo')?.playback?.delay).toBe(440);
    expect(out.get('fresh')?.playback?.delay).toBe(90);
    // An older file: the map is the only copy.
    expect(out.get('legacy')?.playback?.delay).toBe(300);
  });

  it('drops a repeated id whose layer here is still, and reaches into groups', () => {
    const p1 = [layer('title'), layer('g', undefined, [layer('chip', anim(50))])];
    const p2 = [layer('title', anim(900)), layer('chip', anim(999))];
    const out = pageAnimations({ title: anim(900), chip: anim(999) }, p1, [p1, p2]);
    expect(out.has('title')).toBe(false);
    expect(out.get('chip')?.playback?.delay).toBe(50);
  });
});

describe('withAnimationMirror', () => {
  const design = (layers: Layer[], animations?: Record<string, AnimationSpec>): DesignSpec =>
    ({ meta: { id: 'd', name: 'd', type: 'poster' }, document: { width: 10, height: 10 }, layers, ...(animations ? { animations } : {}) } as unknown as DesignSpec);
  type Mirrored = DesignSpec & { animations?: Record<string, AnimationSpec> };

  it('saves the tracks as they are now, in the map\'s order, keeping an older file\'s map-only entry and dropping a gone layer\'s', () => {
    const d = design([layer('b', anim(440)), layer('a', anim(1900)), layer('old'), layer('new', anim(5))],
      { a: anim(1500), b: anim(500), old: anim(300), gone: anim(1) });
    const m = (withAnimationMirror(d) as Mirrored).animations ?? {};
    expect(Object.keys(m)).toEqual(['a', 'b', 'old', 'new']);
    expect(m['a']?.playback?.delay).toBe(1900);
    expect(m['b']?.playback?.delay).toBe(440);
    expect(m['old']?.playback?.delay).toBe(300);
  });

  it('writes no map when nothing moves, and reaches pages and groups', () => {
    expect('animations' in withAnimationMirror(design([layer('still')], { still: anim(1) }))).toBe(true);
    expect('animations' in withAnimationMirror(design([layer('still')]))).toBe(false);
    const deck = { ...design([]), pages: [{ id: 'p', layers: [layer('g', undefined, [layer('chip', anim(50))])] }] } as unknown as DesignSpec;
    expect((withAnimationMirror(deck) as Mirrored).animations?.['chip']?.playback?.delay).toBe(50);
  });
});

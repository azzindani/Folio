import { describe, it, expect } from 'vitest';
import { animSpecToLottie, serializeLottie } from './lottie-export';
import type { AnimationSpec } from '../animation/types';

const baseAnim: AnimationSpec = {
  playback: { duration: 1000, loop: false },
  keyframes: [
    { t: 0, opacity: 0 },
    { t: 500, opacity: 0.5 },
    { t: 1000, opacity: 1 },
  ],
};

describe('animSpecToLottie', () => {
  it('returns correct Lottie version', () => {
    const r = animSpecToLottie('test', baseAnim, 1920, 1080);
    expect(r.v).toBe('5.9.0');
  });

  it('sets name, width, height', () => {
    const r = animSpecToLottie('my-layer', baseAnim, 1920, 1080);
    expect(r.nm).toBe('my-layer');
    expect(r.w).toBe(1920);
    expect(r.h).toBe(1080);
  });

  it('calculates op from duration and fps', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100, 30);
    expect(r.op).toBe(30); // 1000ms at 30fps = 30 frames
    expect(r.ip).toBe(0);
  });

  it('uses default fps of 30', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    expect(r.fr).toBe(30);
  });

  it('accepts custom fps', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100, 24);
    expect(r.fr).toBe(24);
  });

  it('generates a layer from keyframes', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    expect(r.layers.length).toBe(1);
    expect(r.layers[0].nm).toBe('l');
    expect(r.layers[0].ty).toBe(4);
  });

  it('generates animated opacity when keyframes provided', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    expect(r.layers[0].ks.o.a).toBe(1);
  });

  it('generates opacity keyframes from animSpec', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    const opKfs = r.layers[0].ks.o.k as Array<{ s: number[] }>;
    expect(opKfs[0].s[0]).toBe(0);   // 0% opacity → 0
    expect(opKfs[1].s[0]).toBeCloseTo(50); // 50% opacity → 50
  });

  it('returns static opacity when no keyframe opacity', () => {
    const anim: AnimationSpec = {
      playback: { duration: 1000 },
      keyframes: [{ t: 0 }, { t: 1000 }],
    };
    const r = animSpecToLottie('l', anim, 100, 100);
    expect(r.layers[0].ks.o.a).toBe(0);
    expect(r.layers[0].ks.o.k).toBe(100);
  });

  it('returns no layers when no keyframes', () => {
    const anim: AnimationSpec = { playback: { duration: 500 } };
    const r = animSpecToLottie('l', anim, 100, 100);
    expect(r.layers.length).toBe(0);
  });

  it('returns empty assets and markers', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    expect(r.assets).toEqual([]);
    expect(r.markers).toEqual([]);
  });

  it('sets position to center by default', () => {
    const r = animSpecToLottie('l', baseAnim, 200, 100);
    const pos = r.layers[0].ks.p.k as number[];
    expect(pos[0]).toBe(100);
    expect(pos[1]).toBe(50);
  });
});

describe('serializeLottie', () => {
  it('returns valid JSON string', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    const json = serializeLottie(r);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('JSON contains version field', () => {
    const r = animSpecToLottie('l', baseAnim, 100, 100);
    expect(serializeLottie(r)).toContain('"v":"5.9.0"');
  });
});

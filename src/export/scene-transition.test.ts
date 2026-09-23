import { describe, it, expect } from 'vitest';
import { transitionPoses, APPROXIMATED } from './scene-transition';

const W = 1080, H = 1350;
/** A strip's placement: where its slice lands across, how it is stretched along, and its depth scale. */
const place = (t: string | undefined): { at: number; along: number; k: number } => {
  const m = /translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+) ([-\d.]+)\)/.exec(t ?? '') ?? [];
  return { at: Number(m[1]), along: Number(m[3]), k: Number(m[4]) };
};
const at = (type: Parameters<typeof transitionPoses>[0], p: number, easing = 'linear'): ReturnType<typeof transitionPoses> =>
  transitionPoses(type, p, W, H, easing);

describe('transitionPoses', () => {
  it('fades the incoming scene in over the resting outgoing one', () => {
    expect(at('fade', 0)).toEqual({ from: {}, to: { opacity: 0 }, fromOnTop: false, backdrop: false });
    expect(at('fade', 1).to.opacity).toBe(1);
  });

  it('pushes both scenes a full canvas width in a slide', () => {
    expect(at('slide-left', 0)).toMatchObject({ from: { transform: 'translate(0 0)' }, to: { transform: 'translate(1080 0)' } });
    expect(at('slide-left', 1)).toMatchObject({ from: { transform: 'translate(-1080 0)' }, to: { transform: 'translate(0 0)' } });
    expect(at('slide-down', 0.5)).toMatchObject({ from: { transform: 'translate(0 675)' }, to: { transform: 'translate(0 -675)' } });
  });

  it('wipes with a growing clip anchored to the side it enters from', () => {
    expect(at('wipe-left', 0.25).to.clip_rect).toEqual({ x: 0, y: 0, width: 270, height: H });
    expect(at('wipe-right', 0.25).to.clip_rect).toEqual({ x: 810, y: 0, width: 270, height: H });
  });

  it('asks for a backdrop only where the canvas is uncovered mid-way', () => {
    expect(at('zoom-in', 0.5).backdrop).toBe(false);
    expect(at('zoom-out', 0.5).backdrop).toBe(true);
    expect(at('flip-v', 0.5).backdrop).toBe(true);
  });

  it('flips a card over in perspective: the front turning away first, then the back', () => {
    const early = at('flip-h', 0.25), late = at('flip-h', 0.75);
    expect(early.from.face?.strips.length).toBeGreaterThan(12);
    expect(early.to).toEqual({ opacity: 0 });
    expect(late.from).toEqual({ opacity: 0 });
    expect(late.to.face?.strips.length).toBeGreaterThan(12);
    // Turning about the centre line, the near side is drawn taller than the far side.
    const s = early.from.face?.strips ?? [];
    expect(place(s[0]?.transform).k).toBeGreaterThan(1);
    expect(place(s[s.length - 1]?.transform).k).toBeLessThan(1);
  });

  it('turns a cube: flat at rest, and the two faces meet at their shared edge mid-turn', () => {
    const rest = at('cube-left', 0);
    expect(rest.from.face?.strips[0]?.transform).toBe('translate(0 675) scale(1 1) translate(0 -675)');
    expect(rest.from.face?.outline).toBe('M 0 0 L 1080 0 L 1080 1350 L 0 1350 Z');
    expect(rest.to).toEqual({ opacity: 0 });
    const mid = at('cube-left', 0.5);
    // The outgoing face's right edge and the incoming face's left edge are one line.
    const corner = (o: string | undefined, i: number): number => Number((o ?? '').split(/[ML]/)[i + 1]?.trim().split(' ')[0]);
    expect(Math.abs(corner(mid.from.face?.outline, 1) - corner(mid.to.face?.outline, 0))).toBeLessThan(0.5);
    expect(mid.stage).toBe(true);
  });

  it('applies the easing to progress', () => {
    expect(transitionPoses('fade', 0.25, W, H, 'ease-in-out').to.opacity).toBeLessThan(0.25);
  });

  it('plays none as a cut and names every approximation', () => {
    expect(at('none', 0.5)).toEqual({ from: {}, to: {}, fromOnTop: false, backdrop: false });
    expect(Object.keys(APPROXIMATED).sort()).toEqual(['dissolve']);
  });
});

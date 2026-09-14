import { describe, it, expect } from 'vitest';
import { transitionPoses, APPROXIMATED } from './scene-transition';

const W = 1080, H = 1350;
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

  it('flips through the centre: old scene on top and squashing first, new scene after', () => {
    const early = at('flip-h', 0.25), late = at('flip-h', 0.75);
    expect(early).toMatchObject({ fromOnTop: true, to: { opacity: 0 } });
    expect(early.from.transform).toBe('translate(540 675) scale(0.5 1) translate(-540 -675)');
    expect(late).toMatchObject({ fromOnTop: false, from: { opacity: 0 } });
    expect(late.to.transform).toBe('translate(540 675) scale(0.5 1) translate(-540 -675)');
  });

  it('applies the easing to progress', () => {
    expect(transitionPoses('fade', 0.25, W, H, 'ease-in-out').to.opacity).toBeLessThan(0.25);
  });

  it('plays none as a cut and names every approximation', () => {
    expect(at('none', 0.5)).toEqual({ from: {}, to: {}, fromOnTop: false, backdrop: false });
    expect(Object.keys(APPROXIMATED).sort()).toEqual(['cube-left', 'cube-right', 'dissolve', 'flip-h', 'flip-v']);
  });
});

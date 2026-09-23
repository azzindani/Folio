import { describe, it, expect } from 'vitest';
import { opacityBase } from './opacity-base';
import { generateDesignAnimationCSS } from './css-generator';
import { layersAt } from '../export/gif-frames';
import type { Layer } from '../schema/types';
import type { AnimationSpec } from './types';

const layer = (opacity: number | undefined, keyframes: Array<Record<string, unknown>>): Layer =>
  ({ id: 'g', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, fill: '#f00',
    ...(opacity === undefined ? {} : { opacity }),
    animation: { keyframes, playback: { duration: 1000, origin: 'offset' } } } as unknown as Layer);

const cssOpacities = (l: Layer): number[] => {
  const css = generateDesignAnimationCSS(new Map([['g', (l as unknown as { animation: AnimationSpec }).animation]]), [l]);
  return [...css.matchAll(/opacity: ([\d.]+);/g)].map(m => Number(m[1]));
};
const frameOpacity = (l: Layer, t: number): number | undefined =>
  (layersAt([l], t)[0] as unknown as { opacity?: number }).opacity;

describe('opacityBase', () => {
  it('scales by the authored opacity, and reads an authored 0 on a fading layer as hidden-until-shown', () => {
    expect(opacityBase(0.5, [{ opacity: 1 }])).toBe(0.5);
    expect(opacityBase(undefined, [{ x: 4 }])).toBe(1);
    expect(opacityBase(0, [{ t: 0, opacity: 0 }, { t: 500, opacity: 0.9 }])).toBe(1);
    expect(opacityBase(0, [{ t: 0, x: 0 }, { t: 500, x: 40 }])).toBe(0);
  });
});

describe('the editor player and the exported frames agree on opacity', () => {
  // benchmark r2: glitch ghosts authored at 0 and keyframed to 0.9 flashed in
  // the editor and never appeared in the GIF or the MP4.
  it('shows a layer authored at 0 when its track brings it up — in both', () => {
    const ghost = layer(0, [{ t: 0, opacity: 0, hold: true }, { t: 500, opacity: 0.9, hold: true }, { t: 1000, opacity: 0 }]);
    expect(cssOpacities(ghost)).toContain(0.9);
    expect(frameOpacity(ghost, 600)).toBeCloseTo(0.9, 5);
  });

  it('keeps a half-transparent layer half-transparent while it only moves — in both', () => {
    const moving = layer(0.5, [{ t: 0, x: 0 }, { t: 1000, x: 100 }]);
    expect(Math.max(...cssOpacities(moving))).toBe(0.5);
    expect(frameOpacity(moving, 500)).toBe(0.5);
  });

  it('lands a fade on the authored opacity, not above it — in both', () => {
    const fade = layer(0.5, [{ t: 0, opacity: 0 }, { t: 1000, opacity: 1 }]);
    expect(Math.max(...cssOpacities(fade))).toBe(0.5);
    expect(frameOpacity(fade, 1000)).toBeCloseTo(0.5, 5);
  });
});

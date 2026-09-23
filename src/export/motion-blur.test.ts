import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { shutterOf, smearOf } from './motion-blur';
import { layersAt, specAt } from './gif-frames';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { rasterize } from '../utils/resvg-isolate';

/** A 200×60 bar sliding 300px right over 100ms, linearly. */
const bar = (extra: object = {}): Layer => ({
  id: 'bar', type: 'rect', z: 1, x: 50, y: 20, width: 200, height: 60, fill: '#000000',
  animation: { keyframes: [{ t: 0, x: 0, easing: 'linear' }, { t: 100, x: 300 }], playback: { duration: 100, origin: 'offset' } }, ...extra,
} as unknown as Layer);
type Smeared = Layer & { effects?: { motion_blur?: { dx: number; dy: number; samples: number } } };
const smearAt = (l: Layer, t: number, frameMs?: number): Smeared['effects'] =>
  (layersAt([l], t, frameMs)[0] as Smeared).effects;

describe('motion blur — what the sampler measures', () => {
  it('reads the switch: on, a shutter angle, or off', () => {
    expect(shutterOf(bar({ motion_blur: true }))).toBe(180);
    expect(shutterOf(bar({ motion_blur: { shutter: 90 } }))).toBe(90);
    expect(shutterOf(bar())).toBeNull();
  });

  it('smears a frame by the travel over the shutter, only when a frame length is given', () => {
    // 3 px/ms: a 360° shutter at 30 fps is open 33.3 ms → 100 px of travel.
    expect(smearAt(bar({ motion_blur: { shutter: 360 } }), 50, 1000 / 30)?.motion_blur).toMatchObject({ dx: 100, dy: 0, samples: 32 });
    expect(smearAt(bar({ motion_blur: true }), 50, 1000 / 30)?.motion_blur?.dx).toBe(50);
    expect(smearAt(bar({ motion_blur: true }), 50)).toBeUndefined();
    expect(smearAt(bar(), 50, 1000 / 30)).toBeUndefined();
    // At rest after the move there is nothing to smear.
    expect(smearAt(bar({ motion_blur: true }), 500, 1000 / 30)).toBeUndefined();
  });

  it('carries the travel into the layer\'s own frame under its turn', () => {
    const turned = { rotation: 90 };
    const l = bar({ motion_blur: true, animation: { keyframes: [{ t: 0, x: 0, ...turned, easing: 'linear' }, { t: 100, x: 300, ...turned }], playback: { duration: 100, origin: 'offset' } } });
    const s = smearOf(l, u => layersAt([l], u)[0] as Layer, 50, 1000 / 30, 180);
    expect([Math.round(s?.dx ?? 9), Math.round(s?.dy ?? 9)]).toEqual([0, -50]);
  });
});

describe('motion blur — what the frame shows', () => {
  it('draws the exact mean of the sub-frames: a ramp as long as the travel, solid where every copy covers', () => {
    const spec = { _protocol: 'design/v1', meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 500, height: 100 },
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 500, height: 100, fill: '#FFFFFF' }, bar({ motion_blur: { shutter: 360 } })] } as unknown as DesignSpec;
    const r = rasterize({ svg: renderToSVGString(specAt(spec, 0, 50, 1000 / 30)), opts: {}, want: 'pixels' }) as unknown as { pixels: Uint8Array; width: number };
    const at = (x: number): number => r.pixels[(50 * r.width + x) * 4] ?? -1;
    // The bar sits on 200–400 at t=50 and smears ±50: 10% covered at 160, half at 200 and 400, all of 250–350.
    expect(Math.abs(at(160) - 229)).toBeLessThanOrEqual(6);
    expect(Math.abs(at(200) - 127)).toBeLessThanOrEqual(6);
    expect(Math.abs(at(400) - 127)).toBeLessThanOrEqual(6);
    expect(at(300)).toBeLessThanOrEqual(6);
  });
});

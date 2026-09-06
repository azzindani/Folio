import { describe, it, expect } from 'vitest';
import { previewTimes, stripColumns, filmstripSVG } from '../mcp/engine/motion-preview';
import { layerTrail, surfaceTrails, trailMoves, trailsSVG } from './motion-trails';
import { easingCurvePath, easingOvershoot, easingCurveSVG } from '../ui/panels/easing-curve';
import type { Layer } from '../schema/types';

// Four ways to watch motion that did not exist: a filmstrip a model can read in
// one look, a play button on the canvas, the path a layer travels, and the
// SHAPE of an easing rather than its name.

const moving = (id: string, from = 0, to = 200): Layer => ({
  id, type: 'rect', x: 100, y: from, width: 40, height: 40, z: 0,
  animation: { keyframes: [{ t: 0, y: 0, opacity: 0 }, { t: 600, y: to - from, opacity: 1 }], playback: { duration: 600 } },
} as unknown as Layer);

const fading = (id: string): Layer => ({
  id, type: 'rect', x: 10, y: 10, width: 40, height: 40, z: 0,
  animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }], playback: { duration: 600 } },
} as unknown as Layer);

describe('op:preview — the filmstrip', () => {
  it('samples the whole scene, first and last included', () => {
    expect(previewTimes(1000, 5)).toEqual([0, 250, 500, 750, 1000]);
    expect(previewTimes(1150, 6)).toEqual([0, 230, 460, 690, 920, 1150]);
  });

  it('clamps a silly frame count instead of exploding', () => {
    expect(previewTimes(1000, 1).length).toBe(2);
    expect(previewTimes(1000, 999).length).toBe(24);
  });

  it('lays cells out in a readable grid, never one long row', () => {
    expect(stripColumns(3)).toBe(3);
    expect(stripColumns(6)).toBe(3);
    expect(stripColumns(12)).toBe(4);
  });

  it('labels every cell with its timecode', () => {
    const png = Buffer.from([0x89, 0x50]);
    const svg = filmstripSVG([{ png, t: 0 }, { png, t: 460 }], 100, 100, 460);
    expect(svg).toContain('0ms');
    expect(svg).toContain('460ms');
    expect(svg).toContain('scene 460ms · 2 poses');
    expect(svg.startsWith('<svg')).toBe(true);
  });
});

describe('motion trails', () => {
  it('follows the same sampler playback uses', () => {
    const tr = layerTrail(moving('a', 0, 200), 600, 5);
    expect(tr?.samples.length).toBe(5);
    expect(tr?.samples[0]?.y).toBe(0);
    expect(tr?.samples[4]?.y).toBe(200);
  });

  it('ignores a layer that only fades — a fade is not a path', () => {
    const tr = layerTrail(fading('f'), 600, 5);
    expect(tr).not.toBeNull();
    expect(trailMoves(tr!)).toBe(false);
    expect(surfaceTrails([fading('f')], 600)).toEqual([]);
  });

  it('reaches layers inside a group, like everything else now does', () => {
    const grouped = [{
      id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100, z: 0,
      layers: [moving('kid')],
    }] as unknown as Layer[];
    expect(surfaceTrails(grouped, 600).map(t => t.layerId)).toEqual(['kid']);
  });

  it('needs two keyframes and a real duration', () => {
    expect(layerTrail(moving('a'), 0)).toBeNull();
    expect(layerTrail({ id: 'x', type: 'rect' } as unknown as Layer, 600)).toBeNull();
  });

  it('draws a polyline through the centres, in design coordinates', () => {
    const svg = trailsSVG(surfaceTrails([moving('a', 0, 200)], 600, 3), 400, 400);
    expect(svg).toContain('<polyline');
    expect(svg).toContain('viewBox="0 0 400 400"');
  });

  it('draws nothing when nothing moves', () => {
    expect(trailsSVG([], 400, 400)).toBe('');
  });
});

describe('the easing curve', () => {
  it('plots a path that starts at rest and ends at full travel', () => {
    const d = easingCurvePath('ease-out', 100, 100, 8);
    expect(d.startsWith('M 0.00 100.00')).toBe(true);
    expect(d.endsWith('L 100.00 0.00')).toBe(true);
  });

  it('is SAMPLED, so it can draw easings a bezier cannot express', () => {
    // The whole reason not to build a cubic-bezier control cage: bounce is not
    // a bezier, and it is exactly the curve whose shape is hard to imagine.
    for (const name of ['ease-out-bounce', 'ease-out-elastic', 'ease-out-back']) {
      expect(easingCurvePath(name, 100, 100, 24).length, name).toBeGreaterThan(20);
    }
  });

  it('measures overshoot so the plot leaves room for it', () => {
    expect(easingOvershoot('linear')).toBeCloseTo(0, 3);
    expect(easingOvershoot('ease-out-back')).toBeGreaterThan(0);
  });

  it('never emits NaN, whatever the easing is called', () => {
    for (const name of ['', 'linear', 'not-a-real-easing', 'cubic-bezier(0,0,1,1)']) {
      expect(easingCurvePath(name, 100, 100, 6), name).not.toContain('NaN');
    }
    expect(easingCurveSVG('ease-in-out')).toContain('<path');
  });
});

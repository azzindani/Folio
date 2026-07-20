import { describe, it, expect } from 'vitest';
import { animationDuration, valuesAt, layersAt, specAt, frameTimes } from './gif-frames';
import type { Layer, DesignSpec } from '../schema/types';
import type { AnimationSpec } from '../animation/types';

const layer = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'rect', x: 100, y: 100, width: 50, height: 50, ...extra }) as unknown as Layer;

const rise: AnimationSpec = {
  keyframes: [{ t: 0, y: 24, opacity: 0 }, { t: 700, y: 0, opacity: 1 }],
  playback: { duration: 700, origin: 'offset' },
};

describe('animationDuration', () => {
  it('takes the longest delay + duration, so a stagger is not cut short', () => {
    const layers = [
      layer('a', { animation: { ...rise, playback: { duration: 700, delay: 0 } } }),
      layer('b', { animation: { ...rise, playback: { duration: 700, delay: 240 } } }),
    ];
    expect(animationDuration(layers)).toBe(940);
  });

  it('doubles an alternating loop so the GIF returns to its start', () => {
    // One pass ends mid-swell and snaps back on repeat — a jolt every cycle
    // that the CSS version never has.
    const layers = [layer('p', {
      animation: { keyframes: [{ t: 0, scale: 1 }, { t: 1400, scale: 1.06 }],
                   playback: { duration: 1400, loop: true, direction: 'alternate' } },
    })];
    expect(animationDuration(layers)).toBe(2800);
  });

  it('does not double a normal loop', () => {
    const layers = [layer('s', {
      animation: { keyframes: [{ t: 0, rotation: 0 }, { t: 6000, rotation: 360 }],
                   playback: { duration: 6000, loop: true, direction: 'normal' } },
    })];
    expect(animationDuration(layers)).toBe(6000);
  });

  it('recurses into groups', () => {
    const layers = [layer('g', { type: 'group', layers: [layer('kid', { animation: rise })] })];
    expect(animationDuration(layers)).toBe(700);
  });

  it('is zero when nothing is animated', () => {
    expect(animationDuration([layer('plain')])).toBe(0);
  });
});

describe('valuesAt', () => {
  it('holds the first keyframe until the delay elapses', () => {
    const delayed: AnimationSpec = { ...rise, playback: { duration: 700, delay: 200, origin: 'offset' } };
    expect(valuesAt(delayed, 100)['opacity']).toBe(0);
  });

  it('reaches the final keyframe at the end of a one-shot', () => {
    expect(valuesAt(rise, 700)['opacity']).toBe(1);
  });

  it('clamps past the end rather than looping a one-shot', () => {
    expect(valuesAt(rise, 5000)['opacity']).toBe(1);
  });

  it('plays an alternating loop backwards on odd cycles', () => {
    const anim: AnimationSpec = {
      keyframes: [{ t: 0, scale: 1 }, { t: 1000, scale: 2 }],
      playback: { duration: 1000, loop: true, direction: 'alternate' },
    };
    const forward = valuesAt(anim, 250)['scale'] as number;
    const backward = valuesAt(anim, 1250)['scale'] as number;
    // 250ms into the return leg should be near the far end, not near the start.
    expect(backward).toBeGreaterThan(forward);
  });
});

describe('layersAt', () => {
  it('offsets position by the animated delta', () => {
    const [out] = layersAt([layer('a', { animation: rise })], 0) as unknown as Record<string, number>[];
    expect(out['y']).toBe(124); // authored 100 + 24 offset at t=0
  });

  it('lands exactly at the authored position when the entrance finishes', () => {
    const [out] = layersAt([layer('a', { animation: rise })], 700) as unknown as Record<string, number>[];
    expect(out['y']).toBe(100);
  });

  it('scales about the centre, not the top-left', () => {
    const anim: AnimationSpec = {
      keyframes: [{ t: 0, scale: 1 }, { t: 100, scale: 2 }],
      playback: { duration: 100 },
    };
    const [out] = layersAt([layer('s', { animation: anim })], 100) as unknown as Record<string, number>[];
    expect(out['width']).toBe(100);
    // 50px wide grew to 100px, so the left edge moves back by half the growth.
    expect(out['x']).toBe(75);
  });

  it('strips the timeline from the resolved still frame', () => {
    const [out] = layersAt([layer('a', { animation: rise })], 0) as unknown as Record<string, unknown>[];
    expect(out['animation']).toBeUndefined();
  });

  it('resolves layers nested in groups', () => {
    const layers = [layer('g', { type: 'group', layers: [layer('kid', { animation: rise })] })];
    const out = layersAt(layers, 700) as unknown as { layers: Record<string, number>[] }[];
    expect(out[0].layers[0]['y']).toBe(100);
  });

  it('leaves unanimated layers alone', () => {
    const [out] = layersAt([layer('plain')], 500) as unknown as Record<string, number>[];
    expect(out['x']).toBe(100);
    expect(out['y']).toBe(100);
  });
});

describe('specAt', () => {
  it('narrows a multi-page design to the requested page', () => {
    const spec = {
      document: { width: 100, height: 100, unit: 'px', dpi: 96 },
      pages: [
        { id: 'p1', layers: [layer('one')] },
        { id: 'p2', layers: [layer('two', { animation: rise })] },
      ],
    } as unknown as DesignSpec;
    const out = specAt(spec, 1, 700);
    expect(out.pages).toHaveLength(1);
    expect(out.pages?.[0].layers?.[0].id).toBe('two');
  });
});

describe('frameTimes', () => {
  it('samples across the full run at the requested rate', () => {
    const times = frameTimes(1000, 12);
    expect(times).toHaveLength(12);
    expect(times[0]).toBe(0);
    expect(times[times.length - 1]).toBeLessThan(1000);
  });

  it('always yields at least one frame', () => {
    expect(frameTimes(10, 1)).toHaveLength(1);
  });
});

describe('layersAt — group transforms cascade', () => {
  const group = (anim: AnimationSpec): Layer => ({
    id: 'grp', type: 'group', x: 0, y: 0, width: 512, height: 512, locked: true,
    layers: [layer('child', { x: 136, y: 136, width: 240, height: 240 })],
    animation: anim,
  }) as unknown as Layer;

  const pulse: AnimationSpec = {
    keyframes: [{ t: 0, scale: 1 }, { t: 2000, scale: 1.5 }],
    playback: { duration: 2000, origin: 'offset' },
  };

  it('scales a group\'s children, not just the group box', () => {
    // Live bug: the SVG route gets this free because transform:scale() on the
    // <g> cascades. A flipbook renders from absolute coordinates, so animating
    // a group resized only its own width/height and every child stayed put —
    // the GIF showed no motion at all across 48 frames.
    const out = layersAt([group(pulse)], 2000) as unknown as { width: number; layers: Record<string, number>[] }[];
    expect(out[0].width).toBe(768);            // 512 * 1.5
    expect(out[0].layers[0]['width']).toBe(360); // 240 * 1.5 — the point
  });

  it('leaves children untouched when the group is not animating', () => {
    const out = layersAt([group(pulse)], 0) as unknown as { layers: Record<string, number>[] }[];
    expect(out[0].layers[0]['width']).toBe(240);
    expect(out[0].layers[0]['x']).toBe(136);
  });

  it('moves children with a translating group', () => {
    const slide: AnimationSpec = {
      keyframes: [{ t: 0, x: 0 }, { t: 100, x: 40 }],
      playback: { duration: 100, origin: 'offset' },
    };
    const out = layersAt([group(slide)], 100) as unknown as { layers: Record<string, number>[] }[];
    expect(out[0].layers[0]['x']).toBe(176); // 136 + 40
  });

  it('scales child font size with the box', () => {
    const g = {
      id: 'g', type: 'group', x: 0, y: 0, width: 100, height: 100,
      layers: [{ id: 't', type: 'text', x: 0, y: 0, width: 50, height: 20, size: 40 }],
      animation: pulse,
    } as unknown as Layer;
    const out = layersAt([g], 2000) as unknown as { layers: Record<string, number>[] }[];
    expect(out[0].layers[0]['size']).toBe(60); // 40 * 1.5
  });
});

import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderToSVGString } from '../mcp/engine/svg-export';
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

// Sampled motion lands as a transform plus the pose it was built from.
const sampled = (l: Layer, t: number): Record<string, unknown> => layersAt([l], t)[0] as unknown as Record<string, unknown>;
const poseOf = (r: Record<string, unknown>): Record<string, number> => r['_frame_pose'] as Record<string, number>;

describe('layersAt', () => {
  it('offsets position by the animated delta — as a translate, leaving the box authored', () => {
    const out = sampled(layer('a', { animation: rise }), 0);
    expect(out['transform']).toBe('translate(0 24)');
    expect(poseOf(out)['dy']).toBe(24);
    expect(out['y']).toBe(100);
  });

  it('lands exactly at the authored position when the entrance finishes', () => {
    const out = sampled(layer('a', { animation: rise }), 700);
    expect(poseOf(out)['dy']).toBe(0);
    expect(out['transform']).toBeUndefined();
  });

  it('scales about the centre of the drawn box, not the top-left', () => {
    const anim: AnimationSpec = {
      keyframes: [{ t: 0, scale: 1 }, { t: 100, scale: 2 }],
      playback: { duration: 100 },
    };
    const out = sampled(layer('s', { animation: anim }), 100);
    expect(out['transform']).toBe('translate(125 125) scale(2 2) translate(-125 -125)');
    expect(out['width']).toBe(50);
  });

  it('scales about the anchor — grow_up keeps its base on the floor', () => {
    const grow: AnimationSpec = {
      keyframes: [{ t: 0, scale_y: 0 }, { t: 100, scale_y: 1 }],
      playback: { duration: 100, anchor: 'bottom', easing: 'linear' },
    };
    expect(sampled(layer('bar', { animation: grow }), 50)['transform']).toBe('translate(125 150) scale(1 0.5) translate(-125 -150)');
  });

  it('strips the timeline from the resolved still frame', () => {
    const [out] = layersAt([layer('a', { animation: rise })], 0) as unknown as Record<string, unknown>[];
    expect(out['animation']).toBeUndefined();
  });

  it('resolves layers nested in groups', () => {
    const layers = [layer('g', { type: 'group', layers: [layer('kid', { animation: rise })] })];
    const out = layersAt(layers, 0) as unknown as { layers: Record<string, unknown>[] }[];
    expect(out[0].layers[0]['transform']).toBe('translate(0 24)');
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

  // What a viewer sees: render the sampled frame and read pixels. The pose
  // used to be pushed into each child's x/y/width/height, which scaled no text
  // and moved nothing without x/y — a line, a path.
  const px = (layers: Layer[], t: number): (x: number, y: number) => number[] => {
    const spec = { _protocol: 'design/v1', meta: { id: 'g', name: 'g', type: 'poster', created: '', modified: '' },
      document: { width: 512, height: 512, unit: 'px', dpi: 96 }, layers } as unknown as DesignSpec;
    const img = new Resvg(renderToSVGString(specAt(spec, 0, t)), { background: '#FFFFFF' }).render();
    // `pixels` is a native getter that copies the whole buffer on every read —
    // read it once, or a column scan allocates a megabyte per pixel.
    const pixels = img.pixels, w = img.width;
    return (x, y) => Array.from(pixels.subarray((y * w + x) * 4, (y * w + x) * 4 + 3));
  };

  it('puts the pose on the group itself and leaves the children authored', () => {
    const out = layersAt([group(pulse)], 2000) as unknown as { transform: string; layers: Record<string, number>[] }[];
    expect(out[0].transform).toBe('translate(256 256) scale(1.5 1.5) translate(-256 -256)');
    expect(out[0].layers[0]['width']).toBe(240);
  });

  it('scales a group\'s children in the rendered frame', () => {
    const red = [layer('kid', { x: 136, y: 136, width: 240, height: 240, fill: '#FF0000' })];
    const g = (): Layer => ({ id: 'grp', type: 'group', z: 1, x: 0, y: 0, width: 512, height: 512, layers: red, animation: pulse }) as unknown as Layer;
    // 240px about 256 grows to 360px: its left edge moves from 136 to 76.
    expect(px([g()], 0)(100, 256)).toEqual([255, 255, 255]);
    expect(px([g()], 2000)(100, 256)).toEqual([255, 0, 0]);
  });

  it('carries a line child with a sliding group — a line has no x/y to move', () => {
    const slide: AnimationSpec = { keyframes: [{ t: 0, x: 0 }, { t: 100, x: 200 }], playback: { duration: 100, origin: 'offset' } };
    const line = { id: 'ln', type: 'line', z: 1, x1: 20, y1: 100, x2: 60, y2: 100, stroke: { color: '#0000FF', width: 8 } };
    const g = { id: 'grp', type: 'group', z: 1, x: 0, y: 0, width: 512, height: 512, layers: [line], animation: slide } as unknown as Layer;
    expect(px([g], 100)(40, 100)).toEqual([255, 255, 255]);
    expect(px([g], 100)(240, 100)).toEqual([0, 0, 255]);
  });

  it('scales a text child\'s glyphs, not just its box', () => {
    // ~167px of ink centred on the pivot (256), so the 1.5× swell stays on the canvas.
    const text = { id: 't', type: 'text', z: 1, x: 106, y: 200, width: 300, content: { type: 'plain', value: 'WWW' }, style: { font_size: 60, color: '#000000', align: 'center' } };
    const g = (anim?: AnimationSpec): Layer => ({ id: 'grp', type: 'group', z: 1, x: 0, y: 0, width: 512, height: 512, layers: [text], ...(anim ? { animation: anim } : {}) }) as unknown as Layer;
    const ink = (read: (x: number, y: number) => number[]): number => {
      let cols = 0;
      for (let x = 0; x < 512; x++) for (let y = 120; y < 380; y++) if (read(x, y)[0] < 128) { cols++; break; }
      return cols;
    };
    expect(ink(px([g(pulse)], 2000))).toBeGreaterThan(ink(px([g()], 0)) * 1.3);
  });
});

describe('skew and draw reach a sampled frame', () => {
  const anim = (kf: Record<string, unknown>[]): AnimationSpec =>
    ({ keyframes: kf, playback: { duration: 1000 } } as unknown as AnimationSpec);

  // Both channels were held at rest in the flipbook: the CSS route played them
  // and every exported still showed the layer upright and fully drawn.
  it('skews about the layer CENTRE with CSS\'s own skew matrix, so it leans without sliding', () => {
    const l = layer('box', { x: 100, y: 100, width: 200, height: 100, animation: anim([{ t: 0, skew_x: 0 }, { t: 1000, skew_x: 30 }]) });
    const out = layersAt([l], 1000)[0] as unknown as Record<string, unknown>;
    // centre of the box, then back again — otherwise the skew drags it sideways
    expect(out['transform']).toBe('translate(200 150) matrix(1 0 0.577 1 0 0) translate(-200 -150)');
  });

  it('leaves transform alone when neither skew channel moves', () => {
    const l = layer('box', { x: 0, y: 0, width: 10, height: 10, animation: anim([{ t: 0, opacity: 0 }, { t: 1000, opacity: 1 }]) });
    expect((layersAt([l], 500)[0] as unknown as Record<string, unknown>)['transform']).toBeUndefined();
  });

  it('reveals a stroke by dashing it with the path\'s own length', () => {
    const l = layer('line', { type: 'path', d: 'M 0 0 L 100 0', animation: anim([{ t: 0, draw: 0 }, { t: 1000, draw: 1 }]) });
    const half = layersAt([l], 500)[0] as unknown as Record<string, unknown>;
    expect(half['stroke_dasharray']).toBe(100);
    expect(half['stroke_dashoffset']).toBe(50);        // half still hidden
  });

  it('stops dashing once the line is fully drawn', () => {
    const l = layer('line', { type: 'path', d: 'M 0 0 L 100 0', animation: anim([{ t: 0, draw: 0 }, { t: 1000, draw: 1 }]) });
    expect((layersAt([l], 1000)[0] as unknown as Record<string, unknown>)['stroke_dashoffset']).toBeUndefined();
  });

  // After Effects' Trim Paths start: the run is draw_start → draw, so a segment
  // travels instead of only drawing on. Checked in pixels, since a string dash
  // and a negative offset both have to survive the renderer and resvg.
  it('trims the start of a stroke, so a segment travels along it', () => {
    const seg = (): Layer => layer('seg', { type: 'line', z: 1, x1: 0, y1: 50, x2: 200, y2: 50, stroke: { color: '#0000FF', width: 10 },
      animation: anim([{ t: 0, draw_start: 0, draw: 0.5 }, { t: 1000, draw_start: 0.5, draw: 1 }]) });
    expect(layersAt([seg()], 500)[0]).toMatchObject({ stroke_dasharray: '100 200', stroke_dashoffset: -50 });
    const spec = { _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'poster', created: '', modified: '' },
      document: { width: 200, height: 100, unit: 'px', dpi: 96 }, layers: [seg()] } as unknown as DesignSpec;
    const img = new Resvg(renderToSVGString(specAt(spec, 0, 500)), { background: '#FFFFFF' }).render();
    const pixels = img.pixels;
    const blue = (x: number): boolean => pixels[(50 * img.width + x) * 4 + 2] > 200 && pixels[(50 * img.width + x) * 4] < 60;
    expect([blue(25), blue(100), blue(175)]).toEqual([false, true, false]); // visible 50 → 150 only
  });

  it('wipes a layer in with a clip on its drawn box, from the left by default', () => {
    const l = layer('card', { x: 100, y: 100, width: 200, height: 100, animation: anim([{ t: 0, reveal: 0 }, { t: 1000, reveal: 1 }]) });
    const clip = (layersAt([l], 500)[0] as unknown as Record<string, unknown>)['clip_rect'] as { x: number; width: number };
    expect(clip.x + clip.width).toBe(200);  // the wiping edge at the middle of the box
    expect(clip.x).toBeLessThan(100);       // the side that is not wiping stays open
    expect((layersAt([l], 1000)[0] as unknown as Record<string, unknown>)['clip_rect']).toBeUndefined();
  });

  it('tracks text at draw time without re-wrapping its lines', () => {
    const words = layer('words', { type: 'text', z: 1, x: 20, y: 20, width: 300, content: { type: 'plain', value: 'Two short lines of words here' },
      style: { font_size: 40, letter_spacing: 4 }, animation: anim([{ t: 0, tracking: 20 }, { t: 1000, tracking: 0 }]) });
    expect(layersAt([words], 0)[0]).toMatchObject({ tracking_offset: 20 });
    const svgAt = (t: number): string => renderToSVGString(specAt({ _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'poster', created: '', modified: '' },
      document: { width: 400, height: 300, unit: 'px', dpi: 96 }, layers: [words] } as unknown as DesignSpec, 0, t));
    expect(svgAt(0)).toContain('letter-spacing="24px"');
    expect(svgAt(1000)).toContain('letter-spacing="4px"');
    const lines = (s: string): number => (s.match(/<tspan/g) ?? []).length;
    expect(lines(svgAt(0))).toBeGreaterThan(1);
    expect(lines(svgAt(0))).toBe(lines(svgAt(1000)));
  });

  it('counts a figure up in its own format, frame by frame', () => {
    const stat = layer('stat', { type: 'text', content: { type: 'plain', value: '1,250+' },
      animation: { keyframes: [{ t: 0, count: 0 }, { t: 1000, count: 1 }], playback: { duration: 1000, easing: 'linear' } } });
    const at = (t: number): string => (layersAt([stat], t)[0] as unknown as { content: { value: string } }).content.value;
    expect(at(0)).toBe('0+');
    expect(at(500)).toBe('625+');
    expect(at(1000)).toBe('1,250+');
  });

  it('morphs a path toward its morph_to outline, frame by frame', () => {
    const square = 'M 0 0 L 100 0 L 100 100 L 0 100 Z';
    const shape = layer('shape', { type: 'path', d: square, morph_to: 'M 50 0 L 100 50 L 50 100 L 0 50 Z',
      animation: { keyframes: [{ t: 0, morph: 0 }, { t: 1000, morph: 1 }], playback: { duration: 1000, easing: 'linear' } } });
    const d = (t: number): string => String((layersAt([shape], t)[0] as unknown as Record<string, unknown>)['d']);
    expect(d(0)).toBe(square); // at rest the authored outline is untouched
    expect(d(500)).toMatch(/^M [\d.]+ [\d.]+ (L [\d.]+ [\d.]+ ){95}Z$/); // 96 resampled points
    expect(d(1000)).not.toBe(d(500));
  });

  it('ignores draw on a layer with no outline to measure', () => {
    const l = layer('words', { type: 'text', animation: anim([{ t: 0, draw: 0 }, { t: 1000, draw: 1 }]) });
    expect((layersAt([l], 500)[0] as unknown as Record<string, unknown>)['stroke_dasharray']).toBeUndefined();
  });

  // Only layers carrying `d` were measured, so a plain `line` — the connector in
  // a flow diagram — stood fully drawn from frame 0 of every GIF.
  const drawnAt = (extra: Record<string, unknown>, t: number): Record<string, unknown> =>
    layersAt([layer('s', { ...extra, animation: anim([{ t: 0, draw: 0 }, { t: 1000, draw: 1 }]) })], t)[0] as unknown as Record<string, unknown>;

  it('measures a line from its end points, and hides it completely at draw 0', () => {
    const line = { type: 'line', x1: 540, y1: 640, x2: 540, y2: 720 };
    expect(drawnAt(line, 0)).toMatchObject({ stroke_dasharray: 80, stroke_dashoffset: 80 });
    expect(drawnAt(line, 500)).toMatchObject({ stroke_dasharray: 80, stroke_dashoffset: 40 });
  });

  it('measures rects, including rounded corners', () => {
    expect(drawnAt({ width: 100, height: 50 }, 0)['stroke_dasharray']).toBe(300);
    // four quarter circles of r=10 replace 80px of straight edge with 62.83px of arc
    expect(drawnAt({ width: 100, height: 50, radius: 10 }, 0)['stroke_dasharray']).toBe(Math.ceil(300 - 80 + 20 * Math.PI));
    const perCorner = drawnAt({ width: 100, height: 50, radius: { tl: 10, tr: 0, br: 0, bl: 0 } }, 0)['stroke_dasharray'] as number;
    expect(perCorner).toBeGreaterThan(283);
    expect(perCorner).toBeLessThan(300);
  });

  it('measures ellipses and polygons', () => {
    expect(drawnAt({ type: 'ellipse', width: 100, height: 100 }, 0)['stroke_dasharray']).toBe(Math.ceil(100 * Math.PI));
    expect(drawnAt({ type: 'polygon', points: '0,0 100,0 100,100' }, 0)['stroke_dasharray']).toBe(Math.ceil(200 + Math.SQRT2 * 100));
    expect(drawnAt({ type: 'polygon', sides: 4, width: 100, height: 100 }, 0)['stroke_dasharray']).toBe(Math.ceil(200 * Math.SQRT2));
  });

  it('never reports an opacity above 1, even when the curve overshoots', () => {
    const l = layer('pop', { animation: { keyframes: [{ t: 0, opacity: 0, easing: 'ease-out-back' }, { t: 1000, opacity: 1 }], playback: { duration: 1000 } } });
    for (const t of [300, 500, 700, 900]) {
      expect((layersAt([l], t)[0] as unknown as Record<string, unknown>)['opacity']).toBeLessThanOrEqual(1);
    }
  });
});

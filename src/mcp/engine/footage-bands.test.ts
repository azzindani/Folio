import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { DesignSpec, Layer } from '../../schema/types';
import { resolveImageAssets } from './asset-resolve';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { specAt } from '../../export/gif-frames';
import { rasterize } from '../../utils/resvg-isolate';
import { bandedFrame, paintBanded, plainClip, placedRect, decodeSize } from './footage-bands';
import { FootageFeed } from './video-feed';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined;
const clip = (extra: Record<string, unknown> = {}): Layer =>
  ({ id: 'take', type: 'video', src: 'assets/video/take.mp4', x: 40, y: 20, width: 240, height: 135, z: 1, fit: 'cover',
    _video_file: '/x/take.mp4', _video_ms: 500, ...extra }) as unknown as Layer;

describe('plainClip — which clips are drawn as pixels', () => {
  it('a box, a fit, an opacity and its clock are plain', () => {
    // The older focal point reads in thirds, as it always rendered (animation/clip-crop.ts).
    expect(plainClip(clip({ opacity: 0.5, focal: [0.1, 0.9] }))).toMatchObject({ x: 40, y: 20, w: 240, h: 135, fit: 'cover', opacity: 0.5, crop: { focus: [0, 1], zoom: 1 }, panned: false });
    // A pan stays plain: its crop at the frame's file moment, decoded once at its closest zoom.
    const panned = plainClip(clip({ video: { offset_ms: 0, pan: [{ at_ms: 0, focus: [0, 0.5], zoom: 2 }, { at_ms: 4000, focus: [1, 0.5] }] } }));
    expect(panned).toMatchObject({ panned: true, zoomMax: 2, crop: { zoom: 2 } });
    expect(plainClip(clip({ fit: undefined }))?.fit).toBe('cover');
  });
  it('a fade posed by the flipbook stays plain; a move does not', () => {
    const fading = { ...clip(), animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }] } } as unknown as Layer;
    const moving = { ...clip(), animation: { keyframes: [{ t: 0, x: 0 }, { t: 500, x: 100 }] } } as unknown as Layer;
    const pose = (l: Layer): Layer | undefined => specAt({ meta: { name: 'p', version: '1' }, document: { width: 320, height: 180, unit: 'px' }, layers: [l] } as unknown as DesignSpec, 0, 250).layers?.[0];
    const faded = pose(fading);
    expect(faded && plainClip(faded)?.opacity).toBeCloseTo(0.5, 2);
    const moved = pose(moving);
    expect(moved && plainClip(moved)).toBeNull();
  });
  it('any other treatment, or no stored file, leaves it to the renderer', () => {
    for (const extra of [{ rotation: 10 }, { mask: 'circle' }, { effects: [{ type: 'blur' }] }, { fit: 'none' }, { _video_file: undefined }]) {
      expect(plainClip(clip(extra))).toBeNull();
    }
  });
});

describe('bandedFrame — cut at the clips in paint order', () => {
  const spec = (layers: Layer[]): DesignSpec =>
    ({ meta: { name: 'b', version: '1' }, document: { width: 320, height: 180, unit: 'px' }, layers } as unknown as DesignSpec);
  const under = { id: 'under', type: 'rect', x: 0, y: 0, width: 320, height: 180, z: 0, fill: '#223344' } as unknown as Layer;
  const over = { id: 'over', type: 'rect', x: 0, y: 140, width: 320, height: 40, z: 2, fill: '#F0E0D0' } as unknown as Layer;

  it('puts what is under a clip in band 0 and what is over it in band 1', () => {
    const b = bandedFrame(spec([over, clip(), under]));
    expect(b?.slots.map(s => s.req.id)).toEqual(['take']);
    expect(b?.bands[0]).toContain('data-layer-id="under"');
    expect(b?.bands[0]).not.toContain('data-layer-id="over"');
    expect(b?.bands[1]).toContain('data-layer-id="over"');
    expect(b?.bands.join('')).not.toContain('data-layer-id="take"');
  });
  it('band 0 is always drawn; an empty band above is skipped', () => {
    const b = bandedFrame(spec([clip()]));
    expect(typeof b?.bands[0]).toBe('string');
    expect(b?.bands[1]).toBeNull();
  });
  const group = (extra: Record<string, unknown>, layers: Layer[]): Layer =>
    ({ id: 'g', type: 'group', x: 0, y: 0, width: 320, height: 180, z: 1, layers, ...extra }) as unknown as Layer;
  const a = { id: 'a', type: 'rect', x: 10, y: 10, width: 50, height: 50, z: 0, fill: '#AA0000' } as unknown as Layer;
  const c = { id: 'c', type: 'rect', x: 200, y: 10, width: 50, height: 50, z: 2, fill: '#00AA00' } as unknown as Layer;

  it('cuts inside a group: its paint order around the clip, the group kept on both sides', () => {
    const b = bandedFrame(spec([under, group({ transform: 'translate(20 10) scale(1.5)' }, [c, clip(), a]), over]));
    expect(b?.slots.map(s => [s.req.id, s.canvas])).toEqual([['take', { x: 80, y: 40, width: 360, height: 202.5 }]]);
    expect(b?.bands[0]).toContain('data-layer-id="a"');
    expect(b?.bands[0]).not.toContain('data-layer-id="c"');
    expect(b?.bands[1]).toContain('data-layer-id="c"');
    expect(b?.bands[1]).toContain('data-layer-id="over"');
    // The group's transform rides on both halves.
    expect(b?.bands.filter(x => x?.includes('translate(20 10) scale(1.5)')).length).toBe(2);
    expect(b?.bands.join('')).not.toContain('data-layer-id="take"');
  });
  it('a wipe and a fade on the way are read into the clip; a faded wrapper is fine only around the clip alone', () => {
    const wiped = bandedFrame(spec([group({ clip_rect: { x: 0, y: 0, width: 100, height: 180 }, opacity: 0.5 }, [clip({ transform: 'translate(-30 0)' })])]));
    expect(wiped?.slots[0]).toMatchObject({ opacity: 0.5, canvas: { x: 10, y: 20 }, window: { x: 0, y: 0, width: 100, height: 180 } });
    expect(bandedFrame(spec([group({ opacity: 0.5 }, [a, clip()])]))).toBeNull();
  });
  it('a turn, a flip, an effect or a layout on the way — or a treated clip — sends the frame down the embedded path', () => {
    expect(bandedFrame(spec([group({ transform: 'rotate(5 160 90)' }, [clip()])]))).toBeNull();
    expect(bandedFrame(spec([group({ transform: 'scale(-1 1)' }, [clip()])]))).toBeNull();
    expect(bandedFrame(spec([group({ effects: { blur: 4 } }, [clip()])]))).toBeNull();
    expect(bandedFrame(spec([{ ...group({}, [clip()]), type: 'auto_layout' } as unknown as Layer]))).toBeNull();
    expect(bandedFrame(spec([under, clip({ rotation: 5 })]))).toBeNull();
    expect(bandedFrame(spec([under]))).toBeNull();
  });
});

describe('placedRect / decodeSize — a scaled clip keeps one decoder per zoom step', () => {
  const at = (canvas: { x: number; y: number; width: number; height: number }) => {
    const slot = plainClip(clip());
    if (!slot) throw new Error('not plain');
    return { ...slot, canvas };
  };
  it('moved by a fraction it keeps its own size; scaled it decodes at the next step, the same size all through the step', () => {
    expect(placedRect(at({ x: 40.4, y: 19.6, width: 240, height: 135 }), 1)).toEqual({ x: 40, y: 20, w: 240, h: 135 });
    const size = (k: number): { w: number; h: number } => { const s = at({ x: 0, y: 0, width: 240 * k, height: 135 * k }); return decodeSize(s, placedRect(s, 1), 1); };
    expect(size(1.05)).toEqual({ w: 300, h: 169 });
    expect(size(1.2)).toEqual(size(1.05));
    expect(size(1.3)).toEqual({ w: 360, h: 203 });
    expect(size(0.5)).toEqual({ w: 240, h: 135 });
  });
});

describe.skipIf(!hasFfmpeg)('paintBanded matches the embedded path', () => {
  let dir = '';
  // Blurred: a hard-edged test card measures how two resamplers differ, not whether the frame is right.
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-vbands-'));
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'assets', 'video'), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=640x360:rate=10:duration=2', '-vf', 'gblur=sigma=8', '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p', '-y', path.join(dir, 'assets', 'video', 'take.mp4')], { timeout: 30_000 });
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  // Contain lands its letterbox edge on a half pixel here (15 px of padding): the SVG anti-aliases that
  // row, decoded pixels sit on whole ones — an edge-row difference, so its bar is 38 dB.
  it.each([['cover', 40], ['contain', 38], ['fill', 40]] as const)('fit %s: PSNR ≥ %i dB against the SVG with the frame embedded', async (fit, bar) => {
    const layers = [
      { id: 'under', type: 'rect', x: 0, y: 0, width: 320, height: 180, z: 0, fill: '#223344' },
      { id: 'take', type: 'video', src: 'assets/video/take.mp4', x: 40, y: 20, width: 240, height: 150, z: 1, fit, opacity: 0.8, video: { offset_ms: 300 } },
      { id: 'over', type: 'rect', x: 0, y: 140, width: 320, height: 40, z: 2, fill: '#F0E0D0', opacity: 0.7 },
    ];
    const s = { meta: { name: 'b', version: '1' }, document: { width: 320, height: 180, unit: 'px' }, layers } as unknown as DesignSpec;
    resolveImageAssets(s, path.join(dir, 'designs', 'd.design.yaml'), dir);
    const frame = specAt(s, 0, 400);
    const opts = (ground: boolean): { font: ReturnType<typeof resvgFontOption>; background?: string } => ({ font: resvgFontOption(dir), ...(ground ? { background: '#FFFFFF' } : {}) });
    const want = rasterize({ svg: renderToSVGString(frame), opts: opts(true), want: 'pixels' }, { isolate: false });
    const b = bandedFrame(frame);
    expect(b).not.toBeNull();
    const feed = new FootageFeed();
    try {
      const got = b ? await paintBanded(b, 1, {
        render: async (svg, ground) => rasterize({ svg, opts: opts(ground), want: 'pixels' }, { isolate: false }),
        clip: (slot, w, h) => feed.pixelsAt(slot, w, h),
      }) : null;
      expect(got?.width).toBe(want.width);
      let se = 0;
      for (let i = 0; i < want.pixels.length; i++) { const d = (want.pixels[i] ?? 0) - (got?.pixels[i] ?? 0); se += d * d; }
      const psnr = 10 * Math.log10((255 * 255) / Math.max(1e-9, se / want.pixels.length));
      expect(psnr).toBeGreaterThanOrEqual(bar);
    } finally { feed.close(); }
  }, 30_000);

  // A clip placed by what is above it: moved by a group, scaled by a camera, wiped, pushed by its own pose.
  const placements: Array<[string, number, (take: Layer) => Layer[]]> = [
    ['moved by a group', 38, t => [{ id: 'g', type: 'group', x: 0, y: 0, width: 320, height: 180, z: 1, transform: 'translate(23 7)', layers: [t] } as unknown as Layer]],
    ['scaled by a camera', 37, t => [{ id: 'g', type: 'group', x: 0, y: 0, width: 320, height: 180, z: 1, transform: 'translate(160 90) scale(1.3) translate(-160 -90)', layers: [t] } as unknown as Layer]],
    ['wiped', 39, t => [{ ...t, clip_rect: { x: 40, y: 20, width: 121, height: 150 } } as unknown as Layer]],
    ['pushed', 35, t => [{ ...t, transform: 'translate(-61.4 0)' } as unknown as Layer]],
  ];
  it.each(placements)('%s: PSNR ≥ %i dB against the embedded frame', async (_name, bar, place) => {
    const layers = [
      { id: 'under', type: 'rect', x: 0, y: 0, width: 320, height: 180, z: 0, fill: '#223344' },
      { id: 'take', type: 'video', src: 'assets/video/take.mp4', x: 40, y: 20, width: 240, height: 150, z: 1, video: { offset_ms: 300 } },
      { id: 'over', type: 'rect', x: 0, y: 140, width: 320, height: 40, z: 2, fill: '#F0E0D0', opacity: 0.7 },
    ];
    const s = { meta: { name: 'b', version: '1' }, document: { width: 320, height: 180, unit: 'px' }, layers } as unknown as DesignSpec;
    resolveImageAssets(s, path.join(dir, 'designs', 'd.design.yaml'), dir);
    const sampled = specAt(s, 0, 400);
    const [u, take, o] = sampled.layers ?? [];
    if (!u || !take || !o) throw new Error('no layers');
    const frame = { ...sampled, layers: [u, ...place(take), o] };
    const opts = (ground: boolean): { font: ReturnType<typeof resvgFontOption>; background?: string } => ({ font: resvgFontOption(dir), ...(ground ? { background: '#FFFFFF' } : {}) });
    const want = rasterize({ svg: renderToSVGString(frame), opts: opts(true), want: 'pixels' }, { isolate: false });
    const b = bandedFrame(frame);
    expect(b).not.toBeNull();
    const feed = new FootageFeed();
    try {
      const got = b ? await paintBanded(b, 1, {
        render: async (svg, ground) => rasterize({ svg, opts: opts(ground), want: 'pixels' }, { isolate: false }),
        clip: (slot, w, h) => feed.pixelsAt(slot, w, h),
      }) : null;
      let se = 0;
      for (let i = 0; i < want.pixels.length; i++) { const d = (want.pixels[i] ?? 0) - (got?.pixels[i] ?? 0); se += d * d; }
      const psnr = 10 * Math.log10((255 * 255) / Math.max(1e-9, se / want.pixels.length));
      expect(psnr).toBeGreaterThanOrEqual(bar);
    } finally { feed.close(); }
  }, 30_000);
});

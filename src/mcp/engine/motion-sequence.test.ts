import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { sequenceMotion, setTrack, clearMotion, listMotionPresets } from './motion-sequence';
import { mergeFragment, MergeError, trackEnd } from './motion-merge';
import { sceneTracks, sceneLength, renderSceneASCII } from './timeline-ascii';
import { renderFrame } from './motion-frame';
import { inspectTimeline } from '../engine';
import { expandPreset, PRESET_NAMES, PRESET_KIND, presetsByKind } from './motion-presets';
import { generateKeyframeCSS } from '../../animation/keyframe-css';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-seq-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeDesign(name: string, layersYaml: string[]): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, [
    '_protocol: "design/v1"',
    'meta: { id: "m1", name: "Seq", type: "poster", created: "", modified: "" }',
    'document: { width: 400, height: 300, unit: "px" }',
    'layers:',
    ...layersYaml,
  ].join('\n'));
  return p;
}
const flat = (): string => writeDesign('flat.design.yaml', [
  '  - { id: title, type: text, x: 20, y: 20, width: 300, height: 40, text: "Hi", size: 32, color: "#111111" }',
  '  - { id: a, type: rect, x: 20, y: 80, width: 100, height: 30, fill: "#3366ff" }',
  '  - { id: b, type: rect, x: 20, y: 120, width: 100, height: 30, fill: "#3366ff" }',
  '  - { id: rule, type: line, x: 20, y: 70, width: 300, height: 0, stroke: { color: "#111111", width: 2 } }',
]);
const read = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf-8')) as DesignSpec;
const animOf = (spec: DesignSpec, id: string): AnimationSpec | undefined =>
  (spec.layers ?? []).find((l: Layer) => l.id === id)?.animation;

describe('presets vocabulary', () => {
  it('every preset expands to ≥2 keyframes with a kind', () => {
    for (const p of PRESET_NAMES) {
      const e = expandPreset(p);
      expect(e.keyframes.length, p).toBeGreaterThanOrEqual(2);
      expect(['entrance', 'exit', 'loop']).toContain(PRESET_KIND[p]);
      expect(generateKeyframeCSS('x', e), p).toContain('@keyframes');
    }
    const k = presetsByKind();
    expect(k.entrance).toContain('draw_on');
    expect(k.exit).toContain('pop_out');
    expect(k.loop).toContain('heartbeat');
  });

  it('grow_up and sway pivot on the bottom edge', () => {
    expect(expandPreset('grow_up').playback.anchor).toBe('bottom');
    expect(expandPreset('sway').playback.anchor).toBe('bottom');
  });

  it('op:presets lists the menu without a design', () => {
    const r = listMotionPresets();
    expect(r.success).toBe(true);
    expect(Object.keys(r['entrances'] as object)).toContain('pop');
    expect(Object.keys(r['easings'] as object)).toContain('ease-out-elastic');
  });
});

describe('mergeFragment', () => {
  it('folds an entrance and a later exit into one track', () => {
    const enter = expandPreset('rise', { delay: 0 });
    const exit = expandPreset('fade_out', { delay: 3000 });
    const merged = mergeFragment({ keyframes: enter.keyframes, playback: enter.playback }, exit);
    expect(merged.playback?.delay).toBeUndefined();
    expect(merged.playback?.duration).toBe(3400);
    const ts = (merged.keyframes ?? []).map(k => k.t);
    expect(ts).toEqual([0, 700, 3000, 3400]);
    // Entrance easing survives on its own frames; the hop between is linear.
    expect(merged.keyframes?.[0].easing).toBe('ease-out');
    expect(merged.keyframes?.[1].easing).toBe('linear');
    expect(merged.keyframes?.[2].easing).toBe('ease-in');
    expect(trackEnd(merged)).toBe(3400);
  });

  it('refuses overlapping and loop merges with a hint', () => {
    const a = expandPreset('rise', { delay: 0 });
    const b = expandPreset('sink', { delay: 300 });
    expect(() => mergeFragment({ keyframes: a.keyframes, playback: a.playback }, b)).toThrow(MergeError);
    const loop = expandPreset('pulse');
    expect(() => mergeFragment({ keyframes: loop.keyframes, playback: loop.playback }, b)).toThrow(/loop/);
  });
});

describe('animation(op:sequence)', () => {
  it('chains steps, staggers, folds an exit and reports scene length', () => {
    const p = flat();
    const r = sequenceMotion({ design_path: p, steps: [
      { preset: 'blur_in', layer_ids: ['title'] },
      { preset: 'rise', layer_ids: ['a', 'b'], stagger_ms: 100 },
      { preset: 'draw_on', layer_ids: ['rule'], duration: 500 },
      { preset: 'fade_out', at: 4000 },
    ] });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const steps = r['steps'] as Array<{ from: number; to: number; layers: string[] }>;
    expect(steps[0]).toMatchObject({ from: 0, to: 800 });
    expect(steps[1]).toMatchObject({ from: 800, to: 1600 });   // 700 + 100 stagger
    expect(steps[2]).toMatchObject({ from: 1600, to: 2100 });
    expect(steps[3].from).toBe(4000);
    expect(r['scene_ms']).toBe(4400);

    const spec = read(p);
    const title = animOf(spec, 'title');
    expect(title?.playback?.duration).toBe(4400);               // blur_in + fade_out folded
    expect(title?.keyframes?.map(k => k.t)).toEqual([0, 800, 4000, 4400]);
    expect(animOf(spec, 'b')?.playback?.delay).toBe(900);
    expect(animOf(spec, 'rule')?.keyframes?.[0].draw).toBe(0);
    // Editor mirror kept in sync.
    expect(Object.keys((spec as DesignSpec & { animations?: object }).animations ?? {})).toHaveLength(4);
  });

  it('a loop takes a fresh layer but refuses to stack on a one-shot', () => {
    const p = flat();
    const ok = sequenceMotion({ design_path: p, steps: [{ preset: 'pulse', layer_ids: ['a'] }] });
    expect(ok.success).toBe(true);
    const bad = sequenceMotion({ design_path: p, steps: [{ preset: 'rise', layer_ids: ['a'] }] });
    expect(bad.success).toBe(false);
    expect(bad.hint).toMatch(/clear/);
  });

  it('rejects an unknown preset or easing up front', () => {
    const p = flat();
    expect(sequenceMotion({ design_path: p, steps: [{ preset: 'teleport' }] }).error).toMatch(/unknown/i);
    expect(sequenceMotion({ design_path: p, steps: [{ preset: 'rise', easing: 'wobbly' }] }).error).toMatch(/easing/);
  });
});

describe('animation(op:track)', () => {
  it('writes a validated raw track with per-frame easing and staggers copies', () => {
    const p = flat();
    const r = setTrack({ design_path: p, layer_ids: ['a', 'b'], stagger_ms: 150,
      keyframes: [{ t: 0, opacity: 0, y: 30, easing: 'ease-out-expo' }, { t: 500, opacity: 1, y: 0, hold: true }, { t: 900, skew_x: 6 }],
      playback: { anchor: 'bottom left' } });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const spec = read(p);
    expect(animOf(spec, 'a')?.playback).toMatchObject({ duration: 900, origin: 'offset', anchor: 'bottom left' });
    expect(animOf(spec, 'b')?.playback?.delay).toBe(150);
    expect(animOf(spec, 'a')?.keyframes?.[1].hold).toBe(true);
  });

  it('rejects bad channels, easings and anchors', () => {
    const p = flat();
    expect(setTrack({ design_path: p, layer_id: 'a', keyframes: [{ t: 0, wobble: 1 }, { t: 1 }] }).error).toMatch(/animatable/);
    expect(setTrack({ design_path: p, layer_id: 'a', keyframes: [{ t: 0, x: 0, easing: 'nah' }, { t: 1 }] }).error).toMatch(/easing/);
    expect(setTrack({ design_path: p, layer_id: 'a', keyframes: [{ t: 0 }, { t: 1 }], playback: { anchor: 'middle' } }).error).toMatch(/anchor/);
    expect(setTrack({ design_path: p, layer_id: 'a', keyframes: [{ t: 0 }] }).error).toMatch(/two/);
  });
});

describe('animation(op:clear) + op:timeline', () => {
  it('clears named layers, then everything, and the timeline reflects it', () => {
    const p = flat();
    const seq = sequenceMotion({ design_path: p, steps: [{ preset: 'rise', layer_ids: ['title', 'a', 'b'], stagger_ms: 100 }, { preset: 'breathe', layer_ids: ['rule'] }] });
    expect(seq.success, JSON.stringify(seq)).toBe(true);
    let tl = inspectTimeline({ design_path: p });
    expect(tl["track_count"]).toBe(4);
    const tracks = tl['tracks'] as Array<{ layer_id: string; kind: string; start_ms: number }>;
    expect(tracks.find(t => t.layer_id === 'rule')?.kind).toBe('loop');
    expect(tracks.find(t => t.layer_id === 'b')?.start_ms).toBe(200);
    expect(String(tl['ascii'])).toContain('Scene');
    expect(String(tl['ascii'])).toContain('∞');

    const one = clearMotion({ design_path: p, layer_ids: ['a'] });
    expect(one['cleared']).toEqual(['a']);
    const all = clearMotion({ design_path: p });
    expect((all['cleared'] as string[]).sort()).toEqual(['b', 'rule', 'title']);
    tl = inspectTimeline({ design_path: p });
    expect(tl['track_count']).toBe(0);
    expect(read(p).animations).toBeUndefined();
  });

  it('scene helpers compute length from delay + duration × cycles', () => {
    const layers = [
      { id: 'x', type: 'rect', animation: { keyframes: [{ t: 0, x: 0 }, { t: 500, x: 1 }], playback: { duration: 500, delay: 1000 } } },
      { id: 'y', type: 'rect', animation: { keyframes: [{ t: 0, scale: 1 }, { t: 700, scale: 1.1 }], playback: { duration: 700, loop: true, direction: 'alternate' } } },
    ] as unknown as Layer[];
    const tracks = sceneTracks(layers);
    expect(sceneLength(tracks)).toBe(1500);
    expect(tracks[1].end_ms).toBe(1400);
    expect(renderSceneASCII(layers, tracks)).toContain('◆');
  });
});

describe('animation(op:frame)', () => {
  it('renders a still at t with resolved poses', () => {
    const p = flat();
    sequenceMotion({ design_path: p, steps: [{ preset: 'rise', layer_ids: ['a'], duration: 1000, distance: 50 }] });
    const r = renderFrame({ design_path: p, t: 0, scale: 0.5 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const poses = r['poses'] as Array<{ id: string; y?: number; opacity?: number }>;
    expect(poses[0].id).toBe('a');
    expect(poses[0].y).toBeCloseTo(130, 3);  // 80 + 50 displaced at t=0
    expect(poses[0].opacity).toBe(0);
    const end = renderFrame({ design_path: p, t: 1000 });
    expect((end['poses'] as Array<{ y?: number }>)[0].y).toBeCloseTo(80, 3);
    expect(end['_attachments']).toHaveLength(1);
  });

  it('refuses when nothing is animated', () => {
    const p = flat();
    expect(renderFrame({ design_path: p, t: 10 }).success).toBe(false);
  });

  it('reports the channels that do not move the box — skew and draw', () => {
    // skew and draw render correctly but land on `transform` and the dash pair,
    // not on x/y. Reporting only the box told a blind caller nothing had changed
    // about a frame that visibly had — the same omission motion_path had.
    // `draw` is a dash trick, so it needs a path whose length can be measured —
    // a `line` layer has no `d` and would silently skip the channel.
    const p = writeDesign('draw.design.yaml', [
      '  - { id: stroke_path, type: path, x: 20, y: 20, width: 200, height: 100, d: "M 20 20 L 220 20 L 220 120", stroke: { color: "#111111", width: 4 } }',
    ]);
    setTrack({
      design_path: p, layer_id: 'stroke_path',
      keyframes: [{ t: 0, draw: 0, skew_x: -18 }, { t: 1000, draw: 1, skew_x: 0 }],
    });
    const r = renderFrame({ design_path: p, t: 500 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const pose = (r['poses'] as Array<Record<string, unknown>>).find(x => x['id'] === 'stroke_path');
    expect(pose).toBeDefined();
    expect(String(pose?.['transform'])).toContain('skew');
    expect(pose?.['stroke_dasharray']).toBeDefined();
    expect(typeof pose?.['stroke_dashoffset']).toBe('number');
  });
});

describe('a step written with layer_id (singular)', () => {
  // op:track takes `layer_id`; op:sequence took only `layer_ids`, and an
  // unrecognised key meant "no ids", which means the WHOLE PAGE. Live: one step
  // aimed at "editorial_1_title" animated all seven layers of the preset and
  // reported success.
  it('targets that layer, not every layer on the page', () => {
    const p = flat();
    const r = sequenceMotion({ design_path: p, steps: [
      { preset: 'rise', layer_id: 'title' },
    ] } as never) as Record<string, unknown>;
    expect(r['success'], JSON.stringify(r)).toBe(true);
    const steps = r['steps'] as Array<{ layers: string[] }>;
    expect(steps[0]?.layers).toEqual(['title']);
  });

  it('still lets a step omit ids on purpose — that means everything', () => {
    const p = flat();
    const r = sequenceMotion({ design_path: p, steps: [
      { preset: 'fade_out' },
    ] } as never) as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect((r['steps'] as Array<{ layers: string[] }>)[0]?.layers.length).toBeGreaterThan(1);
  });
});

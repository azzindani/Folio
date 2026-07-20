import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { applyMotion, motionTargets } from './motion';
import { inspectTimeline } from '../engine';
import { expandPreset, buildTimeline, PRESET_NAMES } from './motion-presets';
import type { Layer } from '../../schema/types';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-motion-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const layer = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'rect', ...extra }) as unknown as Layer;

function writeDesign(name: string, layersYaml: string[]): string {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, [
    '_protocol: "design/v1"',
    'meta: { id: "m1", name: "Motion", type: "poster", created: "", modified: "" }',
    'document: { width: 800, height: 600, unit: "px" }',
    'layers:',
    ...layersYaml,
  ].join('\n'));
  return p;
}

const flat = (): string => writeDesign('flat.design.yaml', [
  '  - { id: a, type: rect, x: 0, y: 0, width: 10, height: 10 }',
  '  - { id: b, type: rect, x: 0, y: 20, width: 10, height: 10 }',
  '  - { id: c, type: rect, x: 0, y: 40, width: 10, height: 10 }',
]);

describe('motionTargets', () => {
  it('treats a locked group as one unit rather than breaking it apart', () => {
    // Every carousel page this engine writes is one locked group. Animating its
    // children individually would tear apart a layout grouped to hold together.
    const layers = [layer('page', {
      type: 'group', locked: true,
      layers: [layer('t1'), layer('t2')],
    })];
    expect(motionTargets(layers).map(l => l.id)).toEqual(['page']);
  });

  it('descends into an unlocked group', () => {
    const layers = [layer('g', { type: 'group', layers: [layer('x'), layer('y')] })];
    expect(motionTargets(layers).map(l => l.id)).toEqual(['x', 'y']);
  });

  it('reaches a child of a locked group when named explicitly', () => {
    const layers = [layer('page', { type: 'group', locked: true, layers: [layer('inner')] })];
    expect(motionTargets(layers, ['inner']).map(l => l.id)).toEqual(['inner']);
  });

  it('honours the caller order, because a stagger is a sequence', () => {
    const layers = [layer('a'), layer('b'), layer('c')];
    expect(motionTargets(layers, ['c', 'a']).map(l => l.id)).toEqual(['c', 'a']);
  });

  it('silently drops ids that do not exist', () => {
    expect(motionTargets([layer('a')], ['a', 'ghost']).map(l => l.id)).toEqual(['a']);
  });
});

describe('applyMotion', () => {
  it('writes keyframes to every layer on the page by default', () => {
    const p = flat();
    const r = applyMotion({ design_path: p, preset: 'rise' });
    expect(r.success).toBe(true);
    expect(r['layers']).toEqual(['a', 'b', 'c']);
    expect((fs.readFileSync(p, 'utf-8').match(/animation:/g) ?? []).length).toBe(3);
  });

  it('produces keyframes that op:timeline can display', () => {
    // The contract that keeps this from being a black box: what a preset writes
    // is indistinguishable from hand-authored keyframes.
    const p = flat();
    applyMotion({ design_path: p, preset: 'rise' });
    const t = inspectTimeline({ design_path: p });
    expect(t['track_count']).toBe(3);
  });

  it('staggers by delay, leaving the keyframes themselves identical', () => {
    const p = flat();
    applyMotion({ design_path: p, preset: 'rise', stagger_ms: 100 });
    const yaml = fs.readFileSync(p, 'utf-8');
    expect(yaml).toContain('delay: 100');
    expect(yaml).toContain('delay: 200');
    // The first layer gets no delay key at all, not delay: 0.
    expect(yaml).not.toContain('delay: 0');
  });

  it('targets only the layers named, in the order named', () => {
    const p = flat();
    const r = applyMotion({ design_path: p, preset: 'fade_in', layer_ids: ['c', 'a'] });
    expect(r['layers']).toEqual(['c', 'a']);
    expect((fs.readFileSync(p, 'utf-8').match(/animation:/g) ?? []).length).toBe(2);
  });

  it('accepts a single id passed as a bare string', () => {
    const r = applyMotion({ design_path: flat(), preset: 'fade_in', layer_ids: 'b' });
    expect(r['layers']).toEqual(['b']);
  });

  it('honours duration and distance overrides', () => {
    const p = flat();
    applyMotion({ design_path: p, preset: 'rise', duration: 1200, distance: 60 });
    const yaml = fs.readFileSync(p, 'utf-8');
    expect(yaml).toContain('duration: 1200');
    expect(yaml).toContain('60');
  });

  it('rejects an unknown preset and lists the real ones', () => {
    const r = applyMotion({ design_path: flat(), preset: 'explode' });
    expect(r.success).toBe(false);
    expect(String(r['hint'])).toContain('rise');
  });

  it('reports a missing design', () => {
    const r = applyMotion({ design_path: path.join(tmpDir, 'nope.design.yaml'), preset: 'rise' });
    expect(r.success).toBe(false);
  });

  it('explains an empty page rather than silently doing nothing', () => {
    const p = writeDesign('empty.design.yaml', ['  []']);
    const r = applyMotion({ design_path: p, preset: 'rise' });
    expect(r.success).toBe(false);
    expect(String(r['hint'])).toContain('add_layers');
  });

  it('points at ids that do not exist on this page', () => {
    const r = applyMotion({ design_path: flat(), preset: 'rise', layer_ids: ['ghost'] });
    expect(r.success).toBe(false);
    expect(String(r['hint'])).toContain('inspect');
  });
});

describe('presets', () => {
  it('every preset expands to at least two keyframes', () => {
    // Fewer than two and generateKeyframeCSS emits nothing — a silent no-op.
    for (const p of PRESET_NAMES) {
      expect(expandPreset(p).keyframes.length, p).toBeGreaterThanOrEqual(2);
    }
  });

  it('scales fractional times to real milliseconds', () => {
    const e = expandPreset('rise', { duration: 800 });
    expect(e.keyframes[0].t).toBe(0);
    expect(e.keyframes[e.keyframes.length - 1].t).toBe(800);
  });

  it('marks entrances as one-shot and the rest as loops', () => {
    expect(expandPreset('rise').playback.loop).toBeUndefined();
    expect(expandPreset('pulse').playback.loop).toBe(true);
  });

  it('never alternates a spin — it would read as a stutter, not rotation', () => {
    expect(buildTimeline('spin').direction).toBe('normal');
    expect(buildTimeline('spin').defaultEasing).toBe('linear');
  });

  it('keeps pulse shallow, the most common way motion goes wrong', () => {
    const scales = buildTimeline('pulse').keyframes.map(k => k.scale ?? 1);
    expect(Math.max(...scales)).toBeLessThanOrEqual(1.1);
  });

  it('emits travel as an offset from zero, not an absolute position', () => {
    // generateKeyframeCSS reads position as a delta from the first frame; the
    // renderer has already placed the layer, so absolutes would move it twice.
    const e = expandPreset('rise', { distance: 30 });
    expect(e.keyframes[0].y).toBe(30);
    expect(e.keyframes[1].y).toBe(0);
  });
});

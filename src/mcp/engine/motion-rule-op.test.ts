import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { sequenceMotion } from './motion-sequence';
import { inspectTimeline } from '../engine';
import { resolveLayers } from '../../renderer/resolve-source';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-rule-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const design = (name: string, extra = ''): string => {
  const p = path.join(tmpDir, name);
  fs.writeFileSync(p, [
    '_protocol: "design/v1"',
    'meta: { id: "m1", name: "Rules", type: "poster", created: "", modified: "" }',
    'document: { width: 400, height: 300, unit: "px" }',
    'layers:',
    '  - { id: a, type: rect, x: 20, y: 80, width: 100, height: 30, fill: "#3366ff" }',
    '  - { id: b, type: rect, x: 20, y: 120, width: 100, height: 30, fill: "#3366ff" }',
    extra,
  ].join('\n'));
  return p;
};
const read = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf-8')) as DesignSpec;
const animOf = (layers: Layer[] | undefined, id: string): AnimationSpec | undefined =>
  (layers ?? []).find(l => l.id === id)?.animation;
const STEPS = [{ preset: 'rise', layer_ids: ['a', 'b'], at: 200, stagger_ms: 100 }, { preset: 'fade_out', layer_ids: ['a'], at: 2000 }];

describe('op:sequence as_rule', () => {
  it('stores each step as a rule, and they compile to the track the keyframe path writes', () => {
    const ruled = design('ruled.design.yaml');
    const r = sequenceMotion({ design_path: ruled, steps: STEPS, as_rule: true });
    expect(r.success).toBe(true);
    const spec = read(ruled);
    expect(animOf(spec.layers, 'a')).toEqual({ rule: [{ preset: 'rise', at: 200 }, { preset: 'fade_out', at: 2000 }] });
    expect(animOf(spec.layers, 'b')).toEqual({ rule: { preset: 'rise', at: 300 } });
    expect((spec as { animations?: unknown }).animations).toBeUndefined();

    const written = design('written.design.yaml');
    sequenceMotion({ design_path: written, steps: STEPS });
    const literal = read(written).layers;
    const compiled = resolveLayers(spec.layers ?? []);
    for (const id of ['a', 'b']) expect(animOf(compiled, id)).toEqual(animOf(literal, id));
  });

  it('re-times by replacing the rule of the same kind, and op:timeline reads the rules', () => {
    const p = design('retime.design.yaml');
    sequenceMotion({ design_path: p, steps: STEPS, as_rule: true });
    const again = sequenceMotion({ design_path: p, steps: [{ preset: 'rise', layer_ids: ['a'], at: 800 }], as_rule: true }) as unknown as { success: boolean; progress: { message: string }[] };
    expect(again.success).toBe(true);
    expect(again.progress.some(x => /Replaced 1 earlier/.test(x.message))).toBe(true);
    expect(animOf(read(p).layers, 'a')).toEqual({ rule: [{ preset: 'rise', at: 800 }, { preset: 'fade_out', at: 2000 }] });
    const tl = inspectTimeline({ design_path: p }) as unknown as { track_count: number; scene_ms: number };
    expect(tl.track_count).toBe(2);
    expect(tl.scene_ms).toBeGreaterThanOrEqual(2000);
  });

  it('refuses to put a rule over a written track', () => {
    const p = design('mixed.design.yaml', '  - { id: c, type: rect, x: 20, y: 160, width: 100, height: 30, fill: "#3366ff", animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400 } } }');
    const r = sequenceMotion({ design_path: p, steps: [{ preset: 'fade_out', layer_ids: ['c'], at: 2000 }], as_rule: true });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/"c" already has a written track/);
  });
});

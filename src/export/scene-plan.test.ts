import { describe, it, expect } from 'vitest';
import { planScenes, sceneAt, countWords, countCopy } from './scene-plan';
import type { DesignSpec, Layer } from '../schema/types';

const rise = (id: string, delay = 0): unknown => ({
  id, type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10,
  animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }], playback: { duration: 600, delay } },
});
const text = (id: string, value: string): unknown => ({ id, type: 'text', z: 2, x: 0, y: 0, width: 100, content: { type: 'plain', value } });
const deck = (pages: unknown[]): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'deck', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 100, height: 100, unit: 'px', dpi: 96 },
  pages,
} as unknown as DesignSpec);

describe('planScenes', () => {
  it('lays scenes end to end: motion plus hold, or exactly auto_advance', () => {
    const plan = planScenes(deck([
      { id: 'a', layers: [rise('r')] },
      { id: 'b', auto_advance: 2500, layers: [rise('s', 400)] },
    ]), { hold_ms: 1000 });
    expect(plan.scenes.map(s => [s.page_id, s.start_ms, s.length_ms, s.motion_ms])).toEqual([['a', 0, 1600, 600], ['b', 1600, 2500, 1000]]);
    expect(plan.total_ms).toBe(4100);
  });

  it('gives the first scene no transition and plays none as a cut', () => {
    const plan = planScenes(deck([
      { id: 'a', transition: { type: 'fade' }, layers: [] },
      { id: 'b', transition: { type: 'none' }, layers: [] },
      { id: 'c', transition: { type: 'wipe-left', duration: 300 }, layers: [] },
    ]));
    expect(plan.scenes.map(s => s.transition)).toEqual([null, null, { type: 'wipe-left', duration_ms: 300 }]);
  });

  it('warns when a scene is too short to read, and when auto_advance cuts its motion off', () => {
    const forty = Array.from({ length: 40 }, () => 'word').join(' ');
    const warnings = planScenes(deck([
      { id: 'dense', layers: [text('t', forty)] },
      { id: 'cut', auto_advance: 300, layers: [rise('r')] },
    ])).warnings.join('\n');
    expect(warnings).toMatch(/"dense" is on screen 1\.5s but carries 40 words \(~10\.0s to read\)/);
    expect(warnings).toMatch(/"cut" ends at 300ms but its motion runs to 600ms/);
  });

  // Found on the promo: a 4 s wiggle on a chip stretched its scene and raised a false "cut off" warning.
  it('lets only motion that ends decide the scene — an endless loop does not stretch it', () => {
    const wiggle = { id: 'chip_wiggle', type: 'group', z: 3, layers: [], animation: { keyframes: [{ t: 0, x: 0 }, { t: 4000, x: 0 }], playback: { duration: 4000, loop: true } } };
    const twice = { id: 'blink', type: 'rect', z: 4, animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 500, opacity: 1 }], playback: { duration: 500, loop: true, iterations: 2 } } };
    const plan = planScenes(deck([
      { id: 'loops', layers: [rise('r'), wiggle] },
      { id: 'counted', layers: [twice] },
      { id: 'short', auto_advance: 900, layers: [rise('q'), wiggle] },
    ]), { hold_ms: 1000 });
    expect(plan.scenes.map(s => [s.page_id, s.motion_ms, s.length_ms])).toEqual([['loops', 600, 1600], ['counted', 1000, 2000], ['short', 600, 900]]);
    expect(plan.warnings.join('\n')).not.toMatch(/cut off/);
  });

  it('counts words across groups', () => {
    const tree = [{ id: 'g', type: 'group', z: 0, layers: [text('a', 'two words'), text('b', 'and three more')] }] as unknown as Layer[];
    expect(countWords(tree)).toBe(5);
  });

  // Found on the promo: YAML lines and tool names "carried 41 words" against 7 words of copy.
  it('times copy, not separators or monospace code and labels — and says what it left out', () => {
    const mono = (id: string, value: string): unknown => ({ ...(text(id, value) as object), style: { font_family: 'IBM Plex Mono', font_size: 24 } });
    const layers = [text('head', 'A design is a file.'), mono('kicker', 'SAT · 8 PM · HALL B'), mono('code', '- type: rect'), text('sep', '— · —')] as unknown as Layer[];
    expect(countCopy(layers)).toEqual({ words: 5, labels: 7 });
    const plan = planScenes(deck([{ id: 'spec', auto_advance: 1000, layers }]));
    expect(plan.scenes[0]).toMatchObject({ words: 5, labels: 7, read_ms: 1250 });
    expect(plan.warnings.join('\n')).toMatch(/carries 5 words \(~1\.3s to read\), plus 7 words of code and labels in a monospace face/);
  });
});

describe('sceneAt', () => {
  const plan = planScenes(deck([
    { id: 'a', layers: [rise('r')] },
    { id: 'b', transition: { type: 'fade', duration: 400 }, layers: [rise('s')] },
  ]), { hold_ms: 1000 });

  it('names the outgoing scene, resting past its own end, while the transition runs', () => {
    expect(sceneAt(plan, 1700)).toMatchObject({
      scene: { page_id: 'b' }, local_ms: 100,
      from: { scene: { page_id: 'a' }, local_ms: 1700, progress: 0.25 },
    });
  });

  it('drops the outgoing scene once the transition is over, and clamps past the end', () => {
    expect(sceneAt(plan, 2100).from).toBeUndefined();
    expect(sceneAt(plan, 99_999)).toMatchObject({ scene: { page_id: 'b' }, local_ms: 1600 });
  });
});

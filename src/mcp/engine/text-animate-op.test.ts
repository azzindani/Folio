import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { animateText } from './text-animate-op';
import type { DesignSpec, Layer } from '../../schema/types';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-textanim-'));
let dPath = '';
let n = 0;
const STYLE = { font_size: 60, font_family: 'Plus Jakarta Sans', color: '#111111' };

// Carousel text lives inside a locked page group — the case op:text must not break.
beforeEach(() => {
  const dir = path.join(root, `case-${n++}`, 'designs');
  fs.mkdirSync(dir, { recursive: true });
  dPath = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({
    meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
    layers: [{ id: 'page', type: 'group', locked: true, x: 0, y: 0, width: 1080, height: 1080, layers: [
      { id: 'title', type: 'text', z: 2, x: 80, y: 100, width: 920, content: { type: 'plain', value: 'Make it move' }, style: STYLE },
      { id: 'body', type: 'text', z: 3, x: 80, y: 400, width: 420, content: { type: 'plain', value: 'one two three four five six seven eight' }, style: STYLE },
    ] }],
  }));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const all = (): Record<string, unknown>[] => {
  const out: Record<string, unknown>[] = [];
  const walk = (ls: Layer[]): void => {
    for (const l of ls) { out.push(l as unknown as Record<string, unknown>); const k = (l as { layers?: Layer[] }).layers; if (Array.isArray(k)) walk(k); }
  };
  walk(((yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec).layers ?? []) as Layer[]);
  return out;
};
const byId = (id: string): Record<string, unknown> | undefined => all().find(l => l['id'] === id);
const delay = (id: string): number => (byId(id)?.['animation'] as { playback?: { delay?: number } } | undefined)?.playback?.delay ?? 0;

describe('animation op:text', () => {
  it('splits a headline in place inside its page group, and staggers the words in the order asked', () => {
    const r = animateText({ design_path: dPath, layer_id: 'title', by: 'word', preset: 'rise', stagger_ms: 80, order: 'reverse' });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(r['created']).toEqual(['title_w1', 'title_w2', 'title_w3']);
    expect(byId('title')).toBeUndefined();
    expect((byId('page') as { layers: Array<{ id: string }> }).layers.map(l => l.id)).toEqual(['title_w1', 'title_w2', 'title_w3', 'body']);
    expect([delay('title_w1'), delay('title_w2'), delay('title_w3')]).toEqual([160, 80, 0]);
  });

  it('puts each unit behind a fixed mask and animates the unit, not the mask', () => {
    const r = animateText({ design_path: dPath, layer_id: 'title', by: 'word', preset: 'rise', mask: true });
    expect(r.success, JSON.stringify(r)).toBe(true);
    const mask = byId('title_mask1') as Record<string, unknown>;
    const word = byId('title_w1') as Record<string, number>;
    expect(mask['clip']).toBe(true);
    expect(word['x']).toBeGreaterThanOrEqual(mask['x'] as number);
    expect(word['x'] + word['width']).toBeLessThanOrEqual((mask['x'] as number) + (mask['width'] as number));
    expect(mask['animation']).toBeUndefined();
    expect(byId('title_w1')?.['animation']).toBeDefined();
  });

  it('animates a wrapped paragraph line by line from raw keyframes', () => {
    const r = animateText({ design_path: dPath, layer_id: 'body', by: 'line', keyframes: [{ t: 0, opacity: 0, x: -40 }, { t: 500, opacity: 1, x: 0 }] });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect(r['units'] as number).toBeGreaterThan(1);
    expect(delay('body_l2')).toBe(140);
  });

  // Benchmark r5: a quote that had to start after its clock could only be timed with raw keyframes + playback.delay.
  it('starts the run where `at` says — ms or a marker — with a preset or with keyframes', () => {
    const r = animateText({ design_path: dPath, layer_id: 'title', by: 'word', preset: 'rise', stagger_ms: 100, at: 1200 });
    expect(r.success, JSON.stringify(r)).toBe(true);
    expect([delay('title_w1'), delay('title_w2'), delay('title_w3')]).toEqual([1200, 1300, 1400]);
    const spec = yaml.load(fs.readFileSync(dPath, 'utf8')) as DesignSpec & { markers?: Record<string, number> };
    fs.writeFileSync(dPath, yaml.dump({ ...spec, markers: { quote: 3000 } }));
    const k = animateText({ design_path: dPath, layer_id: 'body', by: 'line', at: 'quote+500', keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }] });
    expect(k.success, JSON.stringify(k)).toBe(true);
    expect([delay('body_l1'), delay('body_l2')]).toEqual([3500, 3640]);
    expect(animateText({ design_path: dPath, layer_id: 'title_w1', preset: 'rise', at: 'nowhere' }).success).toBe(false);
  });

  it('refuses a bad call before touching the file, and undoes the split when the motion is refused', () => {
    const before = fs.readFileSync(dPath, 'utf8');
    expect(animateText({ design_path: dPath, layer_id: 'title', preset: 'nope' }).success).toBe(false);
    expect(animateText({ design_path: dPath, layer_id: 'title', preset: 'rise', order: 'diagonal' }).success).toBe(false);
    expect(fs.readFileSync(dPath, 'utf8')).toBe(before);
    const r = animateText({ design_path: dPath, layer_id: 'title', keyframes: [{ t: 0, opacity: 0 }] });
    expect(r.success).toBe(false);
    expect(String(r['error'])).toContain('undone');
    expect(fs.readFileSync(dPath, 'utf8')).toBe(before);
  });
});

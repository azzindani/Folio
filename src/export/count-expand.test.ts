import { describe, it, expect } from 'vitest';
import { expandCounts } from './count-expand';
import { buildAnimatedSVG } from './svg-animate';
import { renderToSVGString } from '../mcp/engine/svg-export';
import type { DesignSpec, Layer } from '../schema/types';

const stat = (extra: Record<string, unknown> = {}): Layer => ({
  id: 'stat', type: 'text', z: 1, x: 100, y: 100, width: 400, height: 120,
  content: { type: 'plain', value: '1,250+' }, style: { font_size: 96, color: '#111111' },
  animation: { keyframes: [{ t: 0, count: 0 }, { t: 1000, count: 1 }], playback: { duration: 1000, easing: 'linear' } },
  ...extra,
}) as unknown as Layer;
const spec = (layers: Layer[]): DesignSpec => ({ _protocol: 'design/v1', meta: { id: 'c', name: 'c', type: 'poster', created: '', modified: '' },
  document: { width: 600, height: 400, unit: 'px', dpi: 96 }, layers }) as unknown as DesignSpec;
type Variant = { id: string; content: { value: string }; animation: { keyframes: Array<Record<string, unknown>> } };
const variants = (s: DesignSpec): Variant[] => (s.layers?.[0] as unknown as { layers: Variant[] }).layers;

describe('expandCounts', () => {
  it('turns a counting text into a group of figures that count up, keeping its id', () => {
    const out = expandCounts(spec([stat()]));
    expect(out.layers?.[0]).toMatchObject({ id: 'stat', type: 'group' });
    const figures = variants(out).map(v => v.content.value);
    expect(figures[0]).toBe('0+');
    expect(figures[figures.length - 1]).toBe('1,250+');
    expect(figures.length).toBeGreaterThan(10);
    expect(figures.length).toBeLessThanOrEqual(120);
  });

  it('shows one figure at a time, cutting from each to the next', () => {
    const kids = variants(expandCounts(spec([stat()])));
    expect(kids[1]?.id).toBe('stat__count1');
    expect(kids[0]?.animation.keyframes[0]).toMatchObject({ t: 0, opacity: 1, hold: true });
    expect(kids[1]?.animation.keyframes.map(k => k['opacity'])).toEqual([0, 1, 0]);
  });

  it('keeps the other channels on the group, so a count that rises rises as one', () => {
    const rising = stat({ animation: { keyframes: [{ t: 0, count: 0, y: 30 }, { t: 1000, count: 1, y: 0 }], playback: { duration: 1000, origin: 'offset' } } });
    const group = expandCounts(spec([rising])).layers?.[0] as unknown as { animation?: { keyframes: Array<Record<string, unknown>> } };
    expect(group.animation?.keyframes.map(k => k['y'])).toEqual([30, 0]);
    expect(group.animation?.keyframes.some(k => 'count' in k)).toBe(false);
  });

  it('leaves text that does not count alone', () => {
    const still = { id: 'label', type: 'text', z: 1, content: { type: 'plain', value: 'Revenue' } } as unknown as Layer;
    expect(expandCounts(spec([still])).layers?.[0]).toBe(still);
  });

  it('reaches the animated SVG: every figure is drawn and each has its own stepped track', () => {
    const { svg } = buildAnimatedSVG(spec([stat()]), { renderSVG: s => renderToSVGString(s) });
    expect(svg).toContain('1,250+');
    expect(svg).toContain('@keyframes kf-stat__count1');
    expect(svg).toMatch(/steps\(1, end\)/);
  });
});

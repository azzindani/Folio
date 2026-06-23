import { describe, it, expect } from 'vitest';
import { stripNullLayers, placePositionlessLayers, ensureBackgroundFill } from './engine-finalize-autoplace';
import type { Layer } from '../schema/types';

describe('stripNullLayers', () => {
  it('removes a literal null layer (the suite-030 editor-crash bug)', () => {
    const layers = [{ id: 'a', type: 'rect' }, null, { id: 'b', type: 'text' }] as unknown as Layer[];
    const n = stripNullLayers(layers);
    expect(n).toBe(1);
    expect(layers).toHaveLength(2);
    expect(layers.every(l => l && typeof l === 'object')).toBe(true);
  });
  it('recurses into group children', () => {
    const layers = [{ id: 'g', type: 'group', layers: [{ id: 'x', type: 'text' }, null] }] as unknown as Layer[];
    expect(stripNullLayers(layers)).toBe(1);
    expect((layers[0] as unknown as { layers: unknown[] }).layers).toHaveLength(1);
  });
  it('strips non-object junk too (string / number entries)', () => {
    const layers = ['oops', 5, { id: 'ok', type: 'text' }] as unknown as Layer[];
    expect(stripNullLayers(layers)).toBe(2);
    expect(layers).toHaveLength(1);
  });
});

describe('placePositionlessLayers', () => {
  it('flows positionless page layers into a centered in-canvas column (suite-079)', () => {
    const layers = [
      { id: 'bg', type: 'background' },
      { id: 'icon', type: 'icon', name: 'calendar', size: 80, color: '#FF3D00' },
      { id: 't1', type: 'text', content: { type: 'plain', value: 'Simple Streak Calendar' }, style: { font_size: 64, align: 'center' } },
      { id: 't2', type: 'text', content: { type: 'plain', value: 'Mark each day you succeed and watch your streak grow' }, style: { font_size: 36, align: 'center' } },
    ] as unknown as Layer[];
    const n = placePositionlessLayers(layers, 1080, 1080);
    expect(n).toBe(4);
    // background full-bleed
    const bg = layers[0] as unknown as Record<string, number>;
    expect(bg['x']).toBe(0); expect(bg['width']).toBe(1080); expect(bg['height']).toBe(1080);
    // text gets a real in-canvas x (NOT 0 — the left-overflow bug) and a width so centered text wraps in-canvas
    const t1 = layers[2] as unknown as Record<string, number>;
    expect(t1['x']).toBeGreaterThan(0);
    expect(t1['x'] + t1['width']).toBeLessThanOrEqual(1080);
    // vertical stacking — t2 sits below t1 (no origin pile-up)
    const t2 = layers[3] as unknown as Record<string, number>;
    expect(t2['y']).toBeGreaterThan(t1['y']);
    // icon is horizontally centered
    const icon = layers[1] as unknown as Record<string, number>;
    expect(icon['x']).toBeCloseTo((1080 - 80) / 2, 0);
  });

  it('leaves already-positioned layers untouched, appends positionless below', () => {
    const layers = [
      { id: 'placed', type: 'text', x: 100, y: 100, width: 400, height: 60, content: { type: 'plain', value: 'Header' }, style: { font_size: 40 } },
      { id: 'loose', type: 'text', content: { type: 'plain', value: 'Body copy' }, style: { font_size: 24 } },
    ] as unknown as Layer[];
    placePositionlessLayers(layers, 1080, 1080);
    const placed = layers[0] as unknown as Record<string, number>;
    expect(placed['x']).toBe(100); expect(placed['y']).toBe(100);   // untouched
    const loose = layers[1] as unknown as Record<string, number>;
    expect(loose['y']).toBeGreaterThanOrEqual(160);                  // below the placed header
  });

  it('never flows a data-bound layer (string x/y field-alias or chart type)', () => {
    const layers = [
      { id: 'ch', type: 'interactive_chart', width: 600, height: 360, chart: 'bar', x: 'ticker', y: 'ytd' },
    ] as unknown as Layer[];
    expect(placePositionlessLayers(layers, 1080, 1080)).toBe(0);
    const ch = layers[0] as unknown as Record<string, unknown>;
    expect(ch['x']).toBe('ticker');   // string alias preserved, not overwritten with a number
    expect(ch['y']).toBe('ytd');
  });

  describe('ensureBackgroundFill', () => {
    it('gives a fill-less background a dark fill when text is light (suite-079)', () => {
      const layers = [
        { id: 'bg', type: 'background', x: 0, y: 0, width: 1080, height: 1080 },
        { id: 't', type: 'text', x: 86, y: 400, width: 908, style: { color: '#FFFFFF', font_size: 64 } },
      ] as unknown as Layer[];
      expect(ensureBackgroundFill(layers, 1080, 1080)).toBe(true);
      const bg = layers[0] as unknown as Record<string, Record<string, string>>;
      expect(bg['fill']['color']).toBe('#0A0A0A');   // dark bg for light text → legible
    });
    it('gives a fill-less background a light fill when text is dark', () => {
      const layers = [
        { id: 'bg', type: 'background' },
        { id: 't', type: 'text', style: { color: '#141414' } },
      ] as unknown as Layer[];
      expect(ensureBackgroundFill(layers, 1080, 1080)).toBe(true);
      expect((layers[0] as unknown as Record<string, Record<string, string>>)['fill']['color']).toBe('#FAF5EC');
    });
    it('leaves an already-filled background untouched', () => {
      const layers = [
        { id: 'bg', type: 'background', fill: { type: 'solid', color: '#123456' } },
        { id: 't', type: 'text', style: { color: '#FFFFFF' } },
      ] as unknown as Layer[];
      expect(ensureBackgroundFill(layers, 1080, 1080)).toBe(false);
      expect((layers[0] as unknown as Record<string, Record<string, string>>)['fill']['color']).toBe('#123456');
    });
    it('no-ops when there is no backdrop layer', () => {
      const layers = [{ id: 't', type: 'text', x: 10, y: 10, style: { color: '#FFFFFF' } }] as unknown as Layer[];
      expect(ensureBackgroundFill(layers, 1080, 1080)).toBe(false);
    });
  });

  it('no-ops when every layer already has coordinates', () => {
    const layers = [
      { id: 'a', type: 'text', x: 10, y: 10, width: 100, height: 30 },
      { id: 'b', type: 'rect', x: 0, y: 0, width: 1080, height: 1080 },
    ] as unknown as Layer[];
    expect(placePositionlessLayers(layers, 1080, 1080)).toBe(0);
  });
});

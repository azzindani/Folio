import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderToSVGString } from '../mcp/engine/svg-export';
import type { DesignSpec, Layer } from '../schema/types';

const spec = (layers: unknown[]): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'c', name: 'clip', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 100, height: 40, unit: 'px', dpi: 96 },
  layers: layers as Layer[],
} as unknown as DesignSpec);

/** RGBA of one pixel of the rasterised design, on white. */
const pixel = (s: DesignSpec, x: number, y: number): number[] => {
  const img = new Resvg(renderToSVGString(s), { background: '#FFFFFF' }).render();
  const i = (y * img.width + x) * 4;
  return Array.from(img.pixels.subarray(i, i + 3));
};

const red = { id: 'r', type: 'rect', z: 1, x: 0, y: 0, width: 100, height: 40, fill: '#FF0000' };
const RED = [255, 0, 0];
const WHITE = [255, 255, 255];

describe('clip on a group — the track matte', () => {
  it('hides children outside the group box, not inside it', () => {
    const s = spec([{ id: 'g', type: 'group', z: 1, x: 0, y: 0, width: 50, height: 40, clip: true, layers: [red] }]);
    expect(pixel(s, 25, 20)).toEqual(RED);
    expect(pixel(s, 75, 20)).toEqual(WHITE);
  });

  it('changes nothing without the flag', () => {
    const s = spec([{ id: 'g', type: 'group', z: 1, x: 0, y: 0, width: 50, height: 40, layers: [red] }]);
    expect(pixel(s, 75, 20)).toEqual(RED);
  });
});

describe('clip_rect on any layer — the wipe', () => {
  it('shows only the rectangle, and a zero-width rect shows nothing', () => {
    expect(pixel(spec([{ ...red, clip_rect: { x: 60, y: 0, width: 40, height: 40 } }]), 80, 20)).toEqual(RED);
    expect(pixel(spec([{ ...red, clip_rect: { x: 60, y: 0, width: 40, height: 40 } }]), 30, 20)).toEqual(WHITE);
    expect(pixel(spec([{ ...red, clip_rect: { x: 0, y: 0, width: 0, height: 40 } }]), 50, 20)).toEqual(WHITE);
  });

  it('keeps an existing shape mask by wrapping instead of replacing it', () => {
    const svg = renderToSVGString(spec([{ ...red, clip_path_ref: 'm', clip_rect: { x: 0, y: 0, width: 10, height: 10 } }]));
    expect(svg).toContain('url(#cp-m)');
    expect(svg).toMatch(/<g clip-path="url\(#cliprect-[^"]+\)"/);
  });
});

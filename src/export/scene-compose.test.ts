import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { planScenes } from './scene-plan';
import { composeSceneFrame, backdropColor } from './scene-compose';
import type { DesignSpec, Layer } from '../schema/types';

const RED = [255, 0, 0], BLUE = [0, 0, 255], WHITE = [255, 255, 255];

// Both pages give their ground the SAME id, as carousel pages built from one
// preset do — a transition frame holds both at once.
const ground = (fill: string): unknown => ({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 40, fill });

const deck = (transition: Record<string, unknown>): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'deck', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 100, height: 40, unit: 'px', dpi: 96 },
  pages: [
    { id: 'a', layers: [ground('#FF0000')] },
    { id: 'b', transition: { duration: 400, easing: 'linear', ...transition }, layers: [ground('#0000FF')] },
  ],
} as unknown as DesignSpec);

/** Scene a holds 1000ms; t=1200 is halfway through a 400ms transition into b. */
const frameAt = (transition: Record<string, unknown>, t: number): (x: number, y: number) => number[] => {
  const spec = deck(transition);
  const img = new Resvg(renderToSVGString(composeSceneFrame(spec, planScenes(spec, { hold_ms: 1000 }), t)), { background: '#FFFFFF' }).render();
  return (x, y) => Array.from(img.pixels.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 3));
};

describe('composeSceneFrame', () => {
  it('is just the scene outside a transition', () => {
    expect(frameAt({ type: 'fade' }, 500)(50, 20)).toEqual(RED);
    expect(frameAt({ type: 'fade' }, 1900)(50, 20)).toEqual(BLUE);
  });

  it('wipes: the new scene on the left half, the old one still on the right', () => {
    const px = frameAt({ type: 'wipe-left' }, 1200);
    expect(px(25, 20)).toEqual(BLUE);
    expect(px(75, 20)).toEqual(RED);
  });

  it('fades: an even mix at the midpoint', () => {
    const [r, g, b] = frameAt({ type: 'fade' }, 1200)(50, 20);
    expect(Math.abs(r - 128)).toBeLessThan(4);
    expect(g).toBe(0);
    expect(Math.abs(b - 128)).toBeLessThan(4);
  });

  it('slides: the old scene pushed half out left, the new one half in from the right', () => {
    const px = frameAt({ type: 'slide-left' }, 1200);
    expect(px(25, 20)).toEqual(RED);
    expect(px(75, 20)).toEqual(BLUE);
  });

  it('paints the outgoing ground under a flip, so the squash never shows white', () => {
    // progress 0.25 squashes the old scene to half width around the centre: x 25–75.
    const px = frameAt({ type: 'flip-h' }, 1100);
    expect(px(5, 20)).toEqual(RED);
    expect(px(5, 20)).not.toEqual(WHITE);
  });
});

describe('backdropColor', () => {
  it('finds a full-canvas rect inside a group, and falls back to white', () => {
    const tree = [{ id: 'g', type: 'group', z: 1, layers: [{ id: 'x', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 40, fill: '#123456' }] }] as unknown as Layer[];
    expect(backdropColor(tree, 100, 40)).toBe('#123456');
    expect(backdropColor([], 100, 40)).toBe('#FFFFFF');
  });
});

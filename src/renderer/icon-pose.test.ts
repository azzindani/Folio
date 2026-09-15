import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { renderToSVGString } from '../mcp/engine/svg-export';
import type { DesignSpec } from '../schema/types';

// Found live building a looping GIF: a spinning icon in a sampled frame orbited far
// off its card, a wobbling bell floated above its card, a pulsing timer drifted.
// renderIcon placed the icon with its own transform="translate(x, y)" and the
// frame's canvas-space pose was appended after it, so it ran in icon-local space.
const spec = (layers: object[]): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'i', name: 'i', type: 'poster', created: '', modified: '' },
  document: { width: 400, height: 400, unit: 'px', dpi: 96 }, layers,
} as unknown as DesignSpec);

const bell = (extra: object = {}): object =>
  ({ id: 'bell', type: 'icon', z: 1, x: 180, y: 180, width: 40, height: 40, size: 40, name: 'bell', color: '#000000', ...extra });

/** Where the icon actually inks, or null when nothing lands on the canvas. */
function inkBox(layers: object[]): { x0: number; y0: number; x1: number; y1: number } | null {
  const img = new Resvg(renderToSVGString(spec(layers)), { background: '#FFFFFF' }).render();
  const px = img.pixels; // a native getter that copies the buffer — read it once
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if ((px[(y * img.width + x) * 4] ?? 255) < 128) {
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

const inside = (b: ReturnType<typeof inkBox>, lo: number, hi: number): boolean =>
  b !== null && b.x0 >= lo && b.y0 >= lo && b.x1 <= hi && b.y1 <= hi;

describe('an icon under a transform stays where it was placed', () => {
  it('a sampled frame spinning the icon turns it in place', () => {
    const turned = inkBox([bell({ transform: 'translate(200 200) rotate(90) translate(-200 -200)' })]);
    expect(inside(turned, 176, 224), JSON.stringify({ rest: inkBox([bell()]), turned })).toBe(true);
  });

  it('a sampled frame scaling the icon grows it about its own centre', () => {
    const grown = inkBox([bell({ transform: 'translate(200 200) scale(1.5 1.5) translate(-200 -200)' })]);
    expect(inside(grown, 168, 232), JSON.stringify(grown)).toBe(true);
    expect((grown?.x1 ?? 0) - (grown?.x0 ?? 0)).toBeGreaterThan(40);
  });

  it('a statically rotated icon keeps its place — rotation used to overwrite the placement', () => {
    expect(inside(inkBox([bell({ rotation: 30 })]), 170, 230)).toBe(true);
  });

  it('keeps the placement off the layer root, where a pose or a CSS transform would replace it', () => {
    const svg = renderToSVGString(spec([bell({ transform: 'rotate(10 200 200)' })]));
    const root = svg.match(/<g[^>]*data-layer-id="bell"[^>]*>/)?.[0] ?? '';
    expect(root).toContain('rotate(10 200 200)');
    expect(root).not.toContain('translate(180, 180)');
    expect(svg).toContain('translate(180, 180)');
  });
});

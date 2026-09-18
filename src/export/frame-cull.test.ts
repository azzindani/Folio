import { describe, it, expect } from 'vitest';
import { Resvg } from '@resvg/resvg-js';
import { parseTransform, cullUnseenClips, cullFrame, canvasBoxes, type Matrix } from './frame-cull';
import { renderToSVGString } from '../mcp/engine/svg-export';
import type { DesignSpec, Layer } from '../schema/types';

const rect = (id: string, x: number, y: number, extra: object = {}): object =>
  ({ id, type: 'rect', z: 1, x, y, width: 300, height: 150, fill: '#E4572E', ...extra });
const mask = (id: string, kids: object[], extra: object = {}): object =>
  ({ id, type: 'group', z: 2, clip: true, x: 80, y: 130, width: 300, height: 150, layers: kids, ...extra });
// The camera pose on the frame that aborted the live server: 4.954× on a stat in the corner.
const CAMERA = 'translate(-1261.613 -1504.231) translate(540 540) scale(4.954 4.954) translate(-540 -540)';
const ids = (ls: Layer[]): string[] => ls.flatMap(l => [l.id, ...ids((l as { layers?: Layer[] }).layers ?? [])]);
const apply = (m: Matrix | null, x: number, y: number): number[] | null =>
  m && [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]].map(v => Math.round(v * 1000) / 1000);

describe('parseTransform', () => {
  it('reads the transform lists the flipbook writes, composed in order', () => {
    expect(apply(parseTransform('translate(10 20) translate(540 540) scale(2 2) translate(-540 -540)'), 540, 540)).toEqual([550, 560]);
    expect(apply(parseTransform('rotate(90 100 100)'), 200, 100)).toEqual([100, 200]);
    expect(apply(parseTransform('matrix(1 0 0.5 1 0 0)'), 0, 100)).toEqual([50, 100]);
  });

  it('refuses anything it cannot read exactly', () => {
    expect(parseTransform('translate(10px 2)')).toBeNull();
    expect(parseTransform('perspective(3)')).toBeNull();
  });
});

describe('cullUnseenClips', () => {
  it('drops a mask the camera carried far off the canvas, and keeps the camera', () => {
    const cam = { id: 'cam', type: 'group', z: 1, transform: CAMERA, layers: [mask('m', [rect('w', 80, 130)]), rect('stat', 700, 800)] };
    expect(ids(cullUnseenClips([cam] as unknown as Layer[], 1080, 1080))).toEqual(['cam', 'stat']);
  });

  it('drops a mask whose unit its own transform sent far away, and keeps one just past the edge', () => {
    const far = mask('far', [rect('a', 80, 130, { transform: 'translate(-3000 0)' })]);
    const near = mask('near', [rect('b', 80, 130, { transform: 'translate(-400 0)' })]);
    expect(ids(cullUnseenClips([far, near] as unknown as Layer[], 1080, 1080))).toEqual(['near', 'b']);
  });

  it('drops content wholly off the canvas, keeps what bleeds in, and never drops what it cannot measure', () => {
    const loose = rect('loose', -3000, 100);
    const bleed = rect('bleed', -200, 100);
    const odd = mask('odd', [rect('c', -3000, 130)], { transform: 'perspective(2)' });
    const unread = rect('unread', -3000, 100, { transform: 'perspective(2)' });
    expect(ids(cullUnseenClips([loose, bleed, odd, unread] as unknown as Layer[], 1080, 1080))).toEqual(['bleed', 'odd', 'c', 'unread']);
  });

  it('drops what draws nothing — outside its window, or faded out — unless another layer clips with it', () => {
    const gone = rect('gone', 10, 10, { visible: false });
    const faded = rect('faded', 10, 10, { opacity: 0 });
    const shape = rect('shape', 10, 10, { opacity: 0 });
    const masked = rect('masked', 10, 10, { clip_path_ref: 'shape' });
    const group = { id: 'g', type: 'group', z: 1, layers: [rect('a', 10, 10, { visible: false }), rect('b', 10, 10)] };
    expect(ids(cullUnseenClips([gone, faded, shape, masked, group] as unknown as Layer[], 1080, 1080))).toEqual(['shape', 'masked', 'g', 'b']);
  });

  it('renders the shape that aborted resvg on the live server', () => {
    const spec = {
      _protocol: 'design/v1', meta: { id: 'c', name: 'c', type: 'poster', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      layers: [rect('bg', 0, 0, { width: 1080, height: 1080, fill: '#111111' }),
        { id: 'cam', type: 'group', z: 1, x: 0, y: 0, width: 1080, height: 1080, transform: CAMERA, layers: [mask('m', [rect('w', 80, 130)]), rect('stat', 700, 800)] }],
    } as unknown as DesignSpec;
    const svg = renderToSVGString(cullFrame(spec));
    expect(svg).not.toContain('data-layer-id="m"');
    // Unculled, this SVG aborts the whole process — so a crashed worker here IS the regression.
    expect(new Resvg(svg, { background: '#FFFFFF' }).render().width).toBe(1080);
  });
});

describe('canvasBoxes', () => {
  // Found live: rows scrolling inside a sheet's clip window measured at their full length.
  it('measures a clipped child only where the clip lets it draw, and drops what the clip hides', () => {
    const rows = [rect('in', 80, 200), rect('half', 80, 250), rect('gone', 80, 600)];
    const boxes = canvasBoxes([mask('m', rows) as Layer]);
    expect(boxes.map(b => [b.layer.id, Math.round(b.box.y), Math.round(b.box.height)])).toEqual([['in', 200, 80], ['half', 250, 30]]);
  });
});

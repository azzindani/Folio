import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { buildAnimatedSVG } from './svg-animate';
import { specAt, animationDuration, oneShotDuration } from './gif-frames';
import { cullFrame } from './frame-cull';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { pathEase, pathProgress } from '../animation/path-ease';

// One continuous page: a title that leaves at 2 s, a precomp that starts at 3 s
// at double speed, and a wrapper that follows the title 150 ms behind.
const rise = { keyframes: [{ t: 0, y: 40, opacity: 0 }, { t: 600, y: 0, opacity: 1 }], playback: { duration: 600, origin: 'offset', easing: 'linear' } };
const spec = (): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'c', name: 'c', type: 'poster', created: '', modified: '' },
  document: { width: 800, height: 600, unit: 'px', dpi: 96 },
  layers: [
    { id: 'title', type: 'rect', z: 1, x: 40, y: 40, width: 200, height: 60, fill: '#111111', out: 2000, animation: rise },
    { id: 'pc', type: 'group', z: 2, clock: { start: 3000, speed: 2 }, layers: [
      { id: 'card', type: 'rect', z: 1, x: 300, y: 200, width: 200, height: 100, fill: '#E4572E', in: 0, animation: rise },
    ] },
    { id: 'tail_link', type: 'group', z: 3, link: { to: 'title', lag: 150, channels: ['y'] }, layers: [
      { id: 'tail', type: 'rect', z: 1, x: 40, y: 120, width: 80, height: 20, fill: '#2266FF' },
    ] },
  ] as unknown as Layer[],
} as DesignSpec);

describe('continuous composition — both players read one resolved tree', () => {
  it('the SVG plays the precomp on the scene clock, the link as a track, and the window as visibility steps', () => {
    const { svg } = buildAnimatedSVG(spec(), { renderSVG: s => renderToSVGString(s) });
    expect(svg).toMatch(/\[data-layer-id="card"\] \{[^}]*animation: kf-card 300ms linear 3000ms 1 normal both, life-card 3001ms/);
    expect(svg).toContain('animation: kf-tail_link 600ms linear 150ms 1 normal both;');
    expect(svg).toMatch(/\[data-layer-id="title"\] \{[^}]*animation: kf-title 600ms linear 0ms 1 normal both, life-title 2000ms/);
    expect(svg).toContain('@keyframes life-title');
  });

  it('the flipbook hides a layer outside its window and samples the precomp on the scene clock', () => {
    const at = (t: number): Record<string, Record<string, unknown>> => {
      const out: Record<string, Record<string, unknown>> = {};
      const walk = (ls: Layer[]): void => ls.forEach(l => { out[l.id] = l as unknown as Record<string, unknown>; walk((l as { layers?: Layer[] }).layers ?? []); });
      walk(specAt(spec(), 0, t).layers ?? []);
      return out;
    };
    expect(at(1000)['title']?.['visible']).toBeUndefined();
    expect(at(2000)['title']?.['visible']).toBe(false);
    expect(at(2999)['card']?.['visible']).toBe(false);          // precomp's child: in 0 local = 3000 scene
    expect(at(3150)['card']?.['opacity']).toBeCloseTo(0.5, 5);  // halfway through 300 ms of double speed
    expect(at(450)['tail_link']?.['transform']).toBe('translate(0 20)');
  });

  it('counts windows and precomp time in the scene length, and culls the hidden layer from the raster frame', () => {
    expect(animationDuration(spec().layers ?? [])).toBe(3300);
    expect(oneShotDuration(spec().layers ?? [])).toBe(3300);
    const svg = renderToSVGString(cullFrame(specAt(spec(), 0, 2500)));
    expect(svg).not.toContain('data-layer-id="title"');
    expect(svg).not.toContain('data-layer-id="card"');
    expect(svg).toContain('data-layer-id="tail"');
  });
});

describe('a motion path — the same travel in the SVG and the flipbook', () => {
  const dot = (mp: object): object => ({ id: 'dot', type: 'rect', z: 1, x: 100, y: 100, width: 20, height: 20, fill: '#111111', motion_path: { path: 'M 0 0 L 400 0', ...mp } });
  const withLayers = (layers: object[]): DesignSpec => ({ ...spec(), layers: layers as unknown as Layer[] });
  const dx = (s: DesignSpec, t: number): number | undefined => {
    const find = (ls: Layer[]): Layer | undefined => ls.map(l => (l.id === 'dot' ? l : find((l as { layers?: Layer[] }).layers ?? []))).find(Boolean);
    return ((find(specAt(s, 0, t).layers ?? []) as unknown as Record<string, unknown>)['_frame_pose'] as { dx: number } | undefined)?.dx;
  };

  it('sets off after its delay, travels on its own easing, and holds the end', () => {
    const s = withLayers([dot({ duration: 1000, delay: 500, easing: 'ease-out-cubic' })]);
    const svg = renderToSVGString(s);
    expect(svg).toContain('begin="0.500s"');
    expect(svg).toContain('fill="freeze"');
    expect(svg).toContain(`keyPoints="${pathEase('ease-out-cubic').points.join(';')}"`);
    expect(dx(s, 400)).toBeUndefined();
    expect(dx(s, 1000)).toBeCloseTo(400 * pathProgress('ease-out-cubic', 0.5), 3);
    expect(dx(s, 1000)).toBeGreaterThan(300);                 // eased out: well past halfway at half time
    expect(dx(s, 5000)).toBeCloseTo(400, 3);
    expect(animationDuration(s.layers ?? [])).toBe(1500);
  });

  it('travels on a precomp clock: sets off at its start, covers the path at its speed', () => {
    const s = withLayers([{ id: 'pc', type: 'group', z: 1, clock: { start: 1000, speed: 2 }, layers: [dot({ duration: 1000, delay: 200, easing: 'linear' })] }]);
    expect(dx(s, 1050)).toBeUndefined();                      // 1000 + 200 / 2
    expect(dx(s, 1350)).toBeCloseTo(200, 3);                  // halfway through 500 ms
    expect(animationDuration(s.layers ?? [])).toBe(1600);
    const { svg } = buildAnimatedSVG(s, { renderSVG: x => renderToSVGString(x) });
    expect(svg).toContain('begin="1.100s"');
    expect(svg).toContain('dur="0.500s"');
  });

  it('repeats a one-shot path every pass of a looping precomp: waits, travels, rests — in both players', () => {
    const s = withLayers([{ id: 'pc', type: 'group', z: 1, clock: { start: 1000, loop: 2000 }, layers: [dot({ duration: 1000, delay: 500, easing: 'linear' })] }]);
    expect(dx(s, 900)).toBeUndefined();                       // before the precomp starts
    expect(dx(s, 1200)).toBeCloseTo(0, 3);                    // waiting its 500 ms in the first pass
    expect(dx(s, 2000)).toBeCloseTo(200, 3);                  // halfway
    expect(dx(s, 2800)).toBeCloseTo(400, 3);                  // resting at the end
    expect(dx(s, 3200)).toBeCloseTo(0, 3);                    // the next pass waits again
    expect(dx(s, 4000)).toBeCloseTo(200, 3);                  // and travels again
    expect(animationDuration(s.layers ?? [])).toBe(3000);
    const { svg } = buildAnimatedSVG(s, { renderSVG: x => renderToSVGString(x) });
    expect(svg).toContain('begin="1.000s"');
    expect(svg).toContain('dur="2.000s"');
    expect(svg).toContain('repeatCount="indefinite"');
    const attr = (n: string): number[] => (svg.match(new RegExp(`${n}="([^"]+)"`))?.[1] ?? '').split(';').map(Number);
    const times = attr('keyTimes'), points = attr('keyPoints');
    const at = (k: number): number | undefined => points[times.indexOf(k)];
    expect([at(0), at(0.25), at(0.5), at(0.75), at(1)]).toEqual([0, 0, 0.5, 1, 1]);
  });
});


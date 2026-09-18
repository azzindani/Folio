import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import { buildAnimatedSVG } from './svg-animate';
import { specAt, animationDuration, oneShotDuration } from './gif-frames';
import { cullFrame } from './frame-cull';
import { renderToSVGString } from '../mcp/engine/svg-export';

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

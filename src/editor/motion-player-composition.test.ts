import { describe, it, expect } from 'vitest';
import { StateManager } from './state';
import { MotionPlayer } from './motion-player';
import { layersAt } from '../export/gif-frames';
import { trackHTML, markerStripHTML, markersOf } from '../ui/panels/timeline-track-view';
import { toSceneTime, fromSceneTime } from '../animation/clock-time';
import type { DesignSpec, Layer } from '../schema/types';

// The per-page player plays a continuous composition the way the export does:
// windows hide layers, precomp clocks and links retime tracks, and every
// channel the flipbook draws (scale included) reaches the canvas.

const rect = (id: string, extra: object = {}): Layer =>
  ({ id, type: 'rect', x: 100, y: 100, width: 200, height: 100, z: 1, fill: '#000', ...extra } as unknown as Layer);
const slide = (delay = 0): object =>
  ({ keyframes: [{ t: 0, x: 0 }, { t: 400, x: 300 }], playback: { duration: 400, delay, origin: 'offset', easing: 'linear' } });

const SCENE: Layer[] = [
  rect('title', { in: 500, out: 2000 }),
  { id: 'pre', type: 'group', z: 1, x: 0, y: 0, width: 1920, height: 1080, clock: { start: 1000, speed: 2 },
    layers: [rect('dot', { animation: slide(200) })] } as unknown as Layer,
  rect('lead', { animation: slide() }),
  { id: 'shadow_link', type: 'group', z: 0, link: { to: 'lead', lag: 100 }, layers: [rect('shadow')] } as unknown as Layer,
  rect('zoom', { animation: { keyframes: [{ t: 0, scale: 1 }, { t: 400, scale: 2 }], playback: { duration: 400, origin: 'offset' } } }),
];

function loaded(layers: Layer[] = SCENE, extra: Partial<DesignSpec> = {}): { state: StateManager; player: MotionPlayer } {
  const state = new StateManager();
  state.set('design', { _protocol: 'design/v1', document: { width: 1920, height: 1080, unit: 'px', dpi: 96 }, layers, ...extra } as unknown as DesignSpec);
  return { state, player: new MotionPlayer(state) };
}

const field = (state: StateManager, id: string, f: string): unknown =>
  (state.findLayer(id) as unknown as Record<string, unknown> | undefined)?.[f];

describe('the per-page player on a continuous composition', () => {
  it('hides a layer outside its in/out window and puts it back on stop', async () => {
    const { state, player } = loaded();
    await player.ready();
    player.seek(100);
    expect(field(state, 'title', 'visible')).toBe(false);
    player.seek(1000);
    expect(field(state, 'title', 'visible')).toBeUndefined();
    player.seek(2500);
    expect(field(state, 'title', 'visible')).toBe(false);
    player.stop();
    expect(state.findLayer('title')).not.toHaveProperty('visible');
  });

  it('poses exactly the frame the export samples — precomp clock, link and scale included', async () => {
    const { state, player } = loaded();
    await player.ready();
    for (const t of [0, 1150, 1300, 250, 500]) {
      player.seek(t);
      const frame = layersAt(SCENE, t);
      const want = (id: string): unknown => {
        const find = (ls: Layer[]): Layer | undefined => ls.map(l => (l.id === id ? l : find(((l as unknown as { layers?: Layer[] }).layers) ?? []))).find(Boolean);
        return (find(frame) as unknown as Record<string, unknown> | undefined)?.['transform'];
      };
      for (const id of ['dot', 'lead', 'shadow_link', 'zoom']) expect(field(state, id, 'transform'), `${id} at ${t}`).toBe(want(id));
    }
    expect(String(field(state, 'zoom', 'transform'))).toMatch(/scale|matrix/);
  });

  it('runs as long as the export clip: out points and precomp clocks count', async () => {
    const { player } = loaded();
    await player.ready();
    expect(player.duration).toBe(2000);
  });

  it('draws each keyframe where it plays on the scene clock', async () => {
    const { player } = loaded();
    await player.ready();
    const rows = player.rows();
    // local 200 + 0 and 200 + 400, through {start 1000, speed 2}
    expect(rows?.get('dot')?.keys).toEqual([1100, 1300]);
    expect(rows?.get('shadow_link')?.ghosts).toEqual([100, 500]);
    expect(rows?.get('title')?.window).toEqual({ in: 500, out: 2000 });
  });

  it('forgets a pose when a new design replaces the old one, instead of writing it back', async () => {
    const { state, player } = loaded();
    await player.ready();
    player.seek(100);
    player.forget();
    state.set('design', { _protocol: 'design/v1', document: { width: 100, height: 100, unit: 'px', dpi: 96 }, layers: [rect('title')] } as unknown as DesignSpec);
    player.stop();
    expect(state.findLayer('title')).not.toHaveProperty('visible');
  });

  it('puts a pose back on the page it was made on after the page changes', async () => {
    const { state, player } = loaded([], { pages: [{ id: 'p1', layers: SCENE }, { id: 'p2', layers: [rect('other')] }] } as Partial<DesignSpec>);
    await player.ready();
    player.seek(100);
    expect(field(state, 'title', 'visible')).toBe(false);
    state.set('currentPageIndex', 1);
    const p1 = state.get().design?.pages?.[0]?.layers ?? [];
    expect(p1.find(l => l.id === 'title')).not.toHaveProperty('visible');
  });
});

describe('the timeline rows', () => {
  it('draws a window band, a follower\'s ghost keys and the shot strip', async () => {
    const { state, player } = loaded(SCENE, { markers: { hook: 0, reveal: 1000 } } as Partial<DesignSpec>);
    await player.ready();
    const rows = player.rows();
    const title = trackHTML(SCENE[0] as Layer, rows?.get('title'), 2000, 0);
    expect(title).toContain('tl-window');
    expect(title).toContain('left:25%');
    const follower = trackHTML(SCENE[3] as Layer, rows?.get('shadow_link'), 2000, 0);
    expect(follower.match(/tl-ghost/g)?.length).toBe(2);
    expect(follower).toContain('↳ lead');
    const strip = markerStripHTML(markersOf(state.get().design, 0), 2000);
    expect(strip).toContain('data-ms="1000"');
    expect(strip).toContain('left:50%');
  });

  it('turns a ruler click back into the keyframe time to write', () => {
    const clocks = [{ start: 1000, speed: 2 }, { start: 500 }];
    expect(fromSceneTime(toSceneTime(640, clocks), clocks)).toBeCloseTo(640);
  });
});

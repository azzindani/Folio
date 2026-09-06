import { describe, it, expect } from 'vitest';
import { StateManager } from './state';
import { MotionPlayer } from './motion-player';
import { surfaceTrails, trailsSVG } from './motion-trails';
import type { Layer, DesignSpec } from '../schema/types';

/**
 * The trail has to be measured from the design as AUTHORED.
 *
 * Turning Trails on while the scene was playing drew nothing at all — which is
 * precisely when you want it. The first attempt at this problem froze the
 * repaint while the player posed the design, and a freeze holds a trail that
 * already exists; it cannot produce one. Reading the authored layers instead
 * fixes both halves: the path is stable during playback AND it can be drawn
 * mid-playback, because the values it measures never moved.
 */

const design = (): DesignSpec => ({
  _protocol: 'design/v1',
  document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
  layers: [
    {
      id: 'card', type: 'rect', x: 100, y: 100, width: 200, height: 200, z: 0,
      animation: {
        keyframes: [{ t: 0, x: 0, opacity: 0 }, { t: 600, x: 400, opacity: 1 }],
        playback: { duration: 600 },
      },
    },
  ],
} as unknown as DesignSpec);

function loaded(): { state: StateManager; player: MotionPlayer } {
  const state = new StateManager();
  state.set('design', design());
  return { state, player: new MotionPlayer(state) };
}

const pathOf = (layers: Layer[]): string =>
  trailsSVG(surfaceTrails(layers, 600, 5), 1080, 1080);

describe('a trail drawn while the scene plays', () => {
  it('is identical to the one drawn at rest', () => {
    const { state, player } = loaded();
    const atRest = pathOf(player.authoredLayers());

    player.seek(300); // mid-scene: the layer has been moved by the pose
    const posed = state.getCurrentLayers() as Layer[];
    expect(pathOf(posed), 'reading the posed layers gives a DIFFERENT path — it crawls')
      .not.toBe(atRest);
    expect(pathOf(player.authoredLayers()), 'the trail moved with the playhead').toBe(atRest);
  });

  it('is drawn at all — the freeze produced nothing mid-playback', () => {
    const { player } = loaded();
    player.seek(300);
    const svg = pathOf(player.authoredLayers());
    expect(svg).toContain('<polyline');
  });

  it('stays put across the whole scene, not just one moment', () => {
    const { player } = loaded();
    const atRest = pathOf(player.authoredLayers());
    for (const t of [0, 150, 300, 450, 600]) {
      player.seek(t);
      expect(pathOf(player.authoredLayers()), `drifted at ${t}ms`).toBe(atRest);
    }
  });

  it('hands back the layers untouched when nothing is posed', () => {
    const { state, player } = loaded();
    expect(player.authoredLayers()).toEqual(state.getCurrentLayers());
  });

  it('un-poses layers nested in a group, the shape every MCP design has', () => {
    const state = new StateManager();
    state.set('design', {
      _protocol: 'design/v1',
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      layers: [{
        id: 'g', type: 'group', x: 0, y: 0, width: 1080, height: 1080, z: 0,
        layers: (design().layers ?? []),
      }],
    } as unknown as DesignSpec);
    const player = new MotionPlayer(state);
    const atRest = pathOf(player.authoredLayers());
    expect(atRest).toContain('<polyline');
    player.seek(300);
    expect(pathOf(player.authoredLayers())).toBe(atRest);
  });
});

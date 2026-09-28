import { describe, it, expect } from 'vitest';
import { StateManager } from './state';
import { MotionPlayer } from './motion-player';
import type { DesignSpec, Layer } from '../schema/types';

// Found live (opus promo, 2026-09-28): the user paused Play at ~40 s and pressed Export MP4. Export
// saves first, the save serialised the live state, and the frame on screen became the design — the
// camera parked a row down, three stations at opacity 0, titles 24px low. Every export after it
// rendered a blank world.

const cam = (): Layer => ({ id: '__camera', type: 'group', z: 1, x: 0, y: 0, width: 5760, height: 3240,
  layers: [{ id: 'title', type: 'rect', z: 1, x: 100, y: 100, width: 200, height: 100, fill: '#000',
    animation: { keyframes: [{ t: 0, opacity: 0, y: 24 }, { t: 400, opacity: 1, y: 0 }], playback: { duration: 400, origin: 'offset' } } }],
  animation: { keyframes: [{ t: 0, x: 0, y: 0 }, { t: 1000, x: -1920, y: -1080 }], playback: { duration: 1000, origin: 'offset' } } } as unknown as Layer);

const design = (extra: Partial<DesignSpec>): DesignSpec =>
  ({ _protocol: 'design/v1', document: { width: 1920, height: 1080, unit: 'px', dpi: 96 }, ...extra } as unknown as DesignSpec);

describe('a save while a frame is on the canvas', () => {
  it('writes the design as authored, never the pose', async () => {
    const state = new StateManager();
    const authored = design({ layers: [cam()] });
    state.set('design', authored);
    const player = new MotionPlayer(state);
    await player.ready();
    player.seek(700);
    const live = state.get().design as DesignSpec;
    expect(JSON.stringify(live)).not.toBe(JSON.stringify(authored));
    expect(player.authoredDesign(live)).toEqual(authored);
    player.stop();
    expect(player.authoredDesign(state.get().design as DesignSpec)).toEqual(authored);
  });

  it('undoes the pose on the page it was posed on, even after the view moved on', async () => {
    const state = new StateManager();
    const other = { id: 'p2', layers: [{ id: 'still', type: 'rect', z: 1, x: 0, y: 0, width: 10, height: 10, fill: '#111' }] };
    const authored = design({ pages: [{ id: 'p1', layers: [cam()] }, other] } as unknown as Partial<DesignSpec>);
    state.set('design', authored);
    const player = new MotionPlayer(state);
    await player.ready();
    player.seek(300);
    expect(player.authoredDesign(state.get().design as DesignSpec)).toEqual(authored);
  });
});

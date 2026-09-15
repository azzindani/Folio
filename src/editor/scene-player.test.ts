import { describe, it, expect } from 'vitest';
import { ScenePlayer, playsAsScenes, type SceneClock } from './scene-player';
import { planScenes } from '../export/scene-plan';
import { composeSceneFrame } from '../export/scene-compose';
import type { StateManager } from './state';
import type { DesignSpec } from '../schema/types';

// Found by the user after a 7-scene promo video: the editor could only play one
// page at a time, and never showed a transition at all.

const page = (id: string, fill: string, extra: object = {}): object => ({
  id, ...extra,
  layers: [
    { id: `${id}_bg`, type: 'rect', z: 0, x: 0, y: 0, width: 400, height: 300, fill },
    { id: `${id}_box`, type: 'rect', z: 1, x: 50, y: 50, width: 80, height: 80, fill: '#000000',
      animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 600, opacity: 1 }], playback: { duration: 600 } } },
  ],
});

const deck = (): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'carousel', created: '', modified: '' },
  document: { width: 400, height: 300, unit: 'px', dpi: 96 },
  pages: [page('a', '#FF0000', { auto_advance: 1000 }), page('b', '#0000FF', { auto_advance: 1200, transition: { type: 'fade', duration: 400 } })],
} as unknown as DesignSpec);

/** Editor state reduced to what the player may touch: reading, and hearing about edits. */
function fakeState(design: DesignSpec): { state: StateManager; edit(d: DesignSpec): void } {
  let current = design;
  const listeners: Array<() => void> = [];
  const state = { get: () => ({ design: current }), subscribe: (fn: () => void) => { listeners.push(fn); return () => undefined; } };
  return { state: state as unknown as StateManager, edit(d) { current = d; listeners.forEach(fn => fn()); } };
}

/** A clock the test advances by hand. */
function manualClock(): SceneClock & { advance(ms: number): void } {
  let now = 0;
  let queued: Array<(n: number) => void> = [];
  return {
    now: () => now,
    frame: cb => { queued.push(cb); return queued.length; },
    cancel: () => { queued = []; },
    advance(ms) { now += ms; const run = queued; queued = []; run.forEach(cb => cb(now)); },
  };
}

describe('ScenePlayer — the whole piece in one play', () => {
  it('plays a design as scenes only once it has two pages', () => {
    expect(playsAsScenes(deck())).toBe(true);
    expect(playsAsScenes({ ...deck(), pages: deck().pages?.slice(0, 1) } as DesignSpec)).toBe(false);
    expect(playsAsScenes(null)).toBe(false);
  });

  it('shows at every moment exactly the frame the export renders — transitions included', () => {
    const design = deck();
    const player = new ScenePlayer(fakeState(design).state, manualClock());
    expect(player.total).toBe(2200);
    for (const t of [0, 500, 1000, 1200, 1399, 2200]) {
      expect(player.frameAt(t)).toEqual(composeSceneFrame(design, planScenes(design), t));
    }
    const mid = JSON.stringify(player.frameAt(1200));
    expect(mid).toContain('__scene_from');
    expect(mid).toContain('__scene_to');
    expect(player.sceneIndexAt(1200)).toBe(1);
  });

  it('runs on its clock, stops at the end, and restarts from the top', () => {
    const clock = manualClock();
    const player = new ScenePlayer(fakeState(deck()).state, clock);
    const seen: number[] = [];
    player.subscribe(s => seen.push(s.time));
    player.play();
    clock.advance(700);
    expect(player.time).toBe(700);
    clock.advance(5000);
    expect(player.playing).toBe(false);
    expect(player.time).toBe(2200);
    player.play();
    expect(player.time).toBe(0);
    expect(seen).toContain(700);
  });

  it('jumps to a scene at the first frame of its incoming transition', () => {
    const player = new ScenePlayer(fakeState(deck()).state, manualClock());
    player.seekScene(1);
    expect(player.time).toBe(1000);
    expect(JSON.stringify(player.frameAt())).toContain('__scene_from');
  });

  it('never writes the design, and re-plans after an edit', () => {
    const design = deck();
    const before = JSON.stringify(design);
    const s = fakeState(design);
    const player = new ScenePlayer(s.state, manualClock());
    player.seek(1300);
    player.frameAt();
    expect(JSON.stringify(design)).toBe(before);
    const longer = deck();
    (longer.pages ?? [])[1].auto_advance = 3000;
    s.edit(longer);
    expect(player.total).toBe(4000);
  });
});

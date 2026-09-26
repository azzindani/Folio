import { describe, it, expect } from 'vitest';
import { StateManager } from './state';
import { MotionPlayer, type PlayerSnapshot } from './motion-player';
import type { DesignSpec, Layer } from '../schema/types';

describe('script components on the transport', () => {
  it('the player keeps time for a piece moved only by a script component', async () => {
    const state = new StateManager();
    state.set('design', { _protocol: 'design/v1', meta: { id: 'd', name: 'D', type: 'poster', created: '', modified: '' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
      layers: [{ id: 'walker', type: 'script', z: 1, x: 0, y: 0, width: 400, height: 300, duration: 8000, loop: true, js: 'folio.frame(t => {});' } as unknown as Layer] } as DesignSpec);
    const player = new MotionPlayer(state);
    expect(await player.ready()).toBe(true);
    expect(player.hasMotion()).toBe(true);
    expect(player.duration).toBe(8000);
    const seen: PlayerSnapshot[] = [];
    player.subscribe(s => seen.push(s));
    player.seek(1200);
    expect(seen.at(-1)?.time).toBe(1200);
  });
});

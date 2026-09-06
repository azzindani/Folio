import { describe, it, expect, vi } from 'vitest';
import { StateManager } from './state';
import { MotionPlayer } from './motion-player';

// One panel's bug blanked the artwork.
//
// The toolbar subscribed to state to hide its play button, and asked a
// MotionPlayer that had captured an undefined state — so the callback threw,
// the notify loop stopped there, and every listener registered after it (the
// canvas among them) never heard the change. The page loaded its chrome and
// showed no design, which reads as "the editor is down".
//
// Two faults, one symptom: the player was built too early, and a throwing
// subscriber could take the others with it.

describe('a broken subscriber does not silence the rest', () => {
  it('still notifies listeners registered after one that throws', () => {
    const state = new StateManager();
    const after = vi.fn();
    state.subscribe(() => { throw new Error('a panel exploded'); });
    state.subscribe(after);

    expect(() => state.set('zoom', 1.5)).not.toThrow();
    expect(after, 'the canvas never heard the change').toHaveBeenCalledTimes(1);
  });

  it('keeps working on the next change, not just the first', () => {
    const state = new StateManager();
    const after = vi.fn();
    state.subscribe(() => { throw new Error('still broken'); });
    state.subscribe(after);
    state.set('zoom', 1.5);
    state.set('zoom', 2);
    expect(after).toHaveBeenCalledTimes(2);
  });
});

describe('the player is built with a real state', () => {
  it('answers hasMotion() instead of throwing — the call the toolbar makes', () => {
    const state = new StateManager();
    const player = new MotionPlayer(state);
    expect(() => player.hasMotion()).not.toThrow();
    expect(player.hasMotion()).toBe(false);
  });

  it('is the exact shape the field initializer produced, and it throws', () => {
    // Documents WHY app.ts assigns the player in the constructor rather than
    // as a class field: a base-class field initializer runs before the
    // subclass has built `state`.
    const orphan = new MotionPlayer(undefined as unknown as StateManager);
    expect(() => orphan.hasMotion()).toThrow();
  });
});

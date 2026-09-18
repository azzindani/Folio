import { describe, it, expect } from 'vitest';
import type { Layer } from '../../schema/types';
import { compileStates } from './motion-states';
import { valuesAt } from '../../export/gif-frames';

const card = { id: 'card', type: 'rect', z: 1, x: 100, y: 100, width: 200, height: 100, fill: '#111111' } as unknown as Layer;

describe('compileStates — a layer that moves A → B and stays', () => {
  it('places the scaled box where x/y say, holds there, and moves on at the next change', () => {
    const c = compileStates(card, [
      { at: 1000, state: { x: 40, y: 20, scale: 0.5 }, duration: 500 },
      { at: 3000, state: { dx: 0, dy: 0, scale: 1 }, duration: 400 },
    ], 5000);
    const a = c.animation;
    // Scaled 0.5 about its centre, the box's top-left sits at 150,125 — so x moves by -110, y by -105.
    expect(valuesAt(a, 1500)).toMatchObject({ x: -110, y: -105, scale: 0.5 });
    expect(valuesAt(a, 2900)).toMatchObject({ x: -110, y: -105, scale: 0.5 });
    expect(valuesAt(a, 3400)).toMatchObject({ x: 0, y: 0, scale: 1 });
    expect(a.playback?.duration).toBe(5000);
    expect(c.in).toBeUndefined();
    expect(c.landings.map(l => [l.at, l.to])).toEqual([[1000, 1500], [3000, 3400]]);
  });

  it('starts hidden before a preset entrance, lands the preset on the state, and leaves an in point', () => {
    const c = compileStates(card, [{ at: 2000, state: { enter: 'rise', x: 0, y: 0 } }], 6000);
    expect(c.in).toBe(2000);
    expect(valuesAt(c.animation, 1000)['opacity']).toBe(0);
    const end = valuesAt(c.animation, 5000);
    expect(end['opacity']).toBe(1);
    expect([end['x'], end['y']]).toEqual([-100, -100]);
  });

  it('ends with an out point after an exit or a hide, and comes back when mentioned again', () => {
    const gone = compileStates(card, [{ at: 1000, state: { exit: 'fade_out' } }], 4000);
    expect(gone.out).toBeGreaterThan(1000);
    expect(valuesAt(gone.animation, 3500)['opacity']).toBe(0);
    const back = compileStates(card, [{ at: 1000, state: { hidden: true }, duration: 300 }, { at: 2000, state: { dy: 40 }, duration: 300 }], 4000);
    expect(back.out).toBeUndefined();
    expect(valuesAt(back.animation, 1500)['opacity']).toBe(0);
    expect(valuesAt(back.animation, 3000)).toMatchObject({ opacity: 1, y: 40 });
  });

  it('waits for an unfinished move instead of overlapping it, and says so', () => {
    const c = compileStates(card, [{ at: 0, state: { dx: 50 }, duration: 1000 }, { at: 500, state: { dx: 0 }, duration: 200 }], 2000);
    expect(c.notes[0]).toContain('waits until then');
    expect(c.landings[1]?.at).toBe(1000);
  });

  it('is hidden from frame 0 when the first shot hides it', () => {
    const c = compileStates(card, [{ at: 0, state: { hidden: true } }, { at: 1500, state: { enter: 'pop' } }], 3000);
    expect(valuesAt(c.animation, 0)['opacity']).toBe(0);
    expect(c.in).toBe(1500);
  });
});

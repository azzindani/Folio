import { describe, it, expect, vi, afterEach } from 'vitest';
import { CanvasSound } from './canvas-sound';
import type { StateManager } from './state';
import type { MotionPlayer, PlayerSnapshot } from './motion-player';
import type { SceneAudio } from './scene-audio';
import type { DesignSpec } from '../schema/types';

const poster = (extra: object = {}): DesignSpec => ({
  meta: { id: 'p', name: 'p', type: 'poster' }, document: { width: 1920, height: 1080 },
  audio: [{ id: 'bed', src: 'lib/audio/bed.mp3' }, { id: 'pop', src: 'lib/audio/pop.mp3', start_time: 2000 }],
  layers: [], ...extra,
} as unknown as DesignSpec);

/** A canvas player that emits what the test says, and a mixer that records what it was told. */
function setup(design: DesignSpec = poster()): { emit: (time: number, playing: boolean) => void; audio: Record<'start' | 'stop' | 'plan' | 'preload', ReturnType<typeof vi.fn>> } {
  let listener: ((s: PlayerSnapshot) => void) | null = null;
  const player = { time: 0, duration: 10000, subscribe: (fn: (s: PlayerSnapshot) => void) => { listener = fn; return () => undefined; } };
  const state = { get: () => ({ design }) } as unknown as StateManager;
  const audio = { start: vi.fn(), stop: vi.fn(), plan: vi.fn((_d: DesignSpec, timeline: unknown) => ({ timeline })), preload: vi.fn() };
  new CanvasSound(state, player as unknown as MotionPlayer, audio as unknown as SceneAudio);
  return { emit: (time, playing) => { player.time = time; listener?.({ time, duration: 10000, playing, hasMotion: true }); }, audio };
}

let now = 0;
afterEach(() => vi.restoreAllMocks());
const at = (ms: number): void => { now = ms; };

describe('CanvasSound — a one-page piece sounds on the canvas', () => {
  it('decodes the files as the design arrives, starts on play from the playhead, stops on pause', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { emit, audio } = setup();
    expect(audio.preload).toHaveBeenCalledWith(['lib/audio/bed.mp3', 'lib/audio/pop.mp3']);
    at(0); emit(1500, true);
    expect(audio.start).toHaveBeenCalledTimes(1);
    expect(audio.start.mock.calls[0]?.[1]).toBe(1500);
    // The export's timeline for a poster: the page is the whole piece.
    expect(audio.plan.mock.calls[0]?.[1]).toEqual({ total_ms: 10000, scenes: [] });
    at(16); emit(1516, true);
    at(500); emit(2000, true);
    expect(audio.start).toHaveBeenCalledTimes(1);   // frames in step with the sound change nothing
    emit(2000, false);
    expect(audio.stop).toHaveBeenCalled();
  });

  it('starts again from where the clock landed when it loops back to 0 or is scrubbed while playing', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { emit, audio } = setup();
    at(0); emit(9900, true);
    at(120); emit(20, true);                          // the loop wrapped
    at(140); emit(6000, true);                        // a scrub
    expect(audio.start.mock.calls.map(c => c[1])).toEqual([9900, 20, 6000]);
  });

  it('leaves a deck silent here — its sound spans every scene, and the stage plays it', () => {
    const page = (id: string): object => ({ id, layers: [] });
    const { emit, audio } = setup(poster({ pages: [page('a'), page('b')] }));
    emit(0, true);
    expect(audio.start).not.toHaveBeenCalled();
  });
});

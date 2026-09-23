import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { CanvasVideo } from './canvas-video';
import type { StateManager } from './state';
import type { MotionPlayer, PlayerSnapshot } from './motion-player';
import type { DesignSpec } from '../schema/types';

// jsdom has no media playback: give <video> a clock, a paused flag and play/pause.
beforeAll(() => {
  const P = HTMLMediaElement.prototype as unknown as Record<string, unknown>;
  Object.defineProperty(P, 'paused', { configurable: true, get(this: { _p?: boolean }) { return this._p !== false; } });
  Object.defineProperty(P, 'currentTime', { configurable: true, get(this: { _t?: number }) { return this._t ?? 0; }, set(this: { _t?: number }, v: number) { this._t = v; } });
  Object.defineProperty(P, 'play', { configurable: true, value(this: { _p?: boolean }) { this._p = false; return Promise.resolve(); } });
  Object.defineProperty(P, 'pause', { configurable: true, value(this: { _p?: boolean }) { this._p = true; } });
});

const design = (video: object, inMs = 1000): DesignSpec => ({
  meta: { name: 'v', type: 'poster' }, document: { width: 640, height: 360 },
  layers: [{ id: 'clip', type: 'video', src: 'assets/video/a.mp4', x: 0, y: 0, width: 640, height: 360, z: 1, in: inMs, video }],
} as unknown as DesignSpec);

function rig(d: DesignSpec): { cv: CanvasVideo; container: HTMLElement; emit: (s: Partial<PlayerSnapshot>) => void; render: () => HTMLVideoElement } {
  let listener: (s: PlayerSnapshot) => void = () => undefined;
  const state = { get: () => ({ design: d, currentPageIndex: 0 }) } as unknown as StateManager;
  const player = { time: 0, duration: 10_000, playing: false, subscribe: (fn: (s: PlayerSnapshot) => void) => { listener = fn; return () => undefined; } } as unknown as MotionPlayer;
  const container = document.createElement('div');
  const render = (): HTMLVideoElement => {
    const v = document.createElement('video');
    v.setAttribute('data-video-layer', 'clip');
    v.setAttribute('src', '/__project_files/p/assets/video/a.mp4');
    container.replaceChildren(v);
    return v;
  };
  render();
  const cv = new CanvasVideo(state, player, container);
  return { cv, container, render, emit: s => listener({ time: 0, duration: 10_000, playing: false, hasMotion: true, ...s }) };
}

describe('CanvasVideo', () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it('keeps one element per layer across re-renders', () => {
    const r = rig(design({ offset_ms: 0 }));
    const first = r.container.querySelector('video');
    r.render();
    r.cv.adopt();
    expect(r.container.querySelector('video')).toBe(first);
  });

  it('rests on the playhead\'s frame while paused — the moment the export draws', () => {
    const r = rig(design({ offset_ms: 500 }));
    r.emit({ time: 1500 });
    const v = r.container.querySelector('video') as HTMLVideoElement;
    expect(v.paused).toBe(true);
    expect(v.currentTime).toBeCloseTo(1.0, 3);
  });

  it('plays inside its used part at its speed, and rests before its in point', () => {
    const r = rig(design({ offset_ms: 0, duration_ms: 4000, speed: 2 }));
    const v = r.container.querySelector('video') as HTMLVideoElement;
    r.emit({ time: 500, playing: true });
    expect(v.paused).toBe(true);                       // before in (1000)
    r.emit({ time: 1500, playing: true });
    expect(v.paused).toBe(false);
    expect(v.playbackRate).toBe(2);
    expect(v.currentTime).toBeCloseTo(1.0, 3);
    r.emit({ time: 3500, playing: true });             // (3500-1000)×2 = 5000 > 4000 used → held
    expect(v.paused).toBe(true);
    expect(v.currentTime).toBeCloseTo(3.999, 3);
  });

  it('re-seeks a playing clip that strays from the clock', () => {
    const r = rig(design({ offset_ms: 0 }, 0));
    const v = r.container.querySelector('video') as HTMLVideoElement;
    r.emit({ time: 1000, playing: true });
    v.currentTime = 5;                                 // drifted
    r.emit({ time: 1100, playing: true });
    expect(v.currentTime).toBeCloseTo(1.1, 3);
  });
});

describe('a page whose only motion is footage plays', () => {
  it('counts a video layer as playing in time — the toolbar shows Play', async () => {
    const { playsInTime } = await import('../ui/panels/timeline-model');
    expect(playsInTime({ id: 'c', type: 'video', src: 'a.mp4', z: 1 } as never)).toBe(true);
    expect(playsInTime({ id: 'r', type: 'rect', z: 1 } as never)).toBe(false);
  });
});

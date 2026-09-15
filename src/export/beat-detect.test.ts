// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { detectBeats } from './beat-detect';

const SR = 11025;

/** Seeded noise, so every run hears the same signal. */
function noise(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 - 0.5; };
}

/** A click track: a 12 ms decaying 1 kHz burst on every beat, over quiet noise. Every 4th click is louder. */
function clicks(bpm: number, offsetMs: number, seconds: number): { signal: Float32Array; beats: number[] } {
  const signal = new Float32Array(Math.round(SR * seconds));
  const rnd = noise(7);
  for (let i = 0; i < signal.length; i++) signal[i] = rnd() * 0.02;
  const beats: number[] = [];
  for (let n = 0, t = offsetMs; t < seconds * 1000 - 50; n++, t = offsetMs + (n * 60_000) / bpm) {
    beats.push(t);
    const start = Math.round((t / 1000) * SR), amp = n % 4 === 0 ? 0.9 : 0.45;
    for (let i = 0; i < SR * 0.012 && start + i < signal.length; i++) signal[start + i] += amp * Math.sin((2 * Math.PI * 1000 * i) / SR) * Math.exp(-i / (SR * 0.004));
  }
  return { signal, beats };
}

const nearest = (ms: number, truth: number[]): number => Math.min(...truth.map(b => Math.abs(b - ms)));

describe('detectBeats', () => {
  it('finds 120 BPM and puts each beat on a click', () => {
    const { signal, beats } = clicks(120, 0, 20);
    const map = detectBeats(signal, SR);
    expect(map.bpm).toBeGreaterThan(118);
    expect(map.bpm).toBeLessThan(122);
    expect(map.confidence).toBeGreaterThan(0.3);
    const inner = map.beats_ms.filter(ms => ms > 1000 && ms < 19_000);
    expect(inner.length).toBeGreaterThan(30);
    expect(Math.max(...inner.map(ms => nearest(ms, beats)))).toBeLessThan(40);
  });

  it('keeps a slow tempo slow instead of doubling it, and follows an offset grid', () => {
    const { signal, beats } = clicks(90, 200, 20);
    const map = detectBeats(signal, SR);
    expect(map.bpm).toBeGreaterThan(88);
    expect(map.bpm).toBeLessThan(92);
    const inner = map.beats_ms.filter(ms => ms > 1000 && ms < 19_000);
    expect(Math.max(...inner.map(ms => nearest(ms, beats)))).toBeLessThan(40);
  });

  // Found on a live test track: the beat was tracked on the quiet off-beat tick, 250 ms late.
  it('taps on the kick, not on a quieter broadband tick between kicks', () => {
    const seconds = 16;
    const signal = new Float32Array(SR * seconds);
    const kicks: number[] = [];
    for (let i = 0; i < signal.length; i++) {
      const t = i / SR;
      const sinceKick = t % 0.5, sinceTick = (t + 0.25) % 0.5;
      signal[i] = 0.7 * Math.sin(2 * Math.PI * 80 * t) * Math.exp(-10 * sinceKick) + 0.15 * Math.sin(2 * Math.PI * 440 * t) * Math.exp(-30 * sinceTick);
    }
    for (let ms = 0; ms < seconds * 1000; ms += 500) kicks.push(ms);
    const map = detectBeats(signal, SR);
    expect(map.bpm).toBeGreaterThan(118);
    expect(map.bpm).toBeLessThan(122);
    const inner = map.beats_ms.filter(ms => ms > 1000 && ms < 15_000);
    expect(Math.max(...inner.map(ms => nearest(ms, kicks)))).toBeLessThan(60);
  });

  it('lists the accents among the sharpest onsets', () => {
    const { signal, beats } = clicks(120, 0, 12);
    const accents = beats.filter((_, i) => i % 4 === 0 && i > 0);
    const map = detectBeats(signal, SR);
    for (const a of accents.slice(0, 4)) expect(nearest(a, map.onsets_ms)).toBeLessThan(40);
  });

  it('reports no pulse in noise, and nothing at all in a sliver of sound', () => {
    const rnd = noise(3);
    const hiss = Float32Array.from({ length: SR * 10 }, () => rnd() * 0.5);
    expect(detectBeats(hiss, SR).confidence).toBeLessThan(0.25);
    expect(detectBeats(new Float32Array(2000), SR)).toMatchObject({ bpm: 0, beats_ms: [], confidence: 0 });
  });
});

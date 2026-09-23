import { describe, it, expect } from 'vitest';
import type { DesignSpec } from '../../schema/types';
import { laneClips, laneBeats, peaks, monoAt, analyse, soundLane, type SoundAnalysis } from './timeline-sound';

/** Mono float samples with a 10 ms click every beat. */
function clicks(bpm: number, seconds: number, rate: number): Float32Array {
  const n = Math.round(rate * seconds), out = new Float32Array(n), every = Math.round((rate * 60) / bpm);
  for (let i = 0; i < n; i++) { const k = i % every; out[i] = k < rate * 0.01 ? Math.sin((2 * Math.PI * 1000 * k) / rate) * Math.exp(-k / (rate * 0.003)) * 0.6 : 0; }
  return out;
}

const deck = (): DesignSpec => ({
  meta: { id: 'd', name: 'd', type: 'carousel' }, document: { width: 100, height: 100 },
  audio: [{ id: 'bed', src: 'assets/audio/bed.wav', start_time: 0 }],
  pages: [{ id: 'a', auto_advance: 2000, layers: [] }, { id: 'b', auto_advance: 3000, layers: [] }],
} as unknown as DesignSpec);

describe('the timeline sound row', () => {
  it('places the soundtrack under a page on the page\'s own clock, and its beats on the ruler', () => {
    const [clip] = laneClips(deck(), 1, 3000, { 'assets/audio/bed.wav': 10_000 });
    expect(clip?.src).toBe('assets/audio/bed.wav');
    expect(clip?.page_start).toBe(2000);
    const a = { samples: new Float32Array(0), duration_ms: 10_000, bpm: 120, beats_ms: [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500] } as SoundAnalysis;
    expect(clip ? laneBeats(clip, a, 3000) : []).toEqual([0, 500, 1000, 1500, 2000, 2500]);
  });

  it('draws the loudest swing per column, and mixes channels down', () => {
    const a = { samples: Float32Array.from([0, 0.5, -0.9, 0.1]), duration_ms: 0, bpm: 0, beats_ms: [] } as SoundAnalysis;
    expect(peaks(a, 0, (4 / 11025) * 1000, 2).map(v => Number(v.toFixed(2)))).toEqual([0.5, 0.9]);
    expect(Array.from(monoAt([Float32Array.from([1, 1, 1, 1]), Float32Array.from([0, 0, 0, 0])], 11025))).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('measures a file once, with the detector op:beats uses', async () => {
    let loads = 0;
    const deps = {
      load: async (): Promise<ArrayBuffer> => { loads++; return new ArrayBuffer(8); },
      decode: async () => ({ sampleRate: 22_050, channels: [clicks(100, 12, 22_050)] }),
    };
    const a = await analyse('click-100.wav', deps);
    await analyse('click-100.wav', deps);
    expect(loads).toBe(1);
    expect(a?.bpm).toBeGreaterThan(98);
    expect(a?.bpm).toBeLessThan(102);
    expect(a?.beats_ms.length).toBeGreaterThan(15);
    expect(await analyse('broken.wav', { load: () => Promise.reject(new Error('404')), decode: deps.decode })).toBeNull();
  });

  it('draws the page\'s sound row: measuring first, then a waveform with the beats as ticks, every fourth stronger', () => {
    const known = new Map<string, SoundAnalysis | null>();
    const first = soundLane(deck(), 0, 2000, known, 120);
    expect(first.unmeasured).toEqual(['assets/audio/bed.wav']);
    expect(first.beats).toEqual([]);
    expect(first.html).toContain('measuring');
    known.set('assets/audio/bed.wav', { samples: clicks(120, 10, 11025), duration_ms: 10_000, bpm: 120, beats_ms: Array.from({ length: 20 }, (_, i) => i * 500) });
    const lane = soundLane(deck(), 0, 2000, known, 120);
    expect(lane.unmeasured).toEqual([]);
    expect(lane.beats).toEqual([0, 500, 1000, 1500, 2000]);
    expect(lane.html).toContain('<svg class="tl-wave"');
    expect(lane.html).toContain('120 bpm');
    const ticks = [...lane.html.matchAll(/class="tl-beat"[^>]*opacity:([\d.]+)/g)].map(m => Number(m[1]));
    expect(ticks).toEqual([0.55, 0.22, 0.22, 0.22, 0.55]);
    known.set('assets/audio/bed.wav', null);
    expect(soundLane(deck(), 0, 2000, known, 120).html).toContain('could not be read');
    expect(soundLane({ ...deck(), audio: [] } as DesignSpec, 0, 2000, known, 120).html).toBe('');
  });
});

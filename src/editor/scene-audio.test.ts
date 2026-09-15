import { describe, it, expect, vi } from 'vitest';
import type { DesignSpec } from '../schema/types';
import { SceneAudio, type SoundOutput } from './scene-audio';

/** A fake audio clock: records every source start and every gain automation step. */
function fakeOutput(): { out: SoundOutput & { currentTime: number }; sources: Array<{ started?: number[]; stopped: boolean; loop: boolean }>; gains: Array<[string, number, number]> } {
  const sources: Array<{ started?: number[]; stopped: boolean; loop: boolean }> = [];
  const gains: Array<[string, number, number]> = [];
  const out = {
    currentTime: 10,
    destination: {} as AudioNode,
    createGain: () => ({
      gain: {
        setValueAtTime: (v: number, at: number) => { gains.push(['set', Number(v.toFixed(3)), Number(at.toFixed(3))]); },
        linearRampToValueAtTime: (v: number, at: number) => { gains.push(['ramp', Number(v.toFixed(3)), Number(at.toFixed(3))]); },
      },
      connect: () => undefined, disconnect: () => undefined,
    }) as unknown as GainNode,
    createBufferSource: () => {
      const s = { started: undefined as number[] | undefined, stopped: false, loop: false, buffer: null as unknown,
        connect: () => undefined, disconnect: () => undefined,
        start(when: number, offset: number, dur: number) { s.started = [when, offset, dur].map(n => Number(n.toFixed(3))); },
        stop() { s.stopped = true; } };
      sources.push(s);
      return s as unknown as AudioBufferSourceNode;
    },
    decodeAudioData: async (data: ArrayBuffer) => ({ duration: new DataView(data).getFloat64(0) }) as unknown as AudioBuffer,
    resume: async () => undefined,
  };
  return { out, sources, gains };
}

/** Files by src, as their length in seconds; any other src fails to load. */
const files = (lengths: Record<string, number>) => async (src: string): Promise<ArrayBuffer> => {
  const secs = lengths[src];
  if (secs === undefined) throw new Error('404');
  const buf = new ArrayBuffer(8);
  new DataView(buf).setFloat64(0, secs);
  return buf;
};

const flush = (): Promise<void> => new Promise(res => { setTimeout(res, 0); });
const design = (audio: unknown[]): DesignSpec => ({ pages: [], audio } as unknown as DesignSpec);
const timeline = { total_ms: 10_000, scenes: [] };

describe('SceneAudio — Play all sound', () => {
  it('starts a track at its place on the audio clock, and seeks into the file mid-piece', async () => {
    const { out, sources } = fakeOutput();
    const audio = new SceneAudio({ context: () => out, load: files({ 'bed.mp3': 30 }) });
    audio.preload(['bed.mp3']);
    await flush();
    const plan = audio.plan(design([{ id: 'm', src: 'bed.mp3', start_time: 1000 }]), timeline);
    audio.start(plan, 0);
    audio.start(plan, 3000);
    expect(sources.map(s => s.started)).toEqual([[11, 0, 9], [10, 2, 7]]);
    expect(sources[0]?.stopped).toBe(true);
  });

  it('fades on the audio clock along the plan\'s gains', async () => {
    const { out, gains } = fakeOutput();
    const audio = new SceneAudio({ context: () => out, load: files({ 'bed.mp3': 30 }) });
    audio.preload(['bed.mp3']);
    await flush();
    audio.start(audio.plan(design([{ id: 'm', src: 'bed.mp3', volume: 0.5, fade_in: 1000, fade_out: 2000, duration: 6000 }]), timeline), 0);
    expect(gains).toEqual([['set', 0, 10], ['ramp', 0.5, 11], ['set', 0.5, 14], ['ramp', 0, 16]]);
  });

  it('starts a file that decodes after play late, at the position the piece has reached', async () => {
    const { out, sources } = fakeOutput();
    const audio = new SceneAudio({ context: () => out, load: files({ 'bed.mp3': 30 }) });
    const plan = audio.plan(design([{ id: 'm', src: 'bed.mp3', duration: 8000 }]), timeline);
    audio.start(plan, 0);
    out.currentTime = 10.5;
    await flush();
    expect(sources.map(s => s.started)).toEqual([[10.5, 0.5, 7.5]]);
  });

  it('never sounds a late decode over a newer stop, and a muted stage starts nothing', async () => {
    const { out, sources } = fakeOutput();
    const audio = new SceneAudio({ context: () => out, load: files({ 'bed.mp3': 30 }) });
    const plan = audio.plan(design([{ id: 'm', src: 'bed.mp3', duration: 8000 }]), timeline);
    audio.start(plan, 0);
    audio.stop();
    await flush();
    expect(sources).toHaveLength(0);
    audio.muted = true;
    audio.start(audio.plan(design([{ id: 'm', src: 'bed.mp3' }]), timeline), 0);
    expect(sources).toHaveLength(0);
  });

  it('knows each file\'s length once decoded, and names what failed', async () => {
    const { out } = fakeOutput();
    const onChange = vi.fn();
    const audio = new SceneAudio({ context: () => out, load: files({ 'bed.mp3': 12.5 }), onChange });
    audio.preload(['bed.mp3', 'gone.mp3']);
    await flush();
    expect(audio.durations()).toEqual({ 'bed.mp3': 12_500 });
    expect(audio.failed()).toEqual(['gone.mp3']);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

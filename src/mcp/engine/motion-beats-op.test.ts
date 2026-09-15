// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import type { SoundClip } from '../../export/audio-plan';
import { beatsOnPiece, snapLengths, renderBeatsASCII } from './motion-beats-op';
import { dispatchAnimation } from '../dispatch';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

const clip = (over: Partial<SoundClip>): SoundClip => ({
  id: 'm', src: 'a', start_ms: 0, offset_ms: 0, length_ms: 10_000, volume: 1, fade_in_ms: 0, fade_out_ms: 0, loop: false, cut: false, ...over,
});

/** A mono 16-bit WAV with a 10 ms 1 kHz click every beat. */
function clickWav(bpm: number, seconds: number, rate = 22_050): Buffer {
  const n = rate * seconds;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  const every = Math.round((rate * 60) / bpm);
  for (let i = 0; i < n; i++) {
    const k = i % every;
    const v = k < rate * 0.01 ? Math.sin((2 * Math.PI * 1000 * k) / rate) * Math.exp(-k / (rate * 0.003)) * 20_000 : 0;
    b.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return b;
}

describe('the beat grid on the piece', () => {
  it('places a file\'s beats where the clip sounds them, through every loop', () => {
    expect(beatsOnPiece(clip({ start_ms: 1000, length_ms: 3000 }), [0, 500, 1000, 5000], 6000)).toEqual([1000, 1500, 2000]);
    expect(beatsOnPiece(clip({ offset_ms: 500, length_ms: 2500, loop: true }), [0, 1000], 2000)).toEqual([500, 1500, 2500]);
  });

  it('ends each scene on its nearest beat, counting the scenes before it as changed', () => {
    const beats = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
    expect(snapLengths([{ page_id: 'a', start_ms: 0, length_ms: 1400 }, { page_id: 'b', start_ms: 1400, length_ms: 1100 }], beats)).toEqual([
      { page_id: 'a', length_ms: 1400, on_beat_ms: 1500, moved_ms: 100 },
      { page_id: 'b', length_ms: 1100, on_beat_ms: 1000, moved_ms: -100 },
    ]);
    expect(renderBeatsASCII(4000, beats, [1500])).toContain('▼');
  });

  // Live, on the GPT-6 Astra promo: the nearest beat cut a stats scene under its reading time.
  it('takes a later beat rather than cut a scene under its reading time or its motion', () => {
    const beats = [0, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000];
    expect(snapLengths([
      { page_id: 'a', start_ms: 0, length_ms: 1200, read_ms: 1150 },
      { page_id: 'b', start_ms: 1200, length_ms: 1100, motion_ms: 1080, read_ms: 0 },
    ], beats)).toEqual([
      { page_id: 'a', length_ms: 1200, on_beat_ms: 1500, moved_ms: 300, longer_for: 'reading' },
      { page_id: 'b', length_ms: 1100, on_beat_ms: 1500, moved_ms: 400, longer_for: 'motion' },
    ]);
  });
});

describe.skipIf(!hasFfmpeg)('animation(op:beats)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-beats-'));
  const design = path.join(root, 'designs/deck.design.yaml');
  beforeAll(() => {
    fs.mkdirSync(path.join(root, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(root, 'assets/audio'), { recursive: true });
    fs.writeFileSync(path.join(root, 'assets/audio/click.wav'), clickWav(100, 16));
    const page = (id: string, ms: number): Record<string, unknown> => ({ id, auto_advance: ms, layers: [{ id: `${id}-bg`, type: 'rect', z: 0, x: 0, y: 0, width: 64, height: 64, fill: '#FFFFFF' }] });
    fs.writeFileSync(design, yaml.dump({
      meta: { id: 'deck', name: 'Deck', type: 'carousel' }, document: { width: 64, height: 64 },
      pages: [page('s1', 2300), page('s2', 2350)], audio: [{ id: 'click', src: 'assets/audio/click.wav' }],
    }));
  });
  afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });

  it('measures the tempo and offers each scene a length that ends on a beat', async () => {
    const r = await dispatchAnimation({ op: 'beats', design_path: design });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true, audio_id: 'click', pulse: 'steady' });
    expect(Number(r['bpm'])).toBeGreaterThan(98);
    expect(Number(r['bpm'])).toBeLessThan(102);
    const beats = r['beats_ms'] as number[];
    const spacing = beats.slice(1).map((b, i) => b - (beats[i] ?? 0)).sort((a, b) => a - b);
    expect(spacing[Math.floor(spacing.length / 2)]).toBeGreaterThan(570);
    expect(spacing[Math.floor(spacing.length / 2)]).toBeLessThan(630);
    const [first, last] = r['scenes_on_beat'] as Array<{ page_id: string; on_beat_ms: number }>;
    expect(first?.page_id).toBe('s1');
    expect(Math.abs((first?.on_beat_ms ?? 0) - 2400)).toBeLessThan(15);
    // s2 now ends at 4750: its nearest beat (4800) lies past the piece's current end, where the music still plays.
    expect(Math.abs((last?.on_beat_ms ?? 0) - 2400)).toBeLessThan(15);
    expect(r['next_action']).toMatchObject({ tool: 'animation', params: { op: 'scene', page_id: 's1' } });
  }, 60_000);

  it('says there is nothing to measure in a piece without sound', async () => {
    const silent = path.join(root, 'designs/silent.design.yaml');
    fs.writeFileSync(silent, yaml.dump({ meta: { id: 's', name: 'S', type: 'carousel' }, document: { width: 64, height: 64 }, pages: [{ id: 'p1', layers: [] }, { id: 'p2', layers: [] }] }));
    expect(await dispatchAnimation({ op: 'beats', design_path: silent })).toMatchObject({ success: false, error: 'This piece has no sound to measure.' });
  }, 60_000);
});

// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import type { DesignSpec } from '../../schema/types';
import { readYAML } from './utils';
import { audioMotion } from './motion-audio-op';
import { setScene } from './motion-scene-op';
import { dispatchAnimation } from '../dispatch';

const hasProbe = spawnSync('ffprobe', ['-version']).error === undefined;

/** A mono 16-bit PCM WAV of a 440 Hz tone. */
function toneWav(ms: number, rate = 8000): Buffer {
  const n = Math.round((rate * ms) / 1000);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  return b;
}

type Reply = { success: boolean; error?: string; total_ms?: number; notes?: string[]; ascii?: string; soundtrack?: Array<Record<string, unknown>> };
const call = (a: Record<string, unknown>): Reply => audioMotion(a as unknown as Parameters<typeof audioMotion>[0]) as unknown as Reply;

describe('animation(op:audio)', () => {
  let proj = '';
  let design = '';
  const spec = (): DesignSpec => readYAML<DesignSpec>(design);

  beforeEach(() => {
    proj = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-sound-'));
    fs.mkdirSync(path.join(proj, 'designs'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'assets/audio'), { recursive: true });
    fs.writeFileSync(path.join(proj, 'assets/audio/theme.wav'), toneWav(6000));
    fs.writeFileSync(path.join(proj, 'assets/audio/whoosh.wav'), toneWav(400));
    design = path.join(proj, 'designs/piece.design.yaml');
    fs.writeFileSync(design, JSON.stringify({
      meta: { id: 'piece', name: 'Piece', type: 'carousel', created: '2026-09-15', modified: '2026-09-15' },
      document: { width: 1080, height: 1080, unit: 'px', dpi: 72 },
      pages: [{ id: 's1', layers: [], auto_advance: 3000 }, { id: 's2', layers: [], auto_advance: 4000 }],
    }));
  });
  afterEach(() => { fs.rmSync(proj, { recursive: true, force: true }); });

  it('adds music under the piece and answers with the soundtrack as it will mix', () => {
    const r = call({ design_path: design, src: 'assets/audio/theme.wav', volume: 0.7, fade_out: 800 });
    expect(r.success).toBe(true);
    expect(spec().audio).toEqual([{ id: 'theme', src: 'assets/audio/theme.wav', volume: 0.7, fade_out: 800 }]);
    expect(r.total_ms).toBe(7000);
    expect(r.soundtrack?.[0]).toMatchObject({ id: 'theme', from_ms: 0, volume: 0.7, fade_out: 800 });
    expect(r.ascii).toContain('♪ theme');
    if (hasProbe) {
      expect(r.soundtrack?.[0]).toMatchObject({ to_ms: 6000, file_ms: 6000 });
      expect(r.notes?.join(' ')).toMatch(/runs out at 6\.0s/);
    }
  });

  // Live, on the GPT-6 Astra promo: scenes grew past a bed cut to the old length, and no scene reply said so.
  it('op:scene says when a new length leaves the music short', () => {
    expect(call({ design_path: design, src: 'assets/audio/theme.wav', loop: true, duration: 7000, fade_out: 500 }).success).toBe(true);
    const r = setScene({ design_path: design, page_id: 's2', length_ms: 5000 }) as unknown as Reply;
    expect(r.success).toBe(true);
    expect(r.notes?.join(' ')).toMatch(/stops at 7\.0s because duration is 7000ms; the last 1\.0s/);
  });

  it('puts a cue on its scene, timed from the scene\'s first frame', () => {
    expect(call({ design_path: design, page_id: 's2', src: 'assets/audio/whoosh.wav', start_ms: 100 }).success).toBe(true);
    expect(spec().pages?.[1]?.audio_cues).toEqual([{ id: 'whoosh', src: 'assets/audio/whoosh.wav', at: 100 }]);
    expect(call({ design_path: design }).soundtrack?.[0]).toMatchObject({ id: 'whoosh', scene: 's2', from_ms: 3100 });
  });

  it('changes a sound by id and removes it', () => {
    call({ design_path: design, src: 'assets/audio/theme.wav' });
    expect(call({ design_path: design, audio_id: 'theme', volume: 0.3, loop: true }).success).toBe(true);
    expect(spec().audio?.[0]).toMatchObject({ src: 'assets/audio/theme.wav', volume: 0.3, loop: true });
    expect(call({ design_path: design, audio_id: 'theme', remove: true }).success).toBe(true);
    expect(spec().audio).toBeUndefined();
  });

  it('refuses what cannot play, and writes nothing', () => {
    const before = fs.readFileSync(design, 'utf8');
    expect(call({ design_path: design, src: 'assets/images/cover.png' }).error).toMatch(/audio file/);
    expect(call({ design_path: design, src: 'assets/audio/missing.mp3' }).error).toMatch(/not found/);
    expect(call({ design_path: design, src: 'assets/audio/theme.wav', volume: 2 }).error).toMatch(/volume/);
    expect(call({ design_path: design, audio_id: 'nope', volume: 0.5 }).error).toMatch(/No sound "nope"/);
    expect(call({ design_path: design, src: '../../../etc/passwd.mp3' }).error).toMatch(/not found/);
    expect(fs.readFileSync(design, 'utf8')).toBe(before);
  });

  it('is reached through the animation tool', async () => {
    const r = await dispatchAnimation({ op: 'audio', design_path: design }) as unknown as Reply;
    expect(r.success).toBe(true);
    expect(r.soundtrack).toEqual([]);
  });
});

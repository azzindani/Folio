// @vitest-environment node
import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import yaml from 'js-yaml';
import { dispatchAnimation } from '../dispatch';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-soundexport-'));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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

/** A two-scene deck, 1s on screen each, with a 3s tone stored as a project asset. */
function deck(name: string, audio: unknown[]): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'assets/audio'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets/audio/tone.wav'), toneWav(3000));
  const page = (id: string, fill: string): Record<string, unknown> => ({
    id, auto_advance: 1000, layers: [
      { id: `${id}-bg`, type: 'rect', z: 0, x: 0, y: 0, width: 64, height: 64, fill },
      { id: `${id}-dot`, type: 'rect', z: 1, x: 16, y: 16, width: 32, height: 32, fill: '#111111',
        animation: { keyframes: [{ t: 0, opacity: 0 }, { t: 400, opacity: 1 }], playback: { duration: 400 } } },
    ],
  });
  const dPath = path.join(dir, 'designs/d.design.yaml');
  fs.writeFileSync(dPath, yaml.dump({ meta: { id: 'd', name: 'D', type: 'carousel' }, document: { width: 64, height: 64 }, pages: [page('s1', '#FFFFFF'), page('s2', '#EEEEEE')], audio }));
  return dPath;
}

const streams = (file: string): { kinds: string[]; seconds: number } => {
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file], { encoding: 'utf8' });
  const info = JSON.parse(probe.stdout) as { streams: Array<{ codec_type: string }>; format: { duration: string } };
  return { kinds: info.streams.map(s => s.codec_type).sort(), seconds: Number(info.format.duration) };
};

describe('a raster export carries the design\'s sound', () => {
  it.skipIf(!hasFfmpeg)('mixes the soundtrack under an mp4 of the whole piece, cut at its end', async () => {
    const dPath = deck('mp4', [{ id: 'tone', src: 'assets/audio/tone.wav', start_time: 500, fade_out: 200 }]);
    const r = await dispatchAnimation({ op: 'export', design_path: dPath, type: 'mp4', scenes: true, fps: 10, background: false });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true });
    expect(r['warning']).toBeUndefined();
    expect(String(r['note'])).toContain('1 sound clip(s) mixed');
    const file = streams(String(r['output_path']));
    expect(file.kinds).toEqual(['audio', 'video']);
    expect(file.seconds).toBeCloseTo(2, 0);
  }, 60_000);

  it.skipIf(!hasFfmpeg)('still writes the video when a sound file is missing, and names it', async () => {
    const dPath = deck('missing', [{ id: 'gone', src: 'assets/audio/gone.mp3' }]);
    const r = await dispatchAnimation({ op: 'export', design_path: dPath, type: 'mp4', scenes: true, fps: 10, background: false });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true });
    expect((r['notes'] as string[]).join(' ')).toMatch(/gone\.mp3" is not in the project/);
    expect(streams(String(r['output_path'])).kinds).toEqual(['video']);
  }, 60_000);

  it('says a GIF has no sound instead of dropping it silently', async () => {
    const dPath = deck('gif', [{ id: 'tone', src: 'assets/audio/tone.wav' }]);
    const r = await dispatchAnimation({ op: 'export', design_path: dPath, type: 'gif', scenes: true, fps: 5, background: false });
    expect(r, JSON.stringify(r)).toMatchObject({ success: true });
    expect((r['notes'] as string[]).join(' ')).toMatch(/A GIF has no sound/);
  }, 60_000);
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { sanitizeAssetName, ingestAsset, AssetError } from './assets';
import { probeAudio } from './asset-audio';

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

describe('audio assets', () => {
  let dir: string;
  beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-audio-')); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('files sound under assets/audio by extension', () => {
    expect(sanitizeAssetName('Theme Song.MP3')).toEqual({ name: 'theme-song.mp3', ext: 'mp3', kind: 'audio' });
    for (const ext of ['wav', 'm4a', 'aac', 'ogg', 'opus', 'flac']) expect(sanitizeAssetName(`hit.${ext}`)?.kind).toBe('audio');
  });

  it('stores a wav and records how long it plays', () => {
    const { entry } = ingestAsset({ projectDir: dir, name: 'beat.wav', data: toneWav(1500) });
    expect(entry).toMatchObject({ path: 'assets/audio/beat.wav', kind: 'audio' });
    expect(fs.existsSync(path.join(dir, 'assets/audio/beat.wav'))).toBe(true);
    if (hasProbe) expect((entry as { duration_ms?: number }).duration_ms).toBe(1500);
  });

  it.skipIf(!hasProbe)('refuses a file with no sound in it and leaves the stored one alone', () => {
    ingestAsset({ projectDir: dir, name: 'song.wav', data: toneWav(500) });
    const stored = path.join(dir, 'assets/audio/song.wav');
    const good = fs.readFileSync(stored);
    let err: unknown;
    try { ingestAsset({ projectDir: dir, name: 'song.wav', data: Buffer.from('not a sound at all, only text') }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AssetError);
    expect((err as AssetError).status).toBe(415);
    expect(fs.readFileSync(stored).equals(good)).toBe(true);
  });

  it('says it knows nothing, rather than guessing, when ffprobe is missing', () => {
    const file = path.join(dir, 'x.wav');
    fs.writeFileSync(file, toneWav(100));
    expect(probeAudio(file, 'ffprobe-that-is-not-installed')).toBeNull();
  });
});

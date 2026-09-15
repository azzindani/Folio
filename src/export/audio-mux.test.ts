// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { soundFilter, muxArgs, muxSound, type MuxClip } from './audio-mux';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

const clip = (over: Partial<MuxClip>): MuxClip => ({
  id: 'm', src: 'assets/audio/m.wav', file: '/tmp/m.wav', start_ms: 0, offset_ms: 0, length_ms: 800,
  volume: 1, fade_in_ms: 0, fade_out_ms: 0, loop: false, cut: false, ...over,
});

/** A mono 16-bit PCM WAV of a 440 Hz tone at -12 dBFS. */
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

describe('soundFilter / muxArgs', () => {
  it('places one clip: trim from its offset, delay to its start, pad to the piece', () => {
    const f = soundFilter([clip({ start_ms: 1000, offset_ms: 250, fade_out_ms: 200 })], 2000);
    expect(f).toContain('[1:a]atrim=start=0.250,asetpts=PTS-STARTPTS,atrim=duration=0.800');
    expect(f).toContain('afade=t=out:st=0.600:d=0.200');
    expect(f).toContain('adelay=delays=1000|1000[s0]');
    expect(f.endsWith('[s0]apad,atrim=duration=2.000[aout]')).toBe(true);
    expect(f).not.toContain('amix');
  });

  it('sums several clips without ducking and limits the peaks', () => {
    const f = soundFilter([clip({}), clip({ id: 'cue', start_ms: 500 })], 2000);
    expect(f).toContain('[s0][s1]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.97:level=0');
  });

  it('copies the video, loops a looping input and picks the codec per container', () => {
    const mp4 = muxArgs('v.mp4', [clip({ loop: true, file: 'bed.mp3' })], 2000, 'mp4', 'out');
    expect(mp4.join(' ')).toContain('-stream_loop -1 -i bed.mp3');
    expect(mp4.join(' ')).toContain('-c:v copy -c:a aac -b:a 192k -t 2.000 -movflags +faststart -f mp4 out');
    expect(muxArgs('v.webm', [clip({})], 2000, 'webm', 'out').join(' ')).toContain('-c:a libopus');
  });
});

describe.skipIf(!hasFfmpeg)('muxSound (ffmpeg)', () => {
  let dir = '';
  let video = '';
  let wav = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mux-'));
    video = path.join(dir, 'v.mp4');
    wav = path.join(dir, 'tone.wav');
    fs.writeFileSync(wav, toneWav(1000));
    spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=64x64:r=10', '-t', '2',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video]);
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  const loudest = (file: string, from: number, len: number): number => {
    const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-ss', String(from), '-t', String(len), '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const m = /max_volume: (-?[\d.]+|-inf) dB/.exec(r.stderr);
    return !m || m[1] === '-inf' ? -Infinity : Number(m[1]);
  };

  it('writes the sound where the plan puts it, and nothing before', async () => {
    await muxSound(video, [clip({ file: wav, start_ms: 1000, length_ms: 800 })], 2000, 'mp4');
    const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name:format=duration', '-of', 'json', video], { encoding: 'utf8' });
    const info = JSON.parse(probe.stdout) as { streams: Array<{ codec_type: string; codec_name: string }>; format: { duration: string } };
    expect(info.streams.map(s => `${s.codec_type}:${s.codec_name}`).sort()).toEqual(['audio:aac', 'video:h264']);
    expect(Number(info.format.duration)).toBeCloseTo(2, 0);
    expect(loudest(video, 0.1, 0.7)).toBeLessThan(-50);
    expect(loudest(video, 1.2, 0.4)).toBeGreaterThan(-20);
    expect(fs.readdirSync(dir).filter(n => n.includes('partial'))).toEqual([]);
  });

  it('leaves the video as it was when a sound file is missing', async () => {
    const before = fs.readFileSync(video);
    await expect(muxSound(video, [clip({ file: path.join(dir, 'gone.wav') })], 2000, 'mp4')).rejects.toThrow(/ffmpeg exited/);
    expect(fs.readFileSync(video).equals(before)).toBe(true);
    expect(fs.readdirSync(dir).filter(n => n.includes('partial'))).toEqual([]);
  });
});

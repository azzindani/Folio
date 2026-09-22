import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { sanitizeAssetName, ingestAsset, assetAdd, parseAssetPath, AssetError } from './assets';
import { probeVideo, maxVideoBytes } from './asset-video';
import { assetCap } from './asset-media';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

describe('video assets', () => {
  let dir: string;
  let clip: Buffer = Buffer.alloc(0);
  let silent: Buffer = Buffer.alloc(0);
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-video-'));
    if (!hasFfmpeg) return;
    // 1.5 s of test pattern, 160×90 at 10 fps, with and without a tone under it.
    const out = path.join(dir, 'src.mp4'), mute = path.join(dir, 'mute.mp4');
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1.5', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-y', out], { timeout: 30_000 });
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x90:rate=10:duration=1.5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', mute], { timeout: 30_000 });
    clip = fs.readFileSync(out);
    silent = fs.readFileSync(mute);
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('files footage under assets/video by extension', () => {
    for (const ext of ['mp4', 'm4v', 'mov', 'webm']) expect(sanitizeAssetName(`Take One.${ext.toUpperCase()}`)?.kind).toBe('video');
    expect(parseAssetPath('assets/video/take.mp4')).toEqual({ kind: 'video', folder: '', name: 'take.mp4' });
  });

  it('gives footage its own, larger cap', () => {
    expect(assetCap('video', 8).bytes).toBe(maxVideoBytes());
    expect(assetCap('images', 8).bytes).toBe(8);
  });

  it.skipIf(!hasFfmpeg)('measures a clip: length, frame size, rate, whether it has sound', () => {
    const file = path.join(dir, 'src.mp4');
    expect(probeVideo(file)).toMatchObject({ width: 160, height: 90, fps: 10, has_audio: true });
    const d = (probeVideo(file) as { duration_ms: number }).duration_ms;
    expect(Math.abs(d - 1500)).toBeLessThan(120);
    expect(probeVideo(path.join(dir, 'mute.mp4'))).toMatchObject({ has_audio: false });
  }, 30_000);

  it.skipIf(!hasFfmpeg)('stores a clip, measured, and hands back a video layer to place', () => {
    const r = assetAdd({ project_path: dir, name: 'take.mp4', data: `data:video/mp4;base64,${silent.toString('base64')}` }) as unknown as Record<string, unknown>;
    expect(r['success']).toBe(true);
    expect(r['asset']).toMatchObject({ path: 'assets/video/take.mp4', kind: 'video', width: 160, height: 90, fps: 10, has_audio: false });
    expect(r['next_action']).toMatchObject({ tool: 'add_layers', params: { layers_shorthand: [{ type: 'video', src: 'assets/video/take.mp4' }] } });
    const { entry } = ingestAsset({ projectDir: dir, name: 'take2.mp4', data: clip });
    expect(entry).toMatchObject({ kind: 'video', has_audio: true });
  }, 30_000);

  it.skipIf(!hasFfmpeg)('refuses a file that is not footage and leaves the stored one alone', () => {
    ingestAsset({ projectDir: dir, name: 'keep.mp4', data: silent });
    let err: unknown;
    try { ingestAsset({ projectDir: dir, name: 'keep.mp4', data: Buffer.from('text pretending to be a movie') }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AssetError);
    expect(String((err as Error).message)).toContain('has no video stream');
    expect(fs.readFileSync(path.join(dir, 'assets/video/keep.mp4')).equals(silent)).toBe(true);
  }, 30_000);
});

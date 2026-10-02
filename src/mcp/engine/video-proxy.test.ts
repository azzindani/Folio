import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { proxyPathOf, proxyFor, queueProxy, PROXY_EDGE } from './video-proxy';
import { probeVideo } from './asset-video';

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).error === undefined && spawnSync('ffprobe', ['-version']).error === undefined;

describe('proxyPathOf', () => {
  it('puts a clip\'s proxy in assets/video/.proxy, keeping its folder', () => {
    expect(proxyPathOf('/p/assets/video/a.mov')).toBe(path.join('/p/assets/video', '.proxy', 'a.mp4'));
    expect(proxyPathOf('/p/assets/video/b-roll/sea.webm')).toBe(path.join('/p/assets/video', '.proxy', 'b-roll/sea.mp4'));
  });
  it('has no proxy for a proxy, or for a file outside a video folder', () => {
    expect(proxyPathOf('/p/assets/video/.proxy/a.mp4')).toBeNull();
    expect(proxyPathOf('/p/assets/images/a.png')).toBeNull();
  });
});

describe.skipIf(!hasFfmpeg)('queueProxy', () => {
  let dir = '', clip = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-proxy-'));
    clip = path.join(dir, 'assets', 'video', 'wide.mp4');
    fs.mkdirSync(path.dirname(clip), { recursive: true });
    spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1920x1080:rate=10:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', clip], { timeout: 30_000 });
  }, 60_000);
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('builds a 720p proxy once; a replaced clip makes it stale', async () => {
    expect(proxyFor(clip)).toBeNull();
    await queueProxy(clip);
    const p = proxyFor(clip);
    expect(p).not.toBeNull();
    const probe = p ? probeVideo(p) : null;
    expect(probe && probe !== 'not-video' ? probe.width : 0).toBe(PROXY_EDGE);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(clip, later, later);
    expect(proxyFor(clip)).toBeNull();
  }, 60_000);
});

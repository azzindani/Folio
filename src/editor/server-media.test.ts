import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { rangeOf, mediaResponse, isRangedMedia } from './server-media';
import { proxiedSrc } from './canvas-video';

describe('rangeOf', () => {
  it('reads open, closed and suffix ranges, capped at 8 MB a reply', () => {
    expect(rangeOf('bytes=0-99', 1000)).toEqual({ start: 0, end: 99 });
    expect(rangeOf('bytes=900-', 1000)).toEqual({ start: 900, end: 999 });
    expect(rangeOf('bytes=-100', 1000)).toEqual({ start: 900, end: 999 });
    expect(rangeOf('bytes=0-', 100 * 1024 * 1024)?.end).toBe(8 * 1024 * 1024 - 1);
  });
  it('refuses what cannot be served', () => {
    expect(rangeOf('bytes=2000-', 1000)).toBeNull();
    expect(rangeOf('items=0-1', 1000)).toBeNull();
    expect(rangeOf(null, 1000)).toBeNull();
  });
});

describe('mediaResponse', () => {
  let dir = '', file = '';
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-media-'));
    file = path.join(dir, 'c.mp4');
    fs.writeFileSync(file, Buffer.from(Array.from({ length: 256 }, (_, i) => i)));
  });
  afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('answers a range with 206 and exactly those bytes', async () => {
    const r = mediaResponse(file, 'bytes=10-19', { 'Content-Type': 'video/mp4' });
    expect(r.status).toBe(206);
    expect(r.headers.get('content-range')).toBe('bytes 10-19/256');
    expect(Array.from(new Uint8Array(await r.arrayBuffer()))).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  });
  it('answers no range whole, with Accept-Ranges; an impossible one with 416', async () => {
    const whole = mediaResponse(file, null, { 'Content-Type': 'video/mp4' });
    expect(whole.status).toBe(200);
    expect(whole.headers.get('accept-ranges')).toBe('bytes');
    expect((await whole.arrayBuffer()).byteLength).toBe(256);
    expect(mediaResponse(file, 'bytes=999-', {}).status).toBe(416);
  });
  it('ranges video and sound only', () => {
    expect(isRangedMedia('video/webm')).toBe(true);
    expect(isRangedMedia('image/png')).toBe(false);
  });
});

describe('proxiedSrc', () => {
  it('asks the server for a project clip\'s proxy, once', () => {
    expect(proxiedSrc('/__project_files/p/assets/video/a.mp4')).toBe('/__project_files/p/assets/video/a.mp4?proxy=1');
    expect(proxiedSrc('/__project_files/p/assets/video/a.mp4?v=2')).toBe('/__project_files/p/assets/video/a.mp4?v=2&proxy=1');
    expect(proxiedSrc('/__project_files/p/assets/video/a.mp4?proxy=1')).toBe('/__project_files/p/assets/video/a.mp4?proxy=1');
    expect(proxiedSrc('https://example.com/a.mp4')).toBe('https://example.com/a.mp4');
  });
});

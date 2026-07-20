import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportToAnimation, tryFfmpeg, encodeWithFfmpeg } from './animation-export';

// The frame-capture cases below assert the manifest branch, so they all pass
// `encoder: 'none'`. They used to just trust the host not to have ffmpeg: green
// on a bare CI runner, and four hard failures the moment ffmpeg showed up on a
// dev box, where the real encode ran against fake Buffer.from('PNG') frames.
//
// Mocking `child_process` does not fix that — vi.mock does not intercept the
// Node builtin here (tryFfmpeg() still returned true under the mock), and a test
// that lies about the host is the wrong shape anyway. The encoder is a real
// option instead, so these cases state which branch they mean.

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-anim-test-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const HTML = '<!DOCTYPE html><html><body>hello</body></html>';

function makeHtml(): string {
  const p = path.join(tmpDir, 'test.html');
  fs.writeFileSync(p, HTML);
  return p;
}

describe('exportToAnimation', () => {
  it('returns error when html file does not exist', async () => {
    const r = await exportToAnimation(
      path.join(tmpDir, 'missing.html'),
      path.join(tmpDir, 'out.gif'),
      { type: 'gif' },
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('not found');
  });

  it('returns error when puppeteer not installed and no factory', async () => {
    const htmlPath = makeHtml();
    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.gif'), { type: 'gif' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('puppeteer');
  });

  it('captures frames via factory and writes manifest for gif', async () => {
    const htmlPath = makeHtml();
    const outPath = path.join(tmpDir, 'out.gif');
    let screenshotCount = 0;

    const factory = async () => ({
      browser: {
        close: async () => { return; },
        newPage: async () => ({
          setViewport: async () => { return; },
          goto: async () => { return; },
          screenshot: async () => { screenshotCount++; return Buffer.from('PNG'); },
          evaluate: async () => { return; },
          close: async () => { return; },
        }),
      },
    });

    const r = await exportToAnimation(htmlPath, outPath, { type: 'gif', fps: 5, duration: 1000, encoder: 'none' }, factory);
    expect(r.success).toBe(true);
    expect(r.frames).toBe(5); // 5fps × 1s
    expect(r.output_path).toContain('.frames.json');
    expect(fs.existsSync(r.output_path as string)).toBe(true);
    expect(screenshotCount).toBe(5);
  });

  it('captures frames via factory for mp4 with higher default fps', async () => {
    const htmlPath = makeHtml();
    const factory = async () => ({
      browser: {
        close: async () => { return; },
        newPage: async () => ({
          setViewport: async () => { return; },
          goto: async () => { return; },
          screenshot: async () => Buffer.from('PNG'),
          evaluate: async () => { return; },
          close: async () => { return; },
        }),
      },
    });

    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.mp4'), { type: 'mp4', fps: 10, duration: 500, encoder: 'none' }, factory);
    expect(r.success).toBe(true);
    expect(r.frames).toBe(5);
  });

  it('manifest JSON contains type and fps', async () => {
    const htmlPath = makeHtml();
    const factory = async () => ({
      browser: {
        close: async () => { return; },
        newPage: async () => ({
          setViewport: async () => { return; },
          goto: async () => { return; },
          screenshot: async () => Buffer.from('PNG'),
          evaluate: async () => { return; },
          close: async () => { return; },
        }),
      },
    });

    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.gif'), { type: 'gif', fps: 5, duration: 200, encoder: 'none' }, factory);
    const manifest = JSON.parse(fs.readFileSync(r.output_path as string, 'utf-8')) as { type: string; fps: number };
    expect(manifest.type).toBe('gif');
    expect(manifest.fps).toBe(5);
  });

  it('returns error when browser launch fails', async () => {
    const htmlPath = makeHtml();
    const factory = async (): Promise<never> => { throw new Error('launch failed'); };
    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.gif'), { type: 'gif' }, factory);
    expect(r.success).toBe(false);
    expect(r.error).toContain('launch failed');
  });

  it('accepts webm type', async () => {
    const htmlPath = makeHtml();
    const factory = async () => ({
      browser: {
        close: async () => { return; },
        newPage: async () => ({
          setViewport: async () => { return; },
          goto: async () => { return; },
          screenshot: async () => Buffer.from('PNG'),
          evaluate: async () => { return; },
          close: async () => { return; },
        }),
      },
    });
    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.webm'), { type: 'webm', fps: 5, duration: 200, encoder: 'none' }, factory);
    expect(r.success).toBe(true);
    expect(r.frames).toBe(1); // 5fps × 0.2s = 1
  });
});

describe('encoder option', () => {
  const factory = async () => ({
    browser: {
      close: async () => { return; },
      newPage: async () => ({
        setViewport: async () => { return; },
        goto: async () => { return; },
        screenshot: async () => Buffer.from('PNG'),
        evaluate: async () => { return; },
        close: async () => { return; },
      }),
    },
  });

  it('encoder:"none" emits a manifest regardless of what the host has', async () => {
    const r = await exportToAnimation(
      makeHtml(), path.join(tmpDir, 'out.gif'),
      { type: 'gif', fps: 5, duration: 200, encoder: 'none' }, factory,
    );
    expect(r.success).toBe(true);
    expect(r.output_path).toContain('.frames.json');
  });

  it('encoder:"ffmpeg" fails loudly instead of silently degrading', async () => {
    if (tryFfmpeg()) return; // host has ffmpeg — the failure path is unreachable
    const r = await exportToAnimation(
      makeHtml(), path.join(tmpDir, 'out.gif'),
      { type: 'gif', fps: 5, duration: 200, encoder: 'ffmpeg' }, factory,
    );
    expect(r.success).toBe(false);
    expect(r.error).toContain('ffmpeg');
    expect(r.error).toContain('encoder:"none"');
  });

  it('defaults to auto, which never hard-fails on a missing encoder', async () => {
    const r = await exportToAnimation(
      makeHtml(), path.join(tmpDir, 'out.gif'),
      { type: 'gif', fps: 5, duration: 200 }, factory,
    );
    // ffmpeg present → a real gif; absent → a manifest. Either way, success.
    expect(r.success).toBe(true);
  });
});

describe('tryFfmpeg', () => {
  it('returns a boolean', () => {
    const result = tryFfmpeg();
    expect(typeof result).toBe('boolean');
  });
});

describe('encodeWithFfmpeg', () => {
  it('throws when ffmpeg not installed (expected in CI)', () => {
    if (tryFfmpeg()) return; // skip if ffmpeg present
    const frameDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-frames-'));
    try {
      expect(() => encodeWithFfmpeg(frameDir, path.join(tmpDir, 'out.gif'), { type: 'gif', fps: 10 })).toThrow();
    } finally {
      fs.rmSync(frameDir, { recursive: true, force: true });
    }
  });

  it('is callable as a function', () => {
    expect(typeof encodeWithFfmpeg).toBe('function');
  });
});

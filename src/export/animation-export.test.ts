import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportToAnimation } from './animation-export';

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

    const r = await exportToAnimation(htmlPath, outPath, { type: 'gif', fps: 5, duration: 1000 }, factory);
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

    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.mp4'), { type: 'mp4', fps: 10, duration: 500 }, factory);
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

    const r = await exportToAnimation(htmlPath, path.join(tmpDir, 'out.gif'), { type: 'gif', fps: 5, duration: 200 }, factory);
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
});

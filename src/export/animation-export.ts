import * as fs from 'fs';
import * as path from 'path';

export interface AnimationExportOptions {
  type: 'gif' | 'mp4';
  fps?: number;
  duration?: number;
  width?: number;
  height?: number;
  slides?: number[];
}

export interface AnimationExportResult {
  success: boolean;
  output_path?: string;
  frames?: number;
  error?: string;
}

type PuppeteerFactory = () => Promise<{ browser: BrowserLike }>;

interface BrowserLike {
  close(): Promise<void>;
  newPage(): Promise<PageLike>;
}

interface PageLike {
  setViewport(opts: { width: number; height: number }): Promise<void>;
  goto(url: string, opts?: { waitUntil?: string }): Promise<void>;
  screenshot(opts: { type: string; encoding?: string }): Promise<string | Buffer>;
  evaluate(fn: string): Promise<unknown>;
  close(): Promise<void>;
}

interface PuppeteerModule {
  launch(opts: Record<string, unknown>): Promise<BrowserLike>;
}

function tryRequirePuppeteer(): PuppeteerModule | null {
  if (typeof require === 'undefined') return null;
  try { return require('puppeteer') as PuppeteerModule; } catch { return null; }
}

export async function exportToAnimation(
  htmlPath: string,
  outputPath: string,
  opts: AnimationExportOptions = { type: 'gif' },
  _factory?: PuppeteerFactory,
): Promise<AnimationExportResult> {
  if (!fs.existsSync(htmlPath)) {
    return { success: false, error: `HTML file not found: ${htmlPath}` };
  }

  const puppeteer = tryRequirePuppeteer();
  if (!puppeteer && !_factory) {
    return { success: false, error: 'puppeteer not installed. Run: npm install puppeteer' };
  }

  const fps = opts.fps ?? (opts.type === 'gif' ? 10 : 30);
  const duration = opts.duration ?? 3000;
  const frameCount = Math.round((duration / 1000) * fps);
  const frameInterval = Math.round(1000 / fps);
  const width = opts.width ?? 1280;
  const height = opts.height ?? 720;

  const frameDir = path.join(path.dirname(outputPath), `.frames-${String(Date.now())}`);
  fs.mkdirSync(frameDir, { recursive: true });

  try {
    const browser: BrowserLike = await (async () => {
      if (_factory) {
        const r = await _factory();
        return r.browser;
      }
      return (puppeteer as PuppeteerModule).launch({
        headless: true,
        args: ['--no-sandbox'],
      });
    })();

    try {
      const page = await browser.newPage();
      await page.setViewport({ width, height });
      await page.goto(`file://${htmlPath}`, { waitUntil: 'networkidle0' });

      for (let i = 0; i < frameCount; i++) {
        const framePath = path.join(frameDir, `frame-${String(i).padStart(5, '0')}.png`);
        const data = await page.screenshot({ type: 'png', encoding: 'binary' });
        fs.writeFileSync(framePath, data as Buffer);
        if (i < frameCount - 1) {
          await page.evaluate(`new Promise(r => setTimeout(r, ${frameInterval}))`);
        }
      }
      await page.close();
    } finally {
      await browser.close();
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const manifest = { type: opts.type, frames: frameCount, fps, frameDir, outputPath };
    const manifestPath = outputPath + '.frames.json';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    fs.rmSync(frameDir, { recursive: true, force: true });

    return { success: true, output_path: manifestPath, frames: frameCount };
  } catch (err) {
    fs.rmSync(frameDir, { recursive: true, force: true });
    return { success: false, error: (err as Error).message };
  }
}

/**
 * Script components in raster renders (phase 3, S7) — captured in headless
 * Chromium, drawn by the renderer from scripting/script-frames.ts.
 *
 * One browser per batch, one page per component: the page loads the
 * component's document in capture mode (it never plays by itself), then each
 * moment is `__folioRender(t)` and a screenshot of the box with a transparent
 * background. Same code, same seed, same t → the same pixels, so two exports
 * of a piece are frame-identical. No browser on the host → the component is
 * left out of the picture and the reply says so.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { DesignSpec, Layer, ScriptLayer } from '../../schema/types';
import { buildScriptDoc } from '../../scripting/script-runtime';
import { componentTime, scriptFrame, scriptKey, setScriptFrame, dropScriptFrames, stampedScripts, hasScripts, collectScripts } from '../../scripting/script-frames';
import type { ToolResult } from '../types';

/** The Chromium to drive: FOLIO_CHROMIUM, the system one (the image ships it), or a Playwright download. */
export function chromiumPath(): string | null {
  const env = process.env['FOLIO_CHROMIUM'];
  if (env && fs.existsSync(env)) return env;
  for (const p of ['/usr/bin/chromium-browser', '/usr/bin/chromium']) if (fs.existsSync(p)) return p;
  const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
  try {
    for (const d of fs.readdirSync(cache).filter(n => /^chromium-\d+$/.test(n)).sort().reverse()) {
      const exe = path.join(cache, d, 'chrome-linux64', 'chrome');
      if (fs.existsSync(exe)) return exe;
    }
  } catch { /* no Playwright download either */ }
  return null;
}

const NO_BROWSER = 'Script components are captured in headless Chromium, which this host does not have — they are missing from this render.';

/** A browser kept open across the frames of one render: one page per component, loaded once. */
export interface CaptureSession {
  /** Capture every (component, page time) not captured yet; returns the cache keys it filled. */
  capture(wanted: { layer: ScriptLayer; t: number }[]): Promise<string[]>;
  close(): Promise<void>;
}

/** Open a capture session, or say why there is none. */
export async function openCapture(): Promise<CaptureSession | string> {
  const exe = chromiumPath();
  if (!exe) return NO_BROWSER;
  let pw: typeof import('playwright-core');
  try { pw = await import('playwright-core'); } catch { return NO_BROWSER; }
  const browser = await pw.chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--force-color-profile=srgb', '--hide-scrollbars'] });
  const pages = new Map<string, Promise<import('playwright-core').Page>>();
  const pageFor = (layer: ScriptLayer): Promise<import('playwright-core').Page> => {
    const key = scriptKey(layer);
    let p = pages.get(key);
    if (!p) {
      const width = Math.max(1, Math.round(typeof layer.width === 'number' ? layer.width : 400));
      const height = Math.max(1, Math.round(typeof layer.height === 'number' ? layer.height : 300));
      p = browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
        .then(async page => { await page.setContent(buildScriptDoc(layer, true), { waitUntil: 'load' }); return page; });
      pages.set(key, p);
    }
    return p;
  };
  return {
    async capture(wanted) {
      const filled: string[] = [];
      for (const w of wanted) {
        if (scriptFrame(w.layer, w.t)) continue;
        const page = await pageFor(w.layer);
        await page.evaluate(`window.__folioRender(${componentTime(w.layer, w.t)})`);
        const png = await page.screenshot({ type: 'png', omitBackground: true });
        filled.push(setScriptFrame(w.layer, w.t, `data:image/png;base64,${png.toString('base64')}`));
      }
      return filled;
    },
    close: () => browser.close(),
  };
}

/** One render's captures, in one session. Returns notes for the reply. */
export async function captureScripts(wanted: { layer: ScriptLayer; t: number }[]): Promise<string[]> {
  if (!wanted.some(w => !scriptFrame(w.layer, w.t))) return [];
  const session = await openCapture();
  if (typeof session === 'string') return [session];
  try { await session.capture(wanted); } finally { await session.close(); }
  return [];
}

/** Every layer of a design, all pages. */
const allLayers = (s: DesignSpec): Layer[] => [...(s.layers ?? []), ...(s.pages ?? []).flatMap(p => p.layers ?? [])];

/**
 * An export's script frames, captured a chunk ahead of the frames that draw
 * them: a frame's picture is in its SVG the moment it is launched, so the
 * chunk before can be dropped — memory stays one chunk, however long the clip.
 */
export async function scriptsAhead(spec: DesignSpec, at: (t: number, frameMs?: number) => DesignSpec, times: number[], frameMs: number, notes: string[]):
  Promise<{ ahead(i: number): Promise<void>; close(): Promise<void> } | null> {
  if (!hasScripts(allLayers(spec))) return null;
  const session = await openCapture();
  if (typeof session === 'string') { notes.push(session); return null; }
  const CHUNK = 24;
  let held: string[] = [];
  return {
    async ahead(i) {
      if (i % CHUNK) return;
      dropScriptFrames(held);
      held = await session.capture(times.slice(i, i + CHUNK).flatMap(t => stampedScripts(allLayers(at(t, frameMs)))));
    },
    async close() { dropScriptFrames(held); held = []; await session.close(); },
  };
}

/**
 * A still render that holds script components: run once collecting the frames
 * it lacks, capture them, run again. Nothing to capture → the first result, as
 * before. Notes (no browser) join the reply's.
 */
export async function withScriptCapture(run: () => ToolResult): Promise<ToolResult> {
  const first = collectScripts(run);
  if (!first.missing.length) return first.result;
  const notes = await captureScripts(first.missing);
  const again = collectScripts(run).result;
  if (!notes.length) return again;
  const was = (again as unknown as { notes?: unknown }).notes;
  return { ...again, notes: [...(Array.isArray(was) ? was : []), ...notes] } as ToolResult;
}

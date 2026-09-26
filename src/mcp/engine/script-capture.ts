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
import { spawn } from 'child_process';
import type { DesignSpec, Layer, ScriptLayer } from '../../schema/types';
import { buildScriptDoc } from '../../scripting/script-runtime';
import { Cdp } from './cdp-client';
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

const STEP_MS = 20000;
const NO_BROWSER = 'Script components are captured in headless Chromium, which this host does not have — they are missing from this render.';
const NO_SOCKET = 'Script components are captured over a WebSocket this runtime lacks (it needs Bun, or Node 22+) — they are missing from this render.';

/** A browser kept open across the frames of one render: one page per component, loaded once. */
export interface CaptureSession {
  /** Capture every (component, page time) not captured yet; returns the cache keys it filled. */
  capture(wanted: { layer: ScriptLayer; t: number }[]): Promise<string[]>;
  close(): Promise<void>;
}

/** Chromium started by us, driven over DevTools (cdp-client.ts); `stop` kills it and its profile. */
async function startBrowser(exe: string): Promise<{ cdp: Cdp; stop: () => void }> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-chromium-'));
  const child = spawn(exe, ['--headless', '--remote-debugging-port=0', '--remote-allow-origins=*', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--force-color-profile=srgb', '--hide-scrollbars', '--no-first-run', `--user-data-dir=${dir}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  // The profile goes once the browser has exited: removed before, a dying Chromium writes it back.
  const clean = (): void => { fs.rmSync(dir, { recursive: true, force: true }); };
  child.once('exit', clean);
  const stop = (): void => { if (child.exitCode !== null || child.signalCode !== null) clean(); else child.kill('SIGKILL'); };
  try {
    const url = await new Promise<string>((resolve, reject) => {
      let seen = '';
      const timer = setTimeout(() => reject(new Error('headless Chromium did not start')), STEP_MS);
      child.stderr?.on('data', (b: Buffer) => {
        seen += b.toString();
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(seen);
        if (m?.[1]) { clearTimeout(timer); resolve(m[1]); }
      });
      child.on('exit', code => { clearTimeout(timer); reject(new Error(`headless Chromium exited (${String(code)})`)); });
    });
    return { cdp: await Cdp.connect(url, STEP_MS), stop };
  } catch (e) {
    stop();
    throw e;
  }
}

/** A page holding one component's document, sized to its box, transparent behind it: its CDP session id. */
async function openPage(cdp: Cdp, layer: ScriptLayer): Promise<string> {
  const width = Math.max(1, Math.round(typeof layer.width === 'number' ? layer.width : 400));
  const height = Math.max(1, Math.round(typeof layer.height === 'number' ? layer.height : 300));
  const { targetId } = await cdp.send<{ targetId: string }>('Target.createTarget', { url: 'about:blank' }, undefined, `opening "${layer.id}"`);
  const { sessionId } = await cdp.send<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true });
  const call = <T>(m: string, p: Record<string, unknown> = {}): Promise<T> => cdp.send<T>(m, p, sessionId, `${m} on "${layer.id}"`);
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
  await call('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const { frameTree } = await call<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
  await call('Page.setDocumentContent', { frameId: frameTree.frame.id, html: buildScriptDoc(layer, true) });
  for (let i = 0; i < 50; i++) {
    const r = await call<{ result: { value?: unknown } }>('Runtime.evaluate', { expression: 'typeof window.__folioRender', returnByValue: true });
    if (r.result.value === 'function') return sessionId;
    await new Promise(res => setTimeout(res, 20));
  }
  throw new Error(`script capture: "${layer.id}" never became ready`);
}

/** Open a capture session, or say why there is none. */
export async function openCapture(): Promise<CaptureSession | string> {
  if (!Cdp.available()) return NO_SOCKET;
  const exe = chromiumPath();
  if (!exe) return NO_BROWSER;
  let run = await startBrowser(exe);
  let pages = new Map<string, Promise<string>>();
  const pageFor = (layer: ScriptLayer): Promise<string> => {
    const key = scriptKey(layer);
    let p = pages.get(key);
    if (!p) { p = openPage(run.cdp, layer); pages.set(key, p); }
    return p;
  };
  const shoot = async (w: { layer: ScriptLayer; t: number }): Promise<string> => {
    const sessionId = await pageFor(w.layer);
    const at = `"${w.layer.id}" at ${Math.round(w.t)} ms`;
    await run.cdp.send('Runtime.evaluate', { expression: `window.__folioRender(${componentTime(w.layer, w.t)})` }, sessionId, `drawing ${at}`);
    const { data } = await run.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png', fromSurface: true }, sessionId, `capturing ${at}`);
    return data;
  };
  return {
    async capture(wanted) {
      const filled: string[] = [];
      for (const w of wanted) {
        if (scriptFrame(w.layer, w.t)) continue;
        let png: string;
        try { png = await shoot(w); } catch {
          // Once, with a fresh browser: the same code and t give the same picture.
          run.cdp.close(); run.stop();
          run = await startBrowser(exe);
          pages = new Map();
          png = await shoot(w);
        }
        filled.push(setScriptFrame(w.layer, w.t, `data:image/png;base64,${png}`));
      }
      return filled;
    },
    async close() {
      await run.cdp.send('Browser.close', {}, undefined, 'closing the browser').catch(() => undefined);
      run.cdp.close();
      run.stop();
    },
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

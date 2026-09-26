// @vitest-environment node
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { DesignSpec, Layer, ScriptLayer } from '../../schema/types';
import { captureScripts, chromiumPath, openCapture, withScriptCapture } from './script-capture';
import { Cdp } from './cdp-client';
import { clearScriptFrames, collectScripts, componentTime, scriptFrame, setScriptFrame, stampScripts, stampedScripts, dropScriptFrames } from '../../scripting/script-frames';
import { renderToSVGString } from './svg-export';
import { specAt } from '../../export/gif-frames';

const DOT = `const c = document.getElementById('c'), g = c.getContext('2d'); c.width = folio.width; c.height = folio.height;
folio.frame(t => { g.clearRect(0, 0, c.width, c.height); g.fillStyle = '#E4572E';
  g.fillRect((t / 10) % (c.width - 20) + folio.random() * 4, 20, 20, 20); });`;
const script = (extra: Partial<ScriptLayer> = {}): ScriptLayer =>
  ({ id: 'dot', type: 'script', z: 1, x: 40, y: 60, width: 200, height: 60, html: '<canvas id="c"></canvas>', js: DOT, duration: 2000, loop: true, ...extra }) as ScriptLayer;
const design = (l: Layer): DesignSpec => ({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 400, height: 300 }, layers: [l] } as unknown as DesignSpec);

afterEach(() => clearScriptFrames());

describe('script frames', () => {
  it('stamp each frame\'s script layers with their page time, on the component\'s own clock', () => {
    const spec = design(script() as unknown as Layer);
    expect(stampedScripts(specAt(spec, 0, 2500).layers ?? []).map(s => s.t)).toEqual([2500]);
    expect(componentTime(script(), 2500)).toBe(500);
    expect(componentTime(script({ loop: false }), 2500)).toBe(2000);
    const plain = [{ id: 'r', type: 'rect', z: 0 } as unknown as Layer];
    expect(stampScripts(plain, 10)).toBe(plain);
  });

  it('draw a captured frame in a raster render, and name the frames a still lacks', () => {
    const spec = design(script() as unknown as Layer);
    const first = collectScripts(() => renderToSVGString(spec));
    expect(first.missing.map(m => m.t)).toEqual([0]);
    expect(first.result).toContain('<foreignObject');
    const key = setScriptFrame(script(), 0, 'data:image/png;base64,AAAA');
    expect(collectScripts(() => renderToSVGString(spec)).result).toMatch(/<image[^>]*href="data:image\/png;base64,AAAA"/);
    expect(renderToSVGString(spec)).toContain('<foreignObject');
    dropScriptFrames([key]);
    expect(scriptFrame(script(), 0)).toBeUndefined();
  });

  it('say why nothing is captured on a runtime without WebSocket, and start no browser', async () => {
    vi.stubGlobal('WebSocket', undefined);
    try {
      expect(await openCapture()).toMatch(/WebSocket this runtime lacks/);
    } finally { vi.unstubAllGlobals(); }
  });

  it.skipIf(!chromiumPath() || !Cdp.available())('capture the same pixels for the same moment, every time', async () => {
    const at = async (t: number): Promise<string> => {
      clearScriptFrames();
      expect((await captureScripts([{ layer: script(), t }])).notes).toEqual([]);
      return scriptFrame(script(), t) ?? '';
    };
    const a = await at(700), b = await at(700), c = await at(1300);
    expect(a.startsWith('data:image/png;base64,')).toBe(true);
    expect(b).toBe(a);
    expect(c).not.toBe(a);
    const r = await withScriptCapture(() => ({ success: true, progress: [], token_estimate: 0, svg: renderToSVGString(design(script() as unknown as Layer)) }) as never);
    expect((r as unknown as { svg: string }).svg).toMatch(/<image[^>]*href="data:image\/png/);
  }, 60000);
});

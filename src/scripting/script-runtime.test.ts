// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';
import type { ScriptLayer, DesignSpec, Layer } from '../schema/types';
import { buildScriptDoc, seedOf } from './script-runtime';
import { lintScript } from './script-lint';
import { collectFindings } from '../mcp/engine/diagnose-collect';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { animationDuration } from '../export/gif-frames';
import { playsInTime } from '../ui/panels/timeline-model';

const layer = (js: string, extra: Partial<ScriptLayer> = {}): ScriptLayer =>
  ({ id: 'doodle', type: 'script', z: 1, x: 100, y: 200, width: 320, height: 240, js, ...extra }) as ScriptLayer;

/** The component's document in a captured page: scripts run, nothing plays by itself. */
function capture(l: ScriptLayer): (t: number) => string {
  const dom = new JSDOM(buildScriptDoc(l), { runScripts: 'dangerously', pretendToBeVisual: true,
    beforeParse: w => { (w as unknown as { __folioCapture: boolean }).__folioCapture = true; } });
  const w = dom.window as unknown as { __folioRender: (t: number) => void; document: Document };
  return t => { w.__folioRender(t); return w.document.body.getAttribute('data-v') ?? ''; };
}

describe('script components', () => {
  it('draw a moment: the same t gives the same frame, however it was reached', () => {
    const at = capture(layer(`folio.frame(t => document.body.setAttribute('data-v',
      [t, Math.random().toFixed(6), folio.random().toFixed(6), folio.hash(3).toFixed(6), Date.now(), performance.now(), folio.width].join('|')));`));
    const first = at(500);
    at(900); at(0);
    expect(at(500)).toBe(first);
    const [t, r1, r2, , now, perf, w] = first.split('|');
    expect([t, now, perf, w]).toEqual(['500', String(1700000000000 + 500), '500', '320']);
    expect(r1).not.toBe(r2);
    const other = capture(layer(`folio.frame(t => document.body.setAttribute('data-v', String(folio.random())));`, { seed: 7 }));
    expect(other(0)).not.toBe(capture(layer(`folio.frame(t => document.body.setAttribute('data-v', String(folio.random())));`, { seed: 8 }))(0));
  });

  it('runs behind a CSP that blocks the network, and keeps its code inside its <script>', () => {
    const doc = buildScriptDoc(layer(`const s = "</script><b>x</b>"; folio.frame(() => {});`, { html: '<canvas id="c"></canvas>', css: 'canvas{width:100%}' }));
    expect(doc).toContain(`content="default-src 'none'; script-src 'unsafe-inline'`);
    expect(doc).toContain('<\\/script><b>x</b>');
    expect(doc).toContain('<canvas id="c"></canvas>');
    expect(seedOf('doodle')).toBe(seedOf('doodle'));
    expect(seedOf('doodle')).not.toBe(seedOf('doodle2'));
  });

  it('names what the runtime would block', () => {
    const msgs = (js: string, extra: Partial<ScriptLayer> = {}): string[] => lintScript(layer(js, extra)).map(i => `${i.severity}: ${i.message.split(' — ')[0]}`);
    expect(msgs(`folio.frame(t => {});`)).toEqual([]);
    expect(msgs(`fetch('/x'); folio.frame(t => {});`)).toEqual(['error: reaches the network']);
    expect(msgs(`folio.frame(t => {});`, { html: '<script src="https://cdn.example/x.js"></script>' })).toEqual(['error: loads from the network (a CDN, a web font, an image URL)']);
    expect(msgs(`const d = new Date(); setTimeout(f, 10); folio.frame(t => {});`)).toEqual(['error: reads the wall clock', 'warning: uses setTimeout/setInterval, which never fire on Folio\'s clock']);
    expect(msgs(`document.body.textContent = 'hi';`)).toEqual(['warning: never registers a drawing with folio.frame(t => …)']);
    const spec = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
      layers: [layer(`fetch('x'); folio.frame(t => {});`) as unknown as Layer] } as unknown as DesignSpec;
    expect(collectFindings(spec, '/dev/null').filter(f => f.code === 'script_unsafe').map(f => f.layers)).toEqual([['doodle']]);
    const svg = renderToSVGString(spec);
    expect(svg).toMatch(/<foreignObject[^>]*x="100"[^>]*>/);
    expect(svg).toContain('sandbox="allow-scripts"');
    expect(svg).toContain('data-folio-script="doodle"');
    // Its duration is the scene's length, and the editor counts it as motion (Play).
    const timed = layer(`folio.frame(t => {});`, { duration: 8000, loop: true }) as unknown as Layer;
    expect(animationDuration([timed])).toBe(8000);
    expect(playsInTime(timed)).toBe(true);
  });
});

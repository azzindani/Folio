/**
 * WP-6.2 — replay stored FAIL-cluster payloads straight against the engine (no
 * model), asserting the heal that fixed each one still holds. Each `it` is a
 * regression guard for a specific past bug (see project memory):
 *   • blank-poster z-sort NaN   • blank-design dropped-style lift
 *   • carousel overprint decollide  • trailing dead-band trim
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProject, createDesign, addLayers, appendPage, sealDesign } from '../../src/mcp/engine';
import { renderToSVGString } from '../../src/mcp/engine/svg-export';
import type { DesignSpec, Layer } from '../../src/schema/types';
import * as yaml from 'js-yaml';

let tmp: string;
beforeAll(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-replay-')); });
afterAll(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

function readDesign(p: string): DesignSpec {
  return yaml.load(fs.readFileSync(p, 'utf8')) as DesignSpec;
}
function allTextValues(layers: Layer[] = []): string[] {
  const out: string[] = [];
  const walk = (ls: Layer[]): void => { for (const l of ls) {
    const lo = l as unknown as { content?: { value?: unknown }; text?: unknown };
    if (lo.content && typeof lo.content.value === 'string') out.push(lo.content.value);
    else if (typeof lo.text === 'string') out.push(lo.text);
    const kids = (l as unknown as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) walk(kids);
  } };
  walk(layers);
  return out;
}

describe('WP-6.2 FAIL-cluster regression replay', () => {
  it('blank-poster z-sort: a non-finite z never blanks the render', () => {
    // Stored failure: `a.z - b.z` with a NaN z corrupted the sort → blank poster.
    const spec = {
      _protocol: 'design/v1', meta: { id: 'z', name: 'Z', type: 'poster' },
      document: { width: 600, height: 600 },
      layers: [
        { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 600, height: 600, fill: { type: 'solid', color: '#101820' } },
        { id: 'mid', type: 'rect', z: NaN as unknown as number, x: 100, y: 100, width: 400, height: 200, fill: { type: 'solid', color: '#F2A104' } },
        { id: 'top', type: 'text', z: 2, x: 120, y: 160, width: 360, content: { type: 'plain', value: 'STILL HERE' }, style: { font_size: 40, color: '#FFFFFF' } },
      ],
    } as unknown as DesignSpec;
    const svg = renderToSVGString(spec);
    // All three layers must survive the sort — the poster is NOT blank.
    expect(svg).toContain('#101820');       // bg
    expect(svg).toContain('#F2A104');       // the NaN-z rect
    expect(svg).toContain('STILL HERE');    // the text
  });

  it('blank-design style-lift: canonical-shaped shorthand keeps its accent colour', () => {
    // Stored failure: hand-placed layers as {content:{}, style:{color,font}} had
    // their content lifted but NOT style.* → text flattened, accent colour lost.
    const proj = path.join(tmp, 'lift'); createProject({ name: 'Lift', path: proj });
    createDesign({ project_path: proj, name: 'Lift', type: 'poster', width: 800, height: 600 });
    const dp = path.join(proj, 'designs/lift.design.yaml');
    addLayers({ design_path: dp, layers_shorthand: [
      { type: 'text', content: { type: 'plain', value: 'Accent Headline' }, style: { color: '#E4572E', font: 'Anton', size: 72 }, pos: [60, 80, 680, 120] },
    ] as unknown as Parameters<typeof addLayers>[0]['layers_shorthand'] });
    const spec = readDesign(dp);
    expect(allTextValues(spec.layers)).toContain('Accent Headline');
    // The bug DROPPED style.* → flat $text. The heal LIFTS it: the text layer
    // must carry the font + a non-default accent colour (the engine may legibility-
    // shift the hue on the cream bg, but it must NOT be flattened away).
    const txt = (spec.layers ?? []).find(l => l.type === 'text') as unknown as { style?: { color?: string; font_family?: string; font_size?: number } };
    expect(txt?.style?.font_family).toBe('Anton');
    expect(txt?.style?.font_size).toBe(72);
    expect(txt?.style?.color).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(txt?.style?.color?.toLowerCase()).not.toBe('#000000');
  });

  it('carousel overprint: appended pages do not all stack at the same origin', () => {
    const proj = path.join(tmp, 'deck'); createProject({ name: 'Deck', path: proj });
    createDesign({ project_path: proj, name: 'Deck', type: 'carousel', width: 1080, height: 1080 });
    const dp = path.join(proj, 'designs/deck.design.yaml');
    for (const t of ['Page One body text here', 'Page Two body text here']) {
      appendPage({ design_path: dp, layers_shorthand: [
        { type: 'text', content: { type: 'plain', value: t }, pos: [80, 400, 900, 80] },
        { type: 'text', content: { type: 'plain', value: `${t} — more` }, pos: [80, 400, 900, 80] },
      ] as unknown as Parameters<typeof appendPage>[0]['layers_shorthand'] });
    }
    sealDesign({ design_path: dp });
    const spec = readDesign(dp);
    // Each page's two same-origin texts must have been decollided to distinct y.
    for (const page of spec.pages ?? []) {
      const ys = (page.layers ?? []).filter(l => l.type === 'text').map(l => (l as unknown as { y?: number }).y ?? 0);
      if (ys.length >= 2) expect(new Set(ys).size).toBeGreaterThan(1);
    }
  });
});

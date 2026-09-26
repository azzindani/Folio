import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import yaml from 'js-yaml';
import { inspectDesign } from '../engine-project-tools';
import { patchDesign } from '../engine';
import { ALL_HANDLERS } from '../handlers';
import { TIER1_TOOLS } from '../tier1/registry';

// Found live (Opus 5.5 promo): a script's code, a rule's start, the names and the markers could
// only be read by opening the file outside Folio — inspect listed ids and boxes, nothing more.

let dir = '', file = '';
const JS = 'folio.frame(t => { /* the owl */ });';
const DESIGN = {
  _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 1920, height: 1080, unit: 'px', dpi: 96 },
  names: { Ink: '#1D1B18', Quotes: [{ who: 'A', q: 'x' }] }, markers: { a: 0, b: 4000 }, world: { x: 0, y: 0, width: 3840, height: 1080 }, length_ms: 9000,
  layers: [{ id: 'world', type: 'group', z: 1, locked: true, x: 0, y: 0, width: 3840, height: 1080, layers: [
    { id: '__camera', type: 'group', z: 2, x: 0, y: 0, width: 3840, height: 1080, layers: [
      { id: 'owl', type: 'script', z: 3, x: 100, y: 100, width: 400, height: 400, js: JS, animation: { rule: { preset: 'fade_in', at: 'b-400', duration: 500 } } },
      { id: 'cards', type: 'group', z: 4, x: 0, y: 600, width: 900, height: 200, layers: [], gallery: { items: '=Quotes', template: [{ id: 'q', type: 'text', z: 0, x: 0, y: 0, width: 400, height: 40, content: { type: 'plain', value: '{{q}}' } }] } },
    ] },
  ] }],
};

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-inspect-'));
  file = path.join(dir, 'd.design.yaml');
  fs.writeFileSync(file, yaml.dump(DESIGN));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('manage_design {op:"inspect"} reads back what was written', () => {
  it('returns one layer at any depth as written, with the path patch_design reaches it by', () => {
    const r = inspectDesign({ design_path: file, layer_id: 'owl' }) as unknown as Record<string, unknown>;
    expect(r).toMatchObject({ success: true, type: 'script', parent: '__camera', patch_path: 'layers[id=world].layers[id=__camera].layers[id=owl]' });
    expect(r['layer']).toMatchObject({ js: JS, animation: { rule: { at: 'b-400' } } });
    expect(patchDesign({ design_path: file, selectors: [{ path: `${String(r['patch_path'])}.x`, value: 140 }] }).success).toBe(true);
    expect((inspectDesign({ design_path: file, layer_id: 'owl' }) as unknown as { layer: { x: number } }).layer.x).toBe(140);
  });

  it('lists a group\'s children by id, keeps a gallery whole, and says when the id is not there', () => {
    const g = inspectDesign({ design_path: file, layer_id: '__camera' }) as unknown as { layer: { layers: unknown[] } };
    expect(g.layer.layers).toEqual([{ id: 'owl', type: 'script' }, { id: 'cards', type: 'group' }]);
    const cards = inspectDesign({ design_path: file, layer_id: 'cards' }) as unknown as { layer: { gallery: { items: string } } };
    expect(cards.layer.gallery.items).toBe('=Quotes');
    const none = inspectDesign({ design_path: file, layer_id: 'cards_1_q' });
    expect(none.success).toBe(false);
    expect(String((none as unknown as { hint: string }).hint)).toMatch(/inspect the gallery itself/);
  });

  it('answers the design\'s names, markers, world and length with every inspect', () => {
    const r = inspectDesign({ design_path: file }) as unknown as Record<string, unknown>;
    expect(r).toMatchObject({ names: { Ink: '#1D1B18', Quotes: [{ who: 'A', q: 'x' }] }, markers: { a: 0, b: 4000 }, world: { width: 3840 }, length_ms: 9000 });
  });

  it('is declared on the tool, so a conforming client sends it, and reaches the handler', async () => {
    const tool = TIER1_TOOLS.find(t => t.name === 'manage_design');
    expect(Object.keys((tool?.inputSchema as { properties: Record<string, unknown> }).properties)).toContain('layer_id');
    const r = await ALL_HANDLERS['manage_design']?.({ op: 'inspect', design_path: file, layer_id: 'owl' });
    expect(JSON.stringify(r)).toContain('the owl');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { detachLayers, ruleCounts } from './detach-op';
import { renderToSVGString } from './svg-export';
import { buildAnimatedSVG } from '../../export/svg-animate';
import type { DesignSpec, Layer } from '../../schema/types';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-detach-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

const SPEC = {
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'Detach', type: 'poster', created: '', modified: '' },
  document: { width: 1080, height: 1350 },
  names: { Margin: 80, Accent: '#E4572E' },
  layers: [
    { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#FBF7F0' },
    { id: 'title', type: 'text', z: 2, x: 0, y: 120, width: 900, height: 100, content: { type: 'plain', value: 'Rules, baked' },
      style: { font_size: 72, color: '#141414' }, formulas: { x: '=Margin' },
      animation: { rule: [{ preset: 'rise', at: 0, duration: 600 }, { preset: 'fade_out', at: 3000 }] } },
    { id: 'cards', type: 'group', z: 1, x: 80, y: 400, width: 920, height: 300, layers: [],
      gallery: { items: [{ n: 'One' }, { n: 'Two' }, { n: 'Three' }], gap: 20, template: [
        { id: 'card', type: 'rect', z: 0, x: 0, y: 0, width: 100, height: 100, formulas: { width: '=CellW', height: '=CellH', fill: '=Accent' } },
        { id: 'label', type: 'text', z: 1, x: 20, y: 20, width: 200, height: 40, content: { type: 'plain', value: '{{n}}' }, style: { font_size: 28, color: '#FFFFFF' },
          animation: { rule: { preset: 'fade_in', at: '=Index * 300', duration: 300 } } },
      ] } },
  ],
};
const write = (): string => { const p = path.join(tmpDir, 'd.design.yaml'); fs.writeFileSync(p, yaml.dump(SPEC)); return p; };
const read = (p: string): DesignSpec => yaml.load(fs.readFileSync(p, 'utf-8')) as DesignSpec;
const moving = (s: DesignSpec): string => buildAnimatedSVG(s, { renderSVG: x => renderToSVGString(x) }).svg;

describe('edit_layer op:detach', () => {
  it('bakes every rule into what it draws — the same SVG, still and moving, and no rule left', () => {
    const p = write();
    const was = read(p);
    const r = detachLayers({ design_path: p }) as unknown as { success: boolean; detached: object };
    expect(r.success).toBe(true);
    expect(r.detached).toEqual({ formulas: 1, galleries: 1, rules: 1 });
    const now = read(p);
    expect(ruleCounts(now.layers ?? [])).toEqual({ formulas: 0, galleries: 0, rules: 0 });
    expect(renderToSVGString(now)).toBe(renderToSVGString(was));
    expect(moving(now)).toBe(moving(was));
    const cards = (now.layers ?? []).find(l => l.id === 'cards') as Layer & { layers: Layer[] };
    expect(cards.layers.map(c => c.id)).toEqual(['cards_1', 'cards_2', 'cards_3']);
    expect(Object.keys((now as { animations?: object }).animations ?? {})).toEqual(['title', 'cards_1_label', 'cards_2_label', 'cards_3_label']);
  });

  it('detaches one layer and leaves the others as rules', () => {
    const p = write();
    const r = detachLayers({ design_path: p, layer_id: 'title' }) as unknown as { success: boolean; detached: object };
    expect(r.detached).toEqual({ formulas: 1, galleries: 0, rules: 1 });
    const title = (read(p).layers ?? []).find(l => l.id === 'title') as Layer & { formulas?: object; animation: { rule?: unknown; keyframes: unknown[] } };
    expect(title).toMatchObject({ x: 80 });
    expect(title.formulas).toBeUndefined();
    expect(title.animation.rule).toBeUndefined();
    expect(title.animation.keyframes.length).toBeGreaterThan(2);
    expect(ruleCounts(read(p).layers ?? [])).toEqual({ formulas: 0, galleries: 1, rules: 0 });
  });

  it('never writes the markers a script is handed when drawn', () => {
    const p = path.join(tmpDir, 's.design.yaml');
    fs.writeFileSync(p, yaml.dump({ ...SPEC, markers: { cta: 1000 }, layers: [...SPEC.layers,
      { id: 'doodle', type: 'script', z: 3, x: 0, y: 0, width: 200, height: 200, js: 'folio.frame(t => {});' }] }));
    expect(detachLayers({ design_path: p }).success).toBe(true);
    expect(fs.readFileSync(p, 'utf-8')).not.toContain('script_markers');
  });

  it('says so when there is nothing to detach, or no such layer', () => {
    const p = write();
    expect(detachLayers({ design_path: p, layer_id: 'bg' }).error).toMatch(/Nothing to detach on bg/);
    expect(detachLayers({ design_path: p, layer_ids: ['nope'] }).error).toMatch(/No layer "nope"/);
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { routePatchPath } from './patch-route';
import { patchDesign } from '../engine';
import { readYAML } from './utils';

const spec = (): Record<string, unknown> => ({
  layers: [{
    id: 'world', type: 'group', locked: true, layers: [
      { id: 'h1', type: 'text', content: { type: 'plain', value: 'FILL IT' }, style: { font_size: 160, letter_spacing: 10 } },
      { id: 'ico', type: 'icon', name: 'clipboard-x', size: 70 },
      { id: 'bare', type: 'text', text: 'no content object' },
      { id: 'r', type: 'rect', color: '#000' },
    ],
  }],
});

describe('routePatchPath', () => {
  it('sends typography on a text layer into style, by its canonical name', () => {
    const s = spec();
    expect(routePatchPath(s, 'layers[0].layers[0].letter_spacing'))
      .toEqual({ path: 'layers[0].layers[0].style.letter_spacing', from: 'layers[0].layers[0].letter_spacing' });
    expect(routePatchPath(s, 'layers[0].layers[0].size').path).toBe('layers[0].layers[0].style.font_size');
    expect(routePatchPath(s, 'layers[0].layers[0].track').path).toBe('layers[0].layers[0].style.letter_spacing');
  });

  it('sends words to content.value and an icon swap to name', () => {
    const s = spec();
    expect(routePatchPath(s, 'layers[0].layers[0].text').path).toBe('layers[0].layers[0].content.value');
    expect(routePatchPath(s, 'layers[id=world].layers[id=ico].icon').path).toBe('layers[id=world].layers[id=ico].name');
  });

  it('leaves paths that already name the rendered field, and non-text layers, alone', () => {
    const s = spec();
    for (const p of ['layers[0].layers[0].style.letter_spacing', 'layers[0].layers[0].y', 'layers[0].layers[3].color',
      'layers[0].layers[1].name', 'layers[0].layers[2].text', 'layers[0].locked']) {
      expect(routePatchPath(s, p)).toEqual({ path: p });
    }
  });

  it('creates style when routing typography into a text layer without one', () => {
    const s = spec();
    expect(routePatchPath(s, 'layers[0].layers[2].font_size').path).toBe('layers[0].layers[2].style.font_size');
    const bare = ((s['layers'] as Record<string, unknown>[])[0]['layers'] as Record<string, unknown>[])[2];
    expect(bare['style']).toEqual({});
  });
});

describe('patch_design routes a shadowed key (r1 benchmark)', () => {
  let dir = '';
  let file = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-patch-route-'));
    file = path.join(dir, 'd.design.yaml');
    fs.writeFileSync(file, JSON.stringify({
      _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
      document: { width: 1080, height: 1920, unit: 'px', dpi: 96 }, ...spec(),
    }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('changes what renders inside a locked group, and says where it wrote', () => {
    const r = patchDesign({ design_path: file, selectors: [
      { path: 'layers[0].layers[0].letter_spacing', value: -3 },
      { path: 'layers[0].layers[1].icon', value: 'clipboard' },
    ] });
    expect(r.success).toBe(true);
    expect(r.routed).toEqual([
      { from: 'layers[0].layers[0].letter_spacing', to: 'layers[0].layers[0].style.letter_spacing' },
      { from: 'layers[0].layers[1].icon', to: 'layers[0].layers[1].name' },
    ]);
    const kids = (readYAML<{ layers: { layers: Record<string, unknown>[] }[] }>(file)).layers[0].layers;
    expect(kids[0]['style']).toEqual({ font_size: 160, letter_spacing: -3 });
    expect(kids[0]['letter_spacing']).toBeUndefined();
    expect(kids[1]['name']).toBe('clipboard');
    expect(kids[1]['icon']).toBeUndefined();
  });

  it('dry_run reports the route without writing', () => {
    const before = fs.readFileSync(file, 'utf8');
    const r = patchDesign({ design_path: file, dry_run: true, selectors: [{ path: 'layers[0].layers[0].letter_spacing', value: -3 }] });
    expect(r.would_patch).toEqual(['layers[0].layers[0].style.letter_spacing']);
    expect(r.routed).toHaveLength(1);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });
});

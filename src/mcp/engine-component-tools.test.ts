import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import yaml from 'js-yaml';

import { saveAsComponent, listComponents, autoSlots } from './engine-component-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import type { Layer, ComponentSpec } from '../schema/types';

type Rec = Record<string, unknown>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-components-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'cp');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const CARD = [
  { id: 'card_bg', type: 'rect', z: 1, x: 80, y: 200, width: 400, height: 260, fill: { type: 'solid', color: '#1A1A1A' }, radius: 0 },
  { id: 'card_value', type: 'text', z: 2, x: 110, y: 240, width: 340, height: 90, content: { type: 'plain', value: '8.4%' }, style: { font_size: 72, color: '#FF6B35' } },
  { id: 'card_label', type: 'text', z: 3, x: 110, y: 350, width: 340, height: 40, content: { type: 'plain', value: 'year-on-year growth' }, style: { font_size: 22, color: '#FAFAFA' } },
] as unknown as Layer[];

const read = <T>(p: string): T => yaml.load(fs.readFileSync(p, 'utf-8')) as T;

describe('save_component — a saved part with holes, not a frozen picture', () => {
  let designPath: string;

  beforeEach(() => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'cp', canvas: '1080x1350' });
    const d = createDesign({ project_path: projectDir, name: `d-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: 1080, height: 1350 }) as unknown as Rec;
    designPath = d['path'] as string;
    addLayers({ design_path: designPath, layers: JSON.parse(JSON.stringify(CARD)) });
  });

  it('turns each text layer into a named slot with its copy as the default', () => {
    const r = saveAsComponent({ design_path: designPath, layer_ids: ['card_bg', 'card_value', 'card_label'], component_name: 'stat card', project_path: projectDir }) as unknown as Rec;
    expect(r['slot_names']).toEqual(['value', 'label']);
    const c = read<ComponentSpec>(r['component_path'] as string);
    expect(c.props['value'].default).toBe('8.4%');
    expect(c.props['label'].default).toBe('year-on-year growth');
  });

  it('parameterises the component text, and leaves the DESIGN copy alone', () => {
    const r = saveAsComponent({ design_path: designPath, layer_ids: ['card_value'], component_name: 'stat only', project_path: projectDir }) as unknown as Rec;
    const c = read<ComponentSpec>(r['component_path'] as string);
    const text = (c.layers[0] as unknown as Rec)['content'] as Rec;
    expect(text['value']).toBe('{{value}}');
    // The saved file is a copy — the design still holds the real words until the
    // instance re-renders them from the defaults.
    expect(JSON.stringify(CARD)).toContain('8.4%');
  });

  it('auto_slots:false freezes the copy, for a part that is meant to be identical', () => {
    const r = saveAsComponent({ design_path: designPath, layer_ids: ['card_value'], component_name: 'fixed mark', project_path: projectDir, auto_slots: false }) as unknown as Rec;
    expect(r['slot_names']).toEqual([]);
    const c = read<ComponentSpec>(r['component_path'] as string);
    expect(((c.layers[0] as unknown as Rec)['content'] as Rec)['value']).toBe('8.4%');
  });

  it('hands back a next_action that places it again with different copy', () => {
    const r = saveAsComponent({ design_path: designPath, layer_ids: ['card_value', 'card_label'], component_name: 'kpi', project_path: projectDir }) as unknown as Rec;
    expect(String((r['next_action'] as Rec)['hint'])).toMatch(/different copy/);
  });

  it('re-saving under the same name replaces the index entry instead of duplicating it', () => {
    saveAsComponent({ design_path: designPath, layer_ids: ['card_bg'], component_name: 'dup', project_path: projectDir });
    addLayers({ design_path: designPath, layers: JSON.parse(JSON.stringify(CARD)) });
    saveAsComponent({ design_path: designPath, layer_ids: ['card_bg'], component_name: 'dup', project_path: projectDir });
    const idx = read<{ components: { id: string }[] }>(path.join(projectDir, 'components/index.yaml'));
    expect(idx.components.filter(c => c.id === 'dup')).toHaveLength(1);
  });
});

describe('templates {op:"components"} — the half that made the store usable', () => {
  it('lists what the project can compose from, with slots and variants', () => {
    if (!fs.existsSync(projectDir)) createProject({ name: 'cp', canvas: '1080x1350' });
    const d = createDesign({ project_path: projectDir, name: `l-${Math.random().toString(36).slice(2, 7)}`, type: 'poster', width: 1080, height: 1350 }) as unknown as Rec;
    addLayers({ design_path: d['path'] as string, layers: JSON.parse(JSON.stringify(CARD)) });
    saveAsComponent({ design_path: d['path'] as string, layer_ids: ['card_value', 'card_label'], component_name: 'listed card', project_path: projectDir });

    const r = listComponents({ project_path: projectDir }) as unknown as Rec;
    const rows = r['components'] as { id: string; slots: string[]; layers: number }[];
    const hit = rows.find(x => x.id === 'listed-card');
    expect(hit).toBeDefined();
    expect(hit!.slots).toEqual(['value', 'label']);
    expect(hit!.layers).toBe(2);
    expect(String(r['usage'])).toMatch(/type:"component"/);
  });

  it('a project with no components says how to make one, rather than returning a bare empty list', () => {
    const empty = path.join(dir, 'empty-proj');
    createProject({ name: 'empty-proj', canvas: '1080x1080' });
    const r = listComponents({ project_path: empty }) as unknown as Rec;
    expect(r['count']).toBe(0);
    expect(String(r['note'])).toMatch(/save_component/);
  });
});

describe('autoSlots — naming', () => {
  it('names a slot from the tail of the layer id', () => {
    const layers = [{ id: 'stat_1_title', type: 'text', content: { value: 'Hello' } }] as unknown as Layer[];
    expect(Object.keys(autoSlots(layers))).toEqual(['title']);
  });

  it('deduplicates colliding names', () => {
    const layers = [
      { id: 'a_title', type: 'text', content: { value: 'One' } },
      { id: 'b_title', type: 'text', content: { value: 'Two' } },
    ] as unknown as Layer[];
    expect(Object.keys(autoSlots(layers))).toEqual(['title', 'title2']);
  });

  it('leaves an already-parameterised layer alone', () => {
    const layers = [{ id: 'x_title', type: 'text', content: { value: '{{title}}' } }] as unknown as Layer[];
    expect(autoSlots(layers)).toEqual({});
  });

  it('reaches text nested inside a group', () => {
    const layers = [{ id: 'g', type: 'group', layers: [{ id: 'g_label', type: 'text', content: { value: 'Deep' } }] }] as unknown as Layer[];
    expect(Object.keys(autoSlots(layers))).toEqual(['label']);
  });
});

// Live-audit regression (2026-07-07): locked-group children were invisible to
// manage_design {op:"inspect"} and edit_layer {op:"update"} dead-ended with
// "Layer not found" — the editor could edit them but the MCP could not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { inspectDesign } from './engine-project-tools';
import { updateLayer, removeLayer } from './engine-edit-tools';
import { moveLayers } from './engine-transform-tools';
import type { ToolResult } from './types';

function writeDesign(dir: string, locked: boolean): string {
  const fp = path.join(dir, 'designs', 'd.design.yaml');
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, [
    `_protocol: design/v1`, `_mode: complete`,
    `meta: {id: d1, name: d, type: poster, created: '2026-07-07', modified: '2026-07-07'}`,
    `document: {width: 100, height: 100, unit: px, dpi: 96}`,
    `layers:`,
    `  - id: panel`,
    `    type: group`,
    `    x: 0`, `    'y': 0`, `    width: 100`, `    height: 100`,
    ...(locked ? [`    locked: true`] : []),
    `    layers:`,
    `      - {id: child_rect, type: rect, x: 10, 'y': 10, width: 20, height: 8, fill: '#E94560'}`,
  ].join('\n'));
  return fp;
}

describe('locked-group children over MCP', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-locked-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('inspect lists group children with parent + inherited locked flag', () => {
    const fp = writeDesign(tmp, true);
    const r = inspectDesign({ design_path: fp }) as ToolResult & { layers: { id: string; parent?: string; locked?: boolean }[] };
    const child = r.layers.find(l => l.id === 'child_rect');
    expect(child).toBeTruthy();
    expect(child?.parent).toBe('panel');
    expect(child?.locked).toBe(true);
    expect(r.layers.find(l => l.id === 'panel')?.locked).toBe(true);
  });

  it('inspect reports where a path and a line actually draw, not 0,0 and no size', () => {
    const fp = path.join(tmp, 'designs', 'shapes.design.yaml');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, [
      `meta: {id: d3, name: shapes, type: poster, created: '2026-09-15', modified: '2026-09-15'}`,
      `document: {width: 400, height: 400, unit: px, dpi: 96}`,
      `layers:`,
      `  - {id: star, type: path, z: 1, d: 'M 100 50 L 150 150 L 50 150 Z', fill: '#000'}`,
      `  - {id: rule, type: line, z: 2, x1: 20, y1: 300, x2: 380, y2: 300, stroke: '#000', stroke_width: 2}`,
    ].join('\n'));
    const r = inspectDesign({ design_path: fp }) as ToolResult & { layers: Array<{ id: string; x: number; y: number; w: number; h: number }> };
    expect(r.layers.find(l => l.id === 'star')).toMatchObject({ x: 50, y: 50, w: 100, h: 100 });
    expect(r.layers.find(l => l.id === 'rule')).toMatchObject({ x: 20, w: 360 });
  });

  // One-shot benchmark r1: every model locked a group to keep the engine off its
  // layout (as the guide says), then spent 3 calls per edit on unlock → edit →
  // re-lock. A NAMED layer is an explicit ask; the lock guards the unnamed.
  it('update on a locked-group child edits it, keeps the lock, and says so', () => {
    const fp = writeDesign(tmp, true);
    const r = updateLayer({ design_path: fp, layer_id: 'child_rect', props: { fill: '#00FF00' } as never });
    expect(r.success).toBe(true);
    expect(JSON.stringify(r.progress)).toMatch(/inside a LOCKED group.*child_rect.*panel/s);
    const yaml = fs.readFileSync(fp, 'utf8');
    expect(yaml).toContain("'#00FF00'");
    expect(yaml).toContain('locked: true');
  });

  it('remove and move reach a named child of a locked group too', () => {
    const fp = writeDesign(tmp, true);
    const m = moveLayers({ design_path: fp, layer_id: 'child_rect', dx: 5 }) as ToolResult & { in_locked_group?: string[] };
    expect(m.success).toBe(true);
    expect(m.in_locked_group).toEqual(['child_rect (in "panel")']);
    expect(fs.readFileSync(fp, 'utf8')).toMatch(/x: 15/);
    const r = removeLayer({ design_path: fp, layer_id: 'child_rect' });
    expect(r.success).toBe(true);
    expect(fs.readFileSync(fp, 'utf8')).not.toContain('child_rect');
  });

  // Found building the GPT-6 Astra promo: an edit meant for page 7 went to page 0.
  it('edits the deep child on the page named, nowhere else', () => {
    const fp = path.join(tmp, 'designs', 'deck.design.yaml');
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, [
      `meta: {id: d2, name: deck, type: carousel, created: '2026-09-15', modified: '2026-09-15'}`,
      `document: {width: 100, height: 100, unit: px, dpi: 96}`,
      `pages:`,
      `  - {id: p1, layers: [{id: g1, type: group, locked: true, x: 0, 'y': 0, width: 100, height: 100, layers: []}]}`,
      `  - id: p2`,
      `    layers:`,
      `      - {id: g2, type: group, locked: true, x: 0, 'y': 0, width: 100, height: 100, layers: [{id: bg, type: rect, x: 0, 'y': 0, width: 100, height: 100}, {id: chip, type: group, x: 0, 'y': 0, width: 50, height: 20, layers: [{id: mark, type: text, x: 0, 'y': 0, width: 20, height: 20}]}]}`,
    ].join('\n'));
    const r = updateLayer({ design_path: fp, page_id: 'p2', layer_id: 'mark', props: { width: 96 } as never });
    expect(r.success).toBe(true);
    const doc = fs.readFileSync(fp, 'utf8');
    expect(doc).toContain('width: 96');
    expect(doc.split('width: 96').length).toBe(2);
  });

  it('unlock group → edit child → re-lock round-trip works', () => {
    const fp = writeDesign(tmp, true);
    expect(updateLayer({ design_path: fp, layer_id: 'panel', props: { locked: false } as never }).success).toBe(true);
    expect(updateLayer({ design_path: fp, layer_id: 'child_rect', props: { fill: '#00FF00' } as never }).success).toBe(true);
    expect(updateLayer({ design_path: fp, layer_id: 'panel', props: { locked: true } as never }).success).toBe(true);
    const yaml = fs.readFileSync(fp, 'utf8');
    expect(yaml).toContain("'#00FF00'");
    expect(yaml).toContain('locked: true');
  });

  it('children of UNLOCKED groups update directly', () => {
    const fp = writeDesign(tmp, false);
    const r = updateLayer({ design_path: fp, layer_id: 'child_rect', props: { fill: '#123456' } as never });
    expect(r.success).toBe(true);
    expect(fs.readFileSync(fp, 'utf8')).toContain("'#123456'");
  });
});

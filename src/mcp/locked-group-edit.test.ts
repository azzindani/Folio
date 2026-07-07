// Live-audit regression (2026-07-07): locked-group children were invisible to
// manage_design {op:"inspect"} and edit_layer {op:"update"} dead-ended with
// "Layer not found" — the editor could edit them but the MCP could not.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { inspectDesign } from './engine-project-tools';
import { updateLayer } from './engine-edit-tools';
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

  it('update on a locked-group child refuses with the exact unlock recipe', () => {
    const fp = writeDesign(tmp, true);
    const r = updateLayer({ design_path: fp, layer_id: 'child_rect', props: { fill: '#00FF00' } as never });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/LOCKED group "panel"/);
    expect(r.hint).toMatch(/props:\{locked:false\}/);
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

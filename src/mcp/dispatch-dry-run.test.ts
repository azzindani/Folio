// One-shot benchmark r1: edit_layer {op:"update", dry_run:true} ignored the
// flag and wrote. A dry run must never write; only patch_spec can preview.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { dispatchEditLayer } from './dispatch';
import type { ToolResult } from './types';

describe('edit_layer dry_run', () => {
  let dir = '';
  let file = '';
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-dry-'));
    file = path.join(dir, 'd.design.yaml');
    fs.writeFileSync(file, JSON.stringify({
      _protocol: 'design/v1', meta: { id: 'd', name: 'd', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
      document: { width: 100, height: 100, unit: 'px', dpi: 96 },
      layers: [{ id: 'r', type: 'rect', z: 0, x: 10, y: 10, width: 20, height: 20, fill: '#000000' }],
    }));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('refuses on ops that cannot preview, and leaves the file as it was', async () => {
    const before = fs.readFileSync(file, 'utf8');
    for (const op of ['update', 'remove', 'move']) {
      const r = await dispatchEditLayer({ op, design_path: file, layer_id: 'r', props: { fill: '#FF0000' }, dx: 5, dry_run: true }) as ToolResult;
      expect(r.success, op).toBe(false);
      expect(String(r.error)).toContain('nothing was written');
    }
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
  });

  it('still applies the edit when dry_run is absent or false', async () => {
    const r = await dispatchEditLayer({ op: 'update', design_path: file, layer_id: 'r', props: { fill: '#FF0000' }, dry_run: false }) as ToolResult;
    expect(r.success).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toContain('#FF0000');
  });
});

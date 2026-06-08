import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { diagnoseDesign, renderPreview, alignLayers } from '../engine';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-diag-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function writeDesign(layers: unknown[]): string {
  const p = path.join(tmpDir, 'd.design.yaml');
  fs.writeFileSync(p, yaml.dump({
    _protocol: 'design/v1',
    meta: { id: 'd', name: 'Diag', type: 'poster' },
    document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
    theme: { ref: 'editorial-cream' },
    layers,
  }), 'utf-8');
  return p;
}

describe('diagnose_design', () => {
  it('reports off-canvas + collision findings with counts', () => {
    const p = writeDesign([
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'stray', type: 'rect', z: 1, x: -40, y: 0, width: 200, height: 200, fill: { type: 'solid', color: '#000' } },
      { id: 'a', type: 'text', z: 2, x: 100, y: 100, width: 300, height: 80, content: { type: 'plain', value: 'a' }, style: { font_size: 40, color: '#000' } },
      { id: 'b', type: 'text', z: 3, x: 120, y: 110, width: 300, height: 80, content: { type: 'plain', value: 'b' }, style: { font_size: 40, color: '#000' } },
    ]);
    const r = diagnoseDesign({ design_path: p });
    expect(r.success).toBe(true);
    const counts = r['counts'] as { errors: number; warnings: number };
    expect(counts.errors).toBeGreaterThanOrEqual(1);
    const codes = (r['findings'] as { code: string }[]).map(f => f.code);
    expect(codes).toContain('off_canvas');
    expect(codes).toContain('collision');
  });

  it('reports ok:true on a clean design', () => {
    const p = writeDesign([
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'h', type: 'text', z: 1, x: 96, y: 120, width: 880, height: 130, content: { type: 'plain', value: 'Headline' }, style: { font_size: 96, color: '#0A0A0A' } },
    ]);
    expect(diagnoseDesign({ design_path: p })['ok']).toBe(true);
  });

  it('fails cleanly when the design is missing', () => {
    expect(diagnoseDesign({ design_path: path.join(tmpDir, 'nope.design.yaml') }).success).toBe(false);
  });
});

describe('render_preview', () => {
  it('returns an inline PNG image attachment', () => {
    const p = writeDesign([
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'pattern', pattern: 'halftone', fg: '#1A1A1A', bg: '#FAF5EC' } },
    ]);
    const r = renderPreview({ design_path: p, scale: 1 });
    expect(r.success).toBe(true);
    const att = r['_attachments'] as { type: string; mimeType: string; data: string }[];
    expect(att[0].type).toBe('image');
    expect(att[0].mimeType).toBe('image/png');
    expect(att[0].data.length).toBeGreaterThan(100);
  });
});

describe('align_layers', () => {
  it('left-aligns a set of layers and writes the file', () => {
    const p = writeDesign([
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'r1', type: 'rect', z: 1, x: 100, y: 100, width: 80, height: 80, fill: { type: 'solid', color: '#B8543C' } },
      { id: 'r2', type: 'rect', z: 2, x: 137, y: 200, width: 80, height: 80, fill: { type: 'solid', color: '#3F5E4A' } },
    ]);
    const r = alignLayers({ design_path: p, layer_ids: ['r1', 'r2'], operation: 'left' });
    expect(r.success).toBe(true);
    const out = yaml.load(fs.readFileSync(p, 'utf-8')) as { layers: { id: string; x: number }[] };
    const xs = out.layers.filter(l => l.id === 'r1' || l.id === 'r2').map(l => l.x);
    expect(xs[0]).toBe(xs[1]); // both snapped to the same (min) left edge
    expect(xs[0]).toBe(100);
  });

  it('snaps to an 8px grid', () => {
    const p = writeDesign([
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#FAF5EC' } },
      { id: 'r1', type: 'rect', z: 1, x: 103, y: 99, width: 80, height: 80, fill: { type: 'solid', color: '#000' } },
    ]);
    alignLayers({ design_path: p, layer_ids: ['r1'], operation: 'snap_grid', grid: 8 });
    const out = yaml.load(fs.readFileSync(p, 'utf-8')) as { layers: { id: string; x: number; y: number }[] };
    const r1 = out.layers.find(l => l.id === 'r1')!;
    expect(r1.x % 8).toBe(0);
    expect(r1.y % 8).toBe(0);
  });
});

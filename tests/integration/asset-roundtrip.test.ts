/**
 * WP-6.1 — asset round-trip integration. Exercises the real engine asset path
 * end to end against a temp project: add (MCP op) → list → place in a design →
 * export resolver embeds the bytes (no silent blank) → delete → resolver now
 * emits a placeholder + a NOTE (no silent blank). No mocks, real disk I/O.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assetAdd, assetList, assetDelete } from '../../src/mcp/engine/assets';
import { resolveImageAssets } from '../../src/mcp/engine/asset-resolve';
import type { DesignSpec } from '../../src/schema/types';

// A real 1×1 PNG (bytes sniffable as image/png by the resolver).
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let projectDir: string;
let designPath: string;

function fieldsOf(r: { [k: string]: unknown }): Record<string, unknown> { return r as Record<string, unknown>; }

function designWithImage(src: string): DesignSpec {
  return {
    _protocol: 'design/v1',
    meta: { id: 'rt', name: 'Roundtrip', type: 'poster' },
    document: { width: 400, height: 400 },
    layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 400, height: 400, fill: { type: 'solid', color: '#fff' } },
      { id: 'photo', type: 'image', z: 1, x: 20, y: 20, width: 200, height: 200, src },
    ],
  } as unknown as DesignSpec;
}

describe('WP-6.1 asset round-trip', () => {
  beforeAll(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-rt-'));
    fs.writeFileSync(path.join(projectDir, 'project.yaml'), 'name: rt\n');
    fs.mkdirSync(path.join(projectDir, 'designs'), { recursive: true });
    designPath = path.join(projectDir, 'designs', 'rt.design.yaml');
    fs.writeFileSync(designPath, '');
  });
  afterAll(() => { fs.rmSync(projectDir, { recursive: true, force: true }); });

  it('add → file on disk + manifest entry', () => {
    const r = fieldsOf(assetAdd({ project_path: projectDir, name: 'team.png', data: `data:image/png;base64,${PNG_B64}` }));
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'assets', 'images', 'team.png'))).toBe(true);
  });

  it('list → shows the uploaded asset with its path', () => {
    const r = fieldsOf(assetList({ project_path: projectDir }));
    expect(r.success).toBe(true);
    const assets = r.assets as Array<{ path: string; kind: string }>;
    expect(assets.some(a => a.path === 'assets/images/team.png' && a.kind === 'images')).toBe(true);
  });

  it('export resolver EMBEDS the bytes (no silent blank)', () => {
    const spec = designWithImage('assets/images/team.png');
    const notes = resolveImageAssets(spec, designPath, projectDir);
    const img = spec.layers![1] as unknown as { src: string };
    expect(img.src.startsWith('data:image/png;base64,')).toBe(true);
    expect(img.src.length).toBeGreaterThan(60);
    expect(notes).toHaveLength(0);
  });

  it('delete → asset gone from disk + list', () => {
    const r = fieldsOf(assetDelete({ project_path: projectDir, asset_path: 'assets/images/team.png' }));
    expect(r.success).toBe(true);
    expect(fs.existsSync(path.join(projectDir, 'assets', 'images', 'team.png'))).toBe(false);
    const list = fieldsOf(assetList({ project_path: projectDir }));
    expect((list.assets as Array<{ path: string }>).some(a => a.path === 'assets/images/team.png')).toBe(false);
  });

  it('resolver after delete → placeholder + NOTE (never a silent blank)', () => {
    const spec = designWithImage('assets/images/team.png');
    const notes = resolveImageAssets(spec, designPath, projectDir);
    const img = spec.layers![1] as unknown as { src: string };
    expect(img.src).toBe('');                         // blanked
    expect(notes.length).toBeGreaterThan(0);          // but NOT silently
    expect(notes[0]).toMatch(/not found|placeholder/i);
  });

  it('a remote URL never silently blanks — it explains the embed path', () => {
    const spec = designWithImage('https://example.com/x.png');
    const notes = resolveImageAssets(spec, designPath, projectDir);
    expect(notes.some(n => /server exports cannot fetch|asset_add/i.test(n))).toBe(true);
  });
});

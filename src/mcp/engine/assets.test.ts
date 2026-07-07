import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sanitizeAssetName, ingestAsset, assetAdd, assetList, assetDelete, AssetError, readAssetManifest } from './assets';

// canonical valid 1×1 transparent PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
const PNG_URI = `data:image/png;base64,${PNG_B64}`;

function makeProject(root: string, name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'),
    `_protocol: project/v1\nmeta:\n  name: ${name}\nassets:\n  fonts: []\n  images: []\n`);
  return dir;
}

describe('assets', () => {
  let tmp: string;
  let proj: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-assets-')); proj = makeProject(tmp, 'p1'); });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    delete process.env['FOLIO_MAX_ASSET_BYTES'];
    delete process.env['FOLIO_MAX_ASSETS_TOTAL'];
  });

  describe('sanitizeAssetName', () => {
    it('strips directories and dangerous chars', () => {
      expect(sanitizeAssetName('../../etc/passwd.png')?.name).toBe('passwd.png');
      expect(sanitizeAssetName('My Team Photo.JPG')?.name).toBe('my-team-photo.jpg');
    });
    it('rejects disallowed extensions and bare extensions', () => {
      expect(sanitizeAssetName('run.exe')).toBeNull();
      expect(sanitizeAssetName('script.js')).toBeNull();
      expect(sanitizeAssetName('.png')).toBeNull();
    });
    it('maps extensions to kinds', () => {
      expect(sanitizeAssetName('a.woff2')?.kind).toBe('fonts');
      expect(sanitizeAssetName('a.webp')?.kind).toBe('images');
    });
  });

  describe('ingestAsset', () => {
    it('writes the file and a manifest entry with dimensions', () => {
      const { entry, warnings } = ingestAsset({ projectDir: proj, name: 'dot.png', dataUri: PNG_URI });
      expect(warnings).toEqual([]);
      expect(entry.path).toBe('assets/images/dot.png');
      expect(entry.width).toBe(1);
      expect(entry.height).toBe(1);
      expect(fs.existsSync(path.join(proj, entry.path))).toBe(true);
      const manifest = readAssetManifest(proj);
      expect(manifest.images?.map(e => e.path)).toContain('assets/images/dot.png');
    });
    it('trusts the data: URI mime over a mismatched filename extension', () => {
      const { entry, warnings } = ingestAsset({ projectDir: proj, name: 'photo.jpg', dataUri: PNG_URI });
      expect(entry.path).toBe('assets/images/photo.png');
      expect(warnings.join(' ')).toMatch(/did not match/);
    });
    it('enforces the per-file cap', () => {
      process.env['FOLIO_MAX_ASSET_BYTES'] = '10';
      expect(() => ingestAsset({ projectDir: proj, name: 'dot.png', dataUri: PNG_URI }))
        .toThrowError(AssetError);
    });
    it('enforces the project quota', () => {
      process.env['FOLIO_MAX_ASSETS_TOTAL'] = '10';
      expect(() => ingestAsset({ projectDir: proj, name: 'dot.png', dataUri: PNG_URI }))
        .toThrowError(/quota/i);
    });
    it('strips scripts from svg assets', () => {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" onload="alert(1)"><script>alert(2)</script><rect width="10" height="10" fill="#333"/></svg>`;
      const uri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
      const { entry, warnings } = ingestAsset({ projectDir: proj, name: 'icon.svg', dataUri: uri });
      const written = fs.readFileSync(path.join(proj, entry.path), 'utf8');
      expect(written).not.toMatch(/<script|onload/i);
      expect(warnings.join(' ')).toMatch(/stripped/);
      expect(entry.width).toBe(10);
      expect(entry.dominant_colors).toContain('#333333');
    });
    it('copies from an in-sandbox source path', () => {
      const src = path.join(tmp, 'up.png');
      fs.writeFileSync(src, Buffer.from(PNG_B64, 'base64'));
      const { entry } = ingestAsset({ projectDir: proj, name: 'up.png', sourcePath: src });
      expect(fs.existsSync(path.join(proj, entry.path))).toBe(true);
    });
    it('replaces an existing asset with a snapshot + warning', () => {
      ingestAsset({ projectDir: proj, name: 'dot.png', dataUri: PNG_URI });
      const { warnings } = ingestAsset({ projectDir: proj, name: 'dot.png', dataUri: PNG_URI });
      expect(warnings.join(' ')).toMatch(/replaced/);
      expect(readAssetManifest(proj).images?.filter(e => e.path.endsWith('dot.png'))).toHaveLength(1);
    });
  });

  describe('assetAdd / assetList / assetDelete (ToolResult)', () => {
    it('assetAdd returns the entry + a placeable layer stub', () => {
      const r = assetAdd({ project_path: proj, name: 'dot.png', data: PNG_URI, alt: 'a dot' }) as unknown as
        { success: boolean; asset: { path: string; alt?: string }; layer_stub: { src: string; type: string }; next_action: { tool: string } };
      expect(r.success).toBe(true);
      expect(r.asset.path).toBe('assets/images/dot.png');
      expect(r.asset.alt).toBe('a dot');
      expect(r.layer_stub.src).toBe('assets/images/dot.png');
      expect(r.next_action.tool).toBe('add_layers');
    });
    it('assetList merges manifest entries with orphan files on disk', () => {
      assetAdd({ project_path: proj, name: 'dot.png', data: PNG_URI });
      const orphan = path.join(proj, 'assets/images/orphan.png');
      fs.mkdirSync(path.dirname(orphan), { recursive: true });
      fs.writeFileSync(orphan, Buffer.from(PNG_B64, 'base64'));
      const r = assetList({ project_path: proj }) as unknown as { success: boolean; assets: { path: string }[] };
      expect(r.success).toBe(true);
      expect(r.assets.map(a => a.path).sort()).toEqual(['assets/images/dot.png', 'assets/images/orphan.png']);
    });
    it('assetList filters by search', () => {
      assetAdd({ project_path: proj, name: 'dot.png', data: PNG_URI });
      assetAdd({ project_path: proj, name: 'logo.png', data: PNG_URI });
      const r = assetList({ project_path: proj, search: 'logo' }) as unknown as { assets: { path: string }[] };
      expect(r.assets).toHaveLength(1);
      expect(r.assets[0].path).toContain('logo');
    });
    it('assetDelete soft-deletes to .trash and cleans the manifest', () => {
      assetAdd({ project_path: proj, name: 'dot.png', data: PNG_URI });
      const r = assetDelete({ project_path: proj, asset_path: 'assets/images/dot.png' }) as unknown as { success: boolean; trash_path: string };
      expect(r.success).toBe(true);
      expect(fs.existsSync(r.trash_path)).toBe(true);
      expect(fs.existsSync(path.join(proj, 'assets/images/dot.png'))).toBe(false);
      expect(readAssetManifest(proj).images ?? []).toHaveLength(0);
    });
    it('assetDelete rejects paths outside assets/', () => {
      const r = assetDelete({ project_path: proj, asset_path: '../project.yaml' }) as unknown as { success: boolean };
      expect(r.success).toBe(false);
    });
    it('errors cleanly on a missing project', () => {
      const r = assetAdd({ project_path: path.join(tmp, 'nope'), name: 'a.png', data: PNG_URI }) as unknown as { success: boolean };
      expect(r.success).toBe(false);
    });
  });
});

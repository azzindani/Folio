import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { sanitizeAssetName, ingestAsset, assetAdd, assetList, assetDelete, assetMove, sanitizeFolder, parseAssetPath, AssetError, readAssetManifest } from './assets';

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

  describe('folders', () => {
    it('sanitizeFolder keeps one safe segment and refuses traversal', () => {
      expect(sanitizeFolder('Power Automate')).toBe('power-automate');
      expect(sanitizeFolder('a/b/c')).toBe('a');
      expect(sanitizeFolder('../../etc')).toBe('');
      expect(sanitizeFolder('..')).toBe('');
      expect(sanitizeFolder(undefined)).toBe('');
    });

    it('parseAssetPath reads both flat and foldered paths', () => {
      expect(parseAssetPath('assets/images/a.png')).toEqual({ kind: 'images', folder: '', name: 'a.png' });
      expect(parseAssetPath('assets/images/shoot/a.png')).toEqual({ kind: 'images', folder: 'shoot', name: 'a.png' });
      expect(parseAssetPath('assets/images/a/b/c.png')).toBeNull();
      expect(parseAssetPath('../project.yaml')).toBeNull();
    });

    it('assetAdd stores into a folder and records it', () => {
      const r = assetAdd({ project_path: proj, name: 'step-1.png', data: PNG_URI, folder: 'Power Automate' }) as unknown as { success: boolean; asset: { path: string; folder?: string } };
      expect(r.success).toBe(true);
      expect(r.asset.path).toBe('assets/images/power-automate/step-1.png');
      expect(r.asset.folder).toBe('power-automate');
      expect(fs.existsSync(path.join(proj, 'assets/images/power-automate/step-1.png'))).toBe(true);
    });

    it('assetList finds foldered assets, filters by folder and lists folders', () => {
      assetAdd({ project_path: proj, name: 'flat.png', data: PNG_URI });
      assetAdd({ project_path: proj, name: 'step-1.png', data: PNG_URI, folder: 'pa' });
      const all = assetList({ project_path: proj }) as unknown as { assets: { path: string }[]; folders: string[] };
      expect(all.assets.map(a => a.path).sort()).toEqual(['assets/images/flat.png', 'assets/images/pa/step-1.png']);
      expect(all.folders).toEqual(['pa']);
      const inFolder = assetList({ project_path: proj, folder: 'pa' }) as unknown as { assets: { path: string }[] };
      expect(inFolder.assets.map(a => a.path)).toEqual(['assets/images/pa/step-1.png']);
      const root = assetList({ project_path: proj, folder: '' }) as unknown as { assets: { path: string }[] };
      expect(root.assets.map(a => a.path)).toEqual(['assets/images/flat.png']);
    });

    it('picks up a file hand-copied into a folder without a manifest entry', () => {
      const dir = path.join(proj, 'assets/images/dropped');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, 'orphan.png'), Buffer.from(PNG_B64, 'base64'));
      const r = assetList({ project_path: proj }) as unknown as { assets: { path: string; folder?: string }[] };
      expect(r.assets).toHaveLength(1);
      expect(r.assets[0].path).toBe('assets/images/dropped/orphan.png');
      expect(r.assets[0].folder).toBe('dropped');
    });

    it('assetMove renames, moves between folders and back to the root', () => {
      assetAdd({ project_path: proj, name: 'a.png', data: PNG_URI });
      const moved = assetMove({ project_path: proj, asset_path: 'assets/images/a.png', folder: 'shoot', new_name: 'b.png' }) as unknown as { success: boolean; moved: string; previous: string };
      expect(moved.success).toBe(true);
      expect(moved.moved).toBe('assets/images/shoot/b.png');
      expect(moved.previous).toBe('assets/images/a.png');
      expect(fs.existsSync(path.join(proj, 'assets/images/shoot/b.png'))).toBe(true);
      expect(fs.existsSync(path.join(proj, 'assets/images/a.png'))).toBe(false);
      expect((readAssetManifest(proj).images ?? []).map(e => e.path)).toEqual(['assets/images/shoot/b.png']);

      const back = assetMove({ project_path: proj, asset_path: 'assets/images/shoot/b.png', folder: '' }) as unknown as { success: boolean; moved: string };
      expect(back.success).toBe(true);
      expect(back.moved).toBe('assets/images/b.png');
      expect((readAssetManifest(proj).images ?? [])[0]?.folder).toBeUndefined();
    });

    it('assetMove refuses an extension change, a missing file and an occupied target', () => {
      assetAdd({ project_path: proj, name: 'a.png', data: PNG_URI });
      assetAdd({ project_path: proj, name: 'taken.png', data: PNG_URI });
      const ext = assetMove({ project_path: proj, asset_path: 'assets/images/a.png', new_name: 'a.jpg' }) as unknown as { success: boolean };
      expect(ext.success).toBe(false);
      const missing = assetMove({ project_path: proj, asset_path: 'assets/images/ghost.png', folder: 'x' }) as unknown as { success: boolean };
      expect(missing.success).toBe(false);
      const clash = assetMove({ project_path: proj, asset_path: 'assets/images/a.png', new_name: 'taken.png' }) as unknown as { success: boolean };
      expect(clash.success).toBe(false);
      expect(fs.existsSync(path.join(proj, 'assets/images/a.png'))).toBe(true);
    });

    it('assetDelete works on a foldered asset but still refuses traversal', () => {
      assetAdd({ project_path: proj, name: 'a.png', data: PNG_URI, folder: 'pa' });
      const ok = assetDelete({ project_path: proj, asset_path: 'assets/images/pa/a.png' }) as unknown as { success: boolean };
      expect(ok.success).toBe(true);
      const bad = assetDelete({ project_path: proj, asset_path: 'assets/images/../../project.yaml' }) as unknown as { success: boolean };
      expect(bad.success).toBe(false);
    });
  });
});

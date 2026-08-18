import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { renameAssetFolder, projectFolders } from './asset-folders';
import { ingestAsset } from './assets';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

let dir = '';
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-ren-'));
  fs.mkdirSync(path.join(dir, 'assets', 'images'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'), '_protocol: project/v1\nmeta:\n  name: p\n');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('renameAssetFolder', () => {
  it('renames the folder and keeps the files in it', () => {
    ingestAsset({ projectDir: dir, name: 'a.png', data: PNG, folder: 'shots' });
    const res = renameAssetFolder({ projectDir: dir, folder: 'shots', newName: 'screenshots' });
    expect(res).toMatchObject({ success: true, folder: 'screenshots' });
    expect(fs.existsSync(path.join(dir, 'assets/images/screenshots/a.png'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'assets/images/shots'))).toBe(false);
  });

  it('leaves no manifest row pointing at the old path', () => {
    ingestAsset({ projectDir: dir, name: 'a.png', data: PNG, folder: 'shots' });
    renameAssetFolder({ projectDir: dir, folder: 'shots', newName: 'screenshots' });
    // The listing merges the manifest OVER the disk, so a stale row resurrects
    // the folder that was just renamed — a ghost beside the real one.
    expect(fs.readFileSync(path.join(dir, 'project.yaml'), 'utf8')).not.toContain('images/shots/');
  });

  it('renames a nested folder without moving it up or down', () => {
    ingestAsset({ projectDir: dir, name: 'a.png', data: PNG, folder: 'clients/acme' });
    const res = renameAssetFolder({ projectDir: dir, folder: 'clients/acme', newName: 'globex' });
    expect(res).toMatchObject({ success: true, folder: 'clients/globex' });
    expect(projectFolders(dir)).toContain('clients/globex');
  });

  it('keeps empty subfolders, which are the ones a move would lose', () => {
    fs.mkdirSync(path.join(dir, 'assets/images/shots/raw'), { recursive: true });
    renameAssetFolder({ projectDir: dir, folder: 'shots', newName: 'screenshots' });
    expect(fs.existsSync(path.join(dir, 'assets/images/screenshots/raw'))).toBe(true);
  });

  it('refuses a name with a slash — renaming is not moving', () => {
    ingestAsset({ projectDir: dir, name: 'a.png', data: PNG, folder: 'shots' });
    const res = renameAssetFolder({ projectDir: dir, folder: 'shots', newName: 'other/shots' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('single new folder name');
  });

  it('refuses to overwrite a folder that is already there', () => {
    ingestAsset({ projectDir: dir, name: 'a.png', data: PNG, folder: 'shots' });
    ingestAsset({ projectDir: dir, name: 'b.png', data: PNG, folder: 'keep' });
    const res = renameAssetFolder({ projectDir: dir, folder: 'shots', newName: 'keep' });
    expect(res.success).toBe(false);
    expect(res.error).toContain('already exists');
    expect(fs.existsSync(path.join(dir, 'assets/images/keep/b.png')), 'clobbered').toBe(true);
  });

  it('reports a folder that is not there rather than inventing one', () => {
    expect(renameAssetFolder({ projectDir: dir, folder: 'ghost', newName: 'x' }).error)
      .toContain('No such folder');
  });
});

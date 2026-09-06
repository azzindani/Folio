import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { renameDesign, deleteDesign, moveDesign } from './library-manage';

function makeProject(root: string, name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'), `_protocol: project/v1\nmeta:\n  name: ${name}\n`);
  return dir;
}
function makeDesign(projectDir: string, file: string, name: string): string {
  const fp = path.join(projectDir, 'designs', file);
  fs.writeFileSync(fp, `_protocol: design/v1\nmeta:\n  id: ${file}\n  name: ${name}\n  type: poster\n  created: '2026-06-01'\n  modified: '2026-06-01'\ndocument:\n  width: 1080\n  height: 1080\n  unit: px\n  dpi: 96\nlayers:\n  - id: r\n    type: rect\n    x: 0\n    'y': 0\n    width: 1080\n    height: 1080\n`);
  return fp;
}

describe('library management', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mng-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  it('renames the display name but keeps the file path stable', () => {
    const proj = makeProject(tmp, 'alpha');
    const fp = makeDesign(proj, 'a.design.yaml', 'Old Name');
    const r = renameDesign({ design_path: fp, new_name: 'New Name' }) as unknown as { success: boolean; design_path: string; name: string; previous_name: string };
    expect(r.success).toBe(true);
    expect(r.name).toBe('New Name');
    expect(r.previous_name).toBe('Old Name');
    expect(r.design_path).toBe(fp);            // path unchanged
    expect(fs.readFileSync(fp, 'utf8')).toContain('name: New Name');
  });

  it('rejects an empty new name', () => {
    const proj = makeProject(tmp, 'alpha');
    const fp = makeDesign(proj, 'a.design.yaml', 'X');
    const r = renameDesign({ design_path: fp, new_name: '  ' }) as unknown as { success: boolean };
    expect(r.success).toBe(false);
  });

  it('deletes a design to a recoverable .trash (no hard unlink)', () => {
    const proj = makeProject(tmp, 'alpha');
    const fp = makeDesign(proj, 'a.design.yaml', 'Doomed');
    const r = deleteDesign({ design_path: fp }) as unknown as { success: boolean; trashed_path: string };
    expect(r.success).toBe(true);
    expect(fs.existsSync(fp)).toBe(false);                  // gone from designs/
    expect(fs.existsSync(r.trashed_path)).toBe(true);       // but recoverable in .trash/
    expect(r.trashed_path).toContain(path.join('alpha', '.trash'));
  });

  it('moves a design into another project', () => {
    const a = makeProject(tmp, 'alpha');
    makeProject(tmp, 'beta');
    const fp = makeDesign(a, 'a.design.yaml', 'Mover');
    const r = moveDesign({ design_path: fp, target_project: path.join(tmp, 'beta') }) as unknown as { success: boolean; design_path: string };
    expect(r.success).toBe(true);
    expect(fs.existsSync(fp)).toBe(false);
    expect(r.design_path).toContain(path.join('beta', 'designs'));
    expect(fs.existsSync(r.design_path)).toBe(true);
  });

  it('errors when the target project does not exist', () => {
    const a = makeProject(tmp, 'alpha');
    const fp = makeDesign(a, 'a.design.yaml', 'X');
    const r = moveDesign({ design_path: fp, target_project: path.join(tmp, 'ghost') }) as unknown as { success: boolean; error: string };
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not found/i);
    expect(fs.existsSync(fp)).toBe(true);                   // source untouched on failure
  });
});

describe('deleteDesign — manifest consistency', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-del-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  function projectWithManifest(name: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.yaml'),
      `_protocol: project/v1\nmeta:\n  name: ${name}\ndesigns:\n` +
      `  - id: keep\n    path: designs/keep.design.yaml\n    type: poster\n    status: draft\n` +
      `  - id: gone\n    path: designs/gone.design.yaml\n    type: poster\n    status: draft\n`);
    return dir;
  }

  it('removes the deleted design from project.yaml', () => {
    // Moving the file alone left the manifest listing a design that no longer
    // exists, so op:list kept reporting it while op:browse (which scans disk)
    // did not — and the path it handed back resolved to nothing.
    const proj = projectWithManifest('beta');
    makeDesign(proj, 'keep.design.yaml', 'Keep');
    const fp = makeDesign(proj, 'gone.design.yaml', 'Gone');

    deleteDesign({ design_path: fp });

    const manifest = fs.readFileSync(path.join(proj, 'project.yaml'), 'utf-8');
    expect(manifest).not.toContain('designs/gone.design.yaml');
    expect(manifest).toContain('designs/keep.design.yaml');
  });

  it('still trashes the file when there is no manifest row to remove', () => {
    const proj = makeProject(tmp, 'gamma');
    const fp = makeDesign(proj, 'solo.design.yaml', 'Solo');
    const r = deleteDesign({ design_path: fp }) as unknown as { success: boolean; trashed_path: string };
    expect(r.success).toBe(true);
    expect(fs.existsSync(r.trashed_path)).toBe(true);
    expect(fs.existsSync(fp)).toBe(false);
  });
});

// delete was taught to maintain the manifest; move never was. It renamed the
// file and touched neither project.yaml, so op:list (which reads the manifest)
// and op:browse (which scans the disk) disagreed in BOTH directions at once —
// the source still advertising a path that resolves to nothing, the target
// holding a design it does not list. Found by moving five real designs into a
// new project and watching list say 0 while browse said 5.
describe('moveDesign — manifest consistency', () => {
  let tmp: string;
  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-mv-')); });
  afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

  const manifestOf = (dir: string): string => fs.readFileSync(path.join(dir, 'project.yaml'), 'utf-8');

  function projectWithRow(name: string, file: string, status: string): string {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.yaml'),
      `_protocol: project/v1\nmeta:\n  name: ${name}\ndesigns:\n` +
      `  - id: m\n    path: designs/${file}\n    type: carousel\n    status: ${status}\n`);
    return dir;
  }

  it('deregisters at the source and registers at the target', () => {
    const src = projectWithRow('src', 'm.design.yaml', 'draft');
    const dst = makeProject(tmp, 'dst');
    fs.writeFileSync(path.join(dst, 'project.yaml'), `_protocol: project/v1\nmeta:\n  name: dst\ndesigns: []\n`);
    const fp = makeDesign(src, 'm.design.yaml', 'Mover');

    const r = moveDesign({ design_path: fp, target_project: dst }) as unknown as { success: boolean; design_path: string };
    expect(r.success).toBe(true);

    expect(manifestOf(src)).not.toContain('designs/m.design.yaml');
    expect(manifestOf(dst)).toContain('designs/m.design.yaml');
    expect(fs.existsSync(r.design_path)).toBe(true);
  });

  it('carries the design type and status across rather than resetting them', () => {
    const src = projectWithRow('src', 'm.design.yaml', 'final');
    const dst = makeProject(tmp, 'dst');
    fs.writeFileSync(path.join(dst, 'project.yaml'), `_protocol: project/v1\nmeta:\n  name: dst\ndesigns: []\n`);
    const fp = makeDesign(src, 'm.design.yaml', 'Mover');

    moveDesign({ design_path: fp, target_project: dst });

    const m = manifestOf(dst);
    expect(m).toContain('type: carousel');     // not re-registered as a fresh poster
    expect(m).toContain('status: final');      // not reset to draft
  });

  it('registers a design that had no row at the source', () => {
    // The five loose files this was found with were in no manifest at all.
    const src = makeProject(tmp, 'src');
    const dst = makeProject(tmp, 'dst');
    const fp = makeDesign(src, 'orphan.design.yaml', 'Orphan');

    moveDesign({ design_path: fp, target_project: dst });

    const m = manifestOf(dst);
    expect(m).toContain('designs/orphan.design.yaml');
    expect(m).toContain('status: draft');      // no prior row → a sane default
  });

  it('does not add a second row when one already names that path', () => {
    const src = makeProject(tmp, 'src');
    const dst = projectWithRow('dst', 'm.design.yaml', 'draft');
    makeDesign(dst, 'm.design.yaml', 'Already here');
    const fp = makeDesign(src, 'm.design.yaml', 'Mover');

    // The target already holds m.design.yaml, so the move suffixes the name;
    // the pre-existing row must survive untouched beside the new one.
    const r = moveDesign({ design_path: fp, target_project: dst }) as unknown as { design_path: string };
    const m = manifestOf(dst);
    expect(m).toContain('designs/m.design.yaml');
    expect(m).toContain(path.basename(r.design_path));
    expect(m.match(/- id:/g)?.length).toBe(2);
  });
});

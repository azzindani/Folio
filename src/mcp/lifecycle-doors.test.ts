import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createProject, createDesign, appendPage, listDesigns } from './engine';

// Found by building a real piece through the live connector: a reply lost to a
// timeout, a model that retries, and hints that point the wrong way.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-lifecycle-'));
let proj = '';
let n = 0;
beforeEach(() => {
  proj = path.join(root, `p${n++}`);
  createProject({ name: 'Lifecycle', path: proj });
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const page = (id: string): Record<string, unknown> => ({
  design_path: path.join(proj, 'designs/piece.design.yaml'), page_id: id,
  layers: [{ id: `${id}_bg`, type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#F4F1EA' }],
});

describe('create_design on a name that already exists', () => {
  it('refuses and names the file, instead of overwriting the finished design', () => {
    expect(createDesign({ project_path: proj, name: 'piece', type: 'carousel', width: 1080, height: 1350 }).success).toBe(true);
    appendPage(page('hook') as never);
    appendPage(page('close') as never);
    const file = path.join(proj, 'designs/piece.design.yaml');
    const before = fs.readFileSync(file, 'utf8');

    const retry = createDesign({ project_path: proj, name: 'piece', type: 'carousel', width: 1080, height: 1350 });
    expect(retry.success).toBe(false);
    expect(String(retry['error'])).toContain('already exists');
    expect(String(retry['hint'])).toContain(file);
    expect(fs.readFileSync(file, 'utf8')).toBe(before);
    // …and the manifest keeps one row for it.
    const rows = fs.readFileSync(path.join(proj, 'project.yaml'), 'utf8').match(/path: designs\/piece\.design\.yaml/g) ?? [];
    expect(rows).toHaveLength(1);
  });
});

describe('handovers point at the work in progress', () => {
  it('list on a project holding a draft suggests continuing that draft first', () => {
    createDesign({ project_path: proj, name: 'piece', type: 'carousel', width: 1080, height: 1350 });
    const r = listDesigns({ project_path: proj }) as unknown as { handover: { suggested_next: Array<{ tool: string; params: Record<string, unknown> }> } };
    expect(r.handover.suggested_next[0]?.tool).toBe('append_page');
    expect(String(r.handover.suggested_next[0]?.params['design_path'])).toContain('piece.design.yaml');
  });

  it('append_page without a task plan suggests the next page, not export', () => {
    createDesign({ project_path: proj, name: 'piece', type: 'carousel', width: 1080, height: 1350 });
    const r = appendPage(page('hook') as never) as unknown as { handover: { workflow_step: string; suggested_next: Array<{ tool: string }> } };
    expect(r.handover.workflow_step).toBe('COMPOSE');
    expect(r.handover.suggested_next.map(s => s.tool)).not.toContain('export_design');
    expect(r.handover.suggested_next[0]?.tool).toBe('append_page');
  });
});

describe('create_design in a project nobody created (r8)', () => {
  it('makes the project the design needs, so list and assets can find it', () => {
    const fresh = path.join(root, 'never-made');
    const r = createDesign({ project_path: fresh, name: 'timetable', width: 1600, height: 2263 });
    expect(r.success).toBe(true);
    expect(JSON.stringify(r['progress'])).toMatch(/did not exist — created it/);
    expect(fs.existsSync(path.join(fresh, 'project.yaml'))).toBe(true);
    expect(JSON.stringify(listDesigns({ project_path: fresh } as never))).toMatch(/timetable/);
  });

  it('says so when the folder is there but is not a project', () => {
    const bare = path.join(root, 'bare-folder');
    fs.mkdirSync(bare, { recursive: true });
    const r = createDesign({ project_path: bare, name: 'loose' });
    expect(JSON.stringify(r['progress'])).toMatch(/is not a Folio project/);
  });
});

describe('create_project on the folder an old create_design left (r8)', () => {
  it('adopts a folder holding only designs, and lists what was in it', () => {
    const orphan = path.join(root, 'orphan');
    fs.mkdirSync(path.join(orphan, 'designs'), { recursive: true });
    fs.writeFileSync(path.join(orphan, 'designs', 'timetable.design.yaml'), 'meta: {id: t, name: timetable, type: poster}\ndocument: {width: 1600, height: 2263}\nlayers: []\n');
    const r = createProject({ name: 'orphan', path: orphan });
    expect(r.success).toBe(true);
    expect(JSON.stringify(r['progress'])).toMatch(/Adopted the folder that was here/);
    expect(JSON.stringify(listDesigns({ project_path: orphan } as never))).toMatch(/timetable/);
    expect(fs.readFileSync(path.join(orphan, 'designs', 'timetable.design.yaml'), 'utf8')).toMatch(/1600/);
  });

  it('still refuses a folder that holds something else', () => {
    const other = path.join(root, 'someone-elses');
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, 'notes.txt'), 'mine');
    expect(createProject({ name: 'x', path: other }).success).toBe(false);
  });
});

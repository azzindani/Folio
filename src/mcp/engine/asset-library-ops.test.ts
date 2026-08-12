import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { assetAdd, assetList, assetDelete, assetMove, assetPromote } from './asset-library-ops';

const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-libops-'));
process.env['FOLIO_PROJECTS_DIR'] = projectsDir;
delete process.env['FOLIO_LIBRARY_DIR'];

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#2B4AF2"/></svg>';
const uri = (svg: string): string => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
const libDir = path.join(projectsDir, '.library', 'assets');

function makeProject(name: string): string {
  const dir = path.join(projectsDir, name);
  fs.mkdirSync(path.join(dir, 'designs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'project.yaml'), 'name: x\n');
  return dir;
}
const body = (r: unknown): Record<string, unknown> => r as Record<string, unknown>;

beforeEach(() => fs.rmSync(libDir, { recursive: true, force: true }));
afterAll(() => fs.rmSync(projectsDir, { recursive: true, force: true }));

describe('asset ops route between the two stores', () => {
  it('asset_add defaults to the project and shares only when asked', () => {
    const dir = makeProject('routing');
    const local = body(assetAdd({ project_path: dir, name: 'local.svg', data: uri(SVG) }));
    expect(body(local['asset'])['path']).toBe('assets/images/local.svg');

    const shared = body(assetAdd({ project_path: dir, name: 'shared.svg', data: uri(SVG.replace('#2B4AF2', '#D6301F')), folder: 'Microsoft/Logos', scope: 'library' }));
    expect(shared['scope']).toBe('library');
    expect(body(shared['asset'])['path']).toBe('lib/microsoft/logos/shared.svg');
    expect(fs.existsSync(path.join(libDir, 'microsoft/logos/shared.svg'))).toBe(true);
  });

  it('asset_add into the library reuses identical bytes instead of a second copy', () => {
    const dir = makeProject('dedupe');
    assetAdd({ project_path: dir, name: 'a.svg', data: uri(SVG), folder: 'ai', scope: 'library' });
    const again = body(assetAdd({ project_path: dir, name: 'b.svg', data: uri(SVG), folder: 'microsoft', scope: 'library' }));
    expect(again['deduped']).toBe(true);
    expect(body(again['asset'])['path']).toBe('lib/ai/a.svg');
  });

  it('asset_list shows the project and the library together, and can narrow to one', () => {
    const dir = makeProject('listing');
    assetAdd({ project_path: dir, name: 'mine.svg', data: uri(SVG) });
    assetAdd({ project_path: dir, name: 'ours.svg', data: uri(SVG.replace('#2B4AF2', '#0F6B5C')), folder: 'microsoft', scope: 'library' });

    const both = body(assetList({ project_path: dir }));
    const paths = (both['assets'] as { path: string }[]).map(a => a.path);
    expect(paths).toContain('assets/images/mine.svg');
    expect(paths).toContain('lib/microsoft/ours.svg');
    expect(both['library_folders']).toEqual(['microsoft']);
    expect(String(both['hint'])).toContain('lib/');

    const onlyLib = body(assetList({ project_path: dir, scope: 'library' }));
    expect((onlyLib['assets'] as { path: string }[]).map(a => a.path)).toEqual(['lib/microsoft/ours.svg']);
    const onlyProject = body(assetList({ project_path: dir, scope: 'project' }));
    expect((onlyProject['assets'] as { path: string }[]).map(a => a.path)).toEqual(['assets/images/mine.svg']);
  });

  it('asset_list filters library rows by nested folder prefix', () => {
    const dir = makeProject('folders');
    assetAdd({ project_path: dir, name: 'deep.svg', data: uri(SVG), folder: 'microsoft/logos', scope: 'library' });
    assetAdd({ project_path: dir, name: 'other.svg', data: uri(SVG.replace('#2B4AF2', '#111111')), folder: 'ai', scope: 'library' });
    const r = body(assetList({ project_path: dir, scope: 'library', folder: 'microsoft' }));
    expect((r['assets'] as { path: string }[]).map(a => a.path)).toEqual(['lib/microsoft/logos/deep.svg']);
  });

  it('asset_delete and asset_move follow the lib/ prefix, and say who else is affected', () => {
    const dir = makeProject('edits');
    assetAdd({ project_path: dir, name: 'x.svg', data: uri(SVG), folder: 'inbox', scope: 'library' });

    const moved = body(assetMove({ project_path: dir, asset_path: 'lib/inbox/x.svg', folder: 'microsoft/logos', new_name: 'power-automate.svg' }));
    expect(body(moved['moved'])['to']).toBe('lib/microsoft/logos/power-automate.svg');

    const del = body(assetDelete({ project_path: dir, asset_path: 'lib/microsoft/logos/power-automate.svg' }));
    expect(del['scope']).toBe('library');
    expect(String(del['note'])).toContain('any project');
    expect(fs.existsSync(String(del['trash_path']))).toBe(true);
  });

  it('reports a missing library path instead of falling through to the project store', () => {
    const dir = makeProject('missing');
    const r = body(assetDelete({ project_path: dir, asset_path: 'lib/nope/gone.svg' }));
    expect(r['success']).toBe(false);
    expect(String(r['error'])).toContain('Not in the library');
  });
});

describe('asset_promote', () => {
  it('hoists the file, repoints the designs and retires the local copy', () => {
    const dir = makeProject('promote');
    assetAdd({ project_path: dir, name: 'logo.svg', data: uri(SVG), alt: 'a blue square' });
    const design = path.join(dir, 'designs', 'poster.design.yaml');
    fs.writeFileSync(design, 'layers:\n  - id: l1\n    src: assets/images/logo.svg\n');

    const r = body(assetPromote({ project_path: dir, asset_path: 'assets/images/logo.svg', folder: 'microsoft' }));
    expect(r['success']).toBe(true);
    expect(body(r['asset'])['path']).toBe('lib/microsoft/logo.svg');
    expect(body(r['asset'])['alt']).toBe('a blue square');
    expect(r['designs_updated']).toEqual(['poster.design.yaml']);
    expect(fs.readFileSync(design, 'utf8')).toContain('src: lib/microsoft/logo.svg');
    expect(fs.existsSync(path.join(dir, 'assets/images/logo.svg'))).toBe(false);
    expect(fs.existsSync(String(r['trash_path']))).toBe(true);
  });

  it('keeps the local copy when asked, and refuses a path already in the library', () => {
    const dir = makeProject('promote-keep');
    assetAdd({ project_path: dir, name: 'keep.svg', data: uri(SVG) });
    const r = body(assetPromote({ project_path: dir, asset_path: 'assets/images/keep.svg', keep_copy: true }));
    expect(r['success']).toBe(true);
    expect(fs.existsSync(path.join(dir, 'assets/images/keep.svg'))).toBe(true);

    const bad = body(assetPromote({ project_path: dir, asset_path: 'lib/images/keep.svg' }));
    expect(bad['success']).toBe(false);
    expect(String(bad['error'])).toContain('must be a PROJECT asset');
  });

  it('still promotes when a second project already shared the same bytes', () => {
    const dir = makeProject('promote-dup');
    assetAdd({ project_path: dir, name: 'dup.svg', data: uri(SVG), folder: 'shots' });
    assetAdd({ project_path: dir, name: 'already.svg', data: uri(SVG), folder: 'ai', scope: 'library' });
    const r = body(assetPromote({ project_path: dir, asset_path: 'assets/images/shots/dup.svg' }));
    expect(r['deduped']).toBe(true);
    expect(body(r['asset'])['path']).toBe('lib/ai/already.svg');
  });
});

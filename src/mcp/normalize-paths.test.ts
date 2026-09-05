import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { normalizeProjectPaths, bareNameSegment } from './normalize-paths';
import { createProject, createDesign } from './engine-project-tools';

// Simulate the deployed topology: a projects dir nested under HOME, e.g.
// HOME=/home/folio, FOLIO_PROJECTS_DIR=/home/folio/projects.
const HOME = os.homedir();
const PROJECTS = path.join(HOME, 'projects');

describe('normalizeProjectPaths', () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env['FOLIO_PROJECTS_DIR']; process.env['FOLIO_PROJECTS_DIR'] = PROJECTS; });
  afterEach(() => { if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev; });

  it('rebases a bare project name under the projects dir', () => {
    expect(normalizeProjectPaths({ project_path: 'my-project' }).project_path)
      .toBe(path.join(PROJECTS, 'my-project'));
  });

  // A small model reuses the same name for create_project (default path) and
  // create_design (bare project_path); both must resolve to one directory.
  it('collapses whitespace (case preserved) so a spaced name maps consistently', () => {
    expect(bareNameSegment('Small Model Poster')).toBe('Small-Model-Poster');
    expect(normalizeProjectPaths({ project_path: 'Small Model Poster' }).project_path)
      .toBe(path.join(PROJECTS, 'Small-Model-Poster'));
  });

  it('rebases a misguessed /…/projects/<x> absolute path', () => {
    expect(normalizeProjectPaths({ project_path: '/var/folio/projects/foo' }).project_path)
      .toBe(path.join(PROJECTS, 'foo'));
  });

  // The reported bug: an LLM rooted the project at HOME instead of the projects
  // dir, so the editor link opened an empty canvas.
  it('rebases an absolute path under HOME but outside the projects dir', () => {
    const out = normalizeProjectPaths({ project_path: path.join(HOME, 'AIPosterProject') });
    expect(out.project_path).toBe(path.join(PROJECTS, 'AIPosterProject'));
  });

  it('rebases design_path the same way so later calls stay consistent', () => {
    const out = normalizeProjectPaths({
      project_path: path.join(HOME, 'AIPosterProject'),
      design_path: path.join(HOME, 'AIPosterProject', 'designs', 'ai.design.yaml'),
    });
    expect(out.project_path).toBe(path.join(PROJECTS, 'AIPosterProject'));
    expect(out.design_path).toBe(path.join(PROJECTS, 'AIPosterProject', 'designs', 'ai.design.yaml'));
  });

  it('leaves a path already under the projects dir untouched', () => {
    const p = path.join(PROJECTS, 'demo', 'designs', 'x.design.yaml');
    expect(normalizeProjectPaths({ design_path: p }).design_path).toBe(p);
  });

  // A small model reuses create_project's `path` arg on create_design (which
  // wants project_path) → project_path was undefined → path.join crash.
  it('aliases a stray `path` to project_path when project_path is absent', () => {
    const out = normalizeProjectPaths({ name: 'Coffee', path: 'coffee-demo' });
    expect(out.project_path).toBe(path.join(PROJECTS, 'coffee-demo'));
  });

  it('does not override an explicit project_path with `path`', () => {
    const out = normalizeProjectPaths({ project_path: 'real-proj', path: 'ignored' });
    expect(out.project_path).toBe(path.join(PROJECTS, 'real-proj'));
  });

  it('leaves a relative design_path for the engine to resolve', () => {
    expect(normalizeProjectPaths({ design_path: 'designs/x.design.yaml' }).design_path)
      .toBe('designs/x.design.yaml');
  });

  it('leaves a /tmp path (outside HOME) untouched', () => {
    const p = path.join(os.tmpdir(), 'folio-x', 'designs', 'x.design.yaml');
    expect(normalizeProjectPaths({ design_path: p }).design_path).toBe(p);
  });

  it('is a no-op when FOLIO_PROJECTS_DIR is unset', () => {
    delete process.env['FOLIO_PROJECTS_DIR'];
    const args = { project_path: path.join(HOME, 'AIPosterProject') };
    expect(normalizeProjectPaths(args)).toBe(args); // same reference, untouched
  });

  it('does not mutate the input object', () => {
    const args = { project_path: 'my-project' };
    normalizeProjectPaths(args);
    expect(args.project_path).toBe('my-project');
  });
});

// The other half of the same question: normalizeProjectPaths only runs on the
// HTTP surface, so a tool that joins its raw project_path resolves a bare name
// against the process CWD instead of the projects dir — writing a real design
// somewhere nobody is looking, with no error. create_design did exactly that,
// which is how a project named "rt" from a test run ended up committed to the
// repo three times.
describe('create_design resolves its own project_path', () => {
  let prev: string | undefined;
  let root = '';
  beforeEach(() => {
    prev = process.env['FOLIO_PROJECTS_DIR'];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-bare-'));
    process.env['FOLIO_PROJECTS_DIR'] = root;
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev;
  });

  it('puts a BARE project name in the projects dir, never in the CWD', () => {
    createProject({ name: 'bare-proj', canvas: '1080x1350' });
    const r = createDesign({ project_path: 'bare-proj', name: 'hero', type: 'poster' }) as unknown as Record<string, unknown>;
    const made = r['path'] as string;

    expect(made).toBe(path.join(root, 'bare-proj', 'designs', 'hero.design.yaml'));
    expect(fs.existsSync(made)).toBe(true);
    expect(made.startsWith(path.resolve(process.cwd()) + path.sep)).toBe(false);
    // …and it registered in the project it actually belongs to.
    expect(fs.readFileSync(path.join(root, 'bare-proj', 'project.yaml'), 'utf-8')).toContain('hero');
  });

  it('refuses a project path outside the allowed roots instead of writing there', () => {
    const r = createDesign({ project_path: '/etc/folio-nope', name: 'hero' }) as unknown as Record<string, unknown>;
    expect(r['success']).toBe(false);
    expect(String(r['error'])).toMatch(/outside allowed directories/);
    expect(fs.existsSync('/etc/folio-nope')).toBe(false);
  });
});

describe('`path` is not always a filesystem path', () => {
  let prev: string | undefined;
  beforeEach(() => { prev = process.env['FOLIO_PROJECTS_DIR']; process.env['FOLIO_PROJECTS_DIR'] = PROJECTS; });
  afterEach(() => { if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev; });

  // Live failure: the SVG `d` for animation{op:"motion_path"} was rewritten as a
  // project name, so the engine was handed
  // "/home/folio/projects/M-0-0-A-50-50-0-0-1-100-0" and reported it could not
  // walk a path the caller never sent.
  it('leaves an SVG path alone for op:motion_path', () => {
    const out = normalizeProjectPaths({ op: 'motion_path', design_path: 'p/designs/d.design.yaml', path: 'M 0 0 Q 250 -200 500 0' });
    expect(out['path']).toBe('M 0 0 Q 250 -200 500 0');
    expect(out['project_path']).toBeUndefined();
  });

  it('still treats `path` as a project path for every other op', () => {
    const out = normalizeProjectPaths({ op: 'create', path: 'rainforest' });
    expect(String(out['project_path'])).toContain('rainforest');
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as path from 'path';
import * as os from 'os';
import { normalizeProjectPaths, bareNameSegment } from './normalize-paths';

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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ALL_HANDLERS } from '../handlers';
import { resolveRefs, parseSteps } from './task-execute';

type R = Record<string, unknown>;
const run = async (args: R): Promise<R> => (await ALL_HANDLERS['tasks']?.({ op: 'execute', ...args })) as unknown as R;

describe('refs', () => {
  it('a whole-string ref keeps its type; an inline one is text; an unknown one is reported, not guessed', () => {
    const results = { made: { path: '/p/d.yaml', ids: ['a', 'b'] } };
    const missing: string[] = [];
    expect(resolveRefs({ design_path: '${made.path}', ids: '${made.ids}', note: 'saved ${made.path} (${made.ids.1})', gone: '${made.nope}' }, results, missing))
      .toEqual({ design_path: '/p/d.yaml', ids: ['a', 'b'], note: 'saved /p/d.yaml (b)', gone: '${made.nope}' });
    expect(missing).toEqual(['made.nope']);
  });
});

describe('parseSteps', () => {
  it('refuses a chain before running any of it: unknown tool, ref to a later step, duplicate name, nested execute', () => {
    expect(parseSteps([{ tool: 'no_such_tool' }])).toMatchObject({ error: expect.stringContaining('unknown tool "no_such_tool"') });
    expect(parseSteps([{ tool: 'create_design', args: { project_path: '${p.path}' } }, { tool: 'create_project', as: 'p' }]))
      .toMatchObject({ error: expect.stringContaining('which no earlier step is named') });
    expect(parseSteps([{ tool: 'create_project', as: 'a' }, { tool: 'create_project', as: 'a' }])).toMatchObject({ error: expect.stringContaining('as:"a"') });
    expect(parseSteps([{ tool: 'tasks', args: { op: 'execute', steps: [] } }])).toMatchObject({ error: expect.stringContaining('with {recipe, params}, not through tasks') });
    expect(parseSteps([{ recipe: 'never-saved' }])).toMatchObject({ error: expect.stringContaining('no saved recipe "never-saved"') });
    expect(parseSteps([])).toMatchObject({ error: expect.stringContaining('steps is required') });
  });
});

describe('tasks {op:"execute"}', () => {
  let root = '';
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env['FOLIO_PROJECTS_DIR'];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-exec-'));
    process.env['FOLIO_PROJECTS_DIR'] = root;
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    if (prev === undefined) delete process.env['FOLIO_PROJECTS_DIR']; else process.env['FOLIO_PROJECTS_DIR'] = prev;
  });

  it('runs a build in one call — each step through the real tool — and hands back the last step\'s baton', async () => {
    const r = await run({ steps: [
      { tool: 'create_project', args: { name: 'chain' } },
      { tool: 'create_design', args: { project_path: 'chain', name: 'hero', type: 'poster', width: 1080, height: 1080 }, as: 'made' },
      { tool: 'add_layers', args: { design_path: '${made.path}', layers_shorthand: [{ id: 'title', type: 'text', content: 'Hello', pos: [80, 80, 900, 160], size: 96 }] } },
      { tool: 'manage_design', args: { op: 'inspect', design_path: '${made.path}' }, as: 'look' },
    ] });
    expect(r['success']).toBe(true);
    expect(r['ran']).toBe(4);
    expect((r['steps'] as R[]).map(s => s['tool'])).toEqual(['create_project', 'create_design', 'add_layers', 'manage_design:inspect']);
    const file = path.join(root, 'chain', 'designs', 'hero.design.yaml');
    expect(fs.readFileSync(file, 'utf8')).toContain('Hello');
  }, 30_000);

  it('stops at the first failure, says which step, and keeps what the earlier steps did', async () => {
    const r = await run({ steps: [
      { tool: 'create_project', args: { name: 'half' } },
      { tool: 'add_layers', args: { design_path: path.join(root, 'half', 'designs', 'missing.design.yaml'), layers_shorthand: [] } },
      { tool: 'create_design', args: { project_path: 'half', name: 'never' } },
    ] });
    expect(r['success']).toBe(false);
    expect(String(r['error'])).toMatch(/^Step 2 of 3 \(add_layers\) failed/);
    expect(r['ran']).toBe(1);
    expect(fs.existsSync(path.join(root, 'half', 'project.yaml'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'half', 'designs', 'never.design.yaml'))).toBe(false);
  }, 30_000);

  it('dry_run checks the chain and runs nothing', async () => {
    const r = await run({ dry_run: true, steps: [{ tool: 'create_project', args: { name: 'dry' }, as: 'p' }] });
    expect(r).toMatchObject({ success: true, dry_run: true, of: 1 });
    expect(fs.existsSync(path.join(root, 'dry'))).toBe(false);
  });
});

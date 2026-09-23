import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ALL_HANDLERS } from '../handlers';
import { recipesDir } from './task-recipes';

type R = Record<string, unknown>;
const tasks = async (args: R): Promise<R> => (await ALL_HANDLERS['tasks']?.(args)) as unknown as R;

const TITLE_CARD = [
  { tool: 'create_design', args: { project_path: '${params.project}', name: '${params.name}', type: 'poster', width: 1920, height: 1080 }, as: 'made' },
  { tool: 'add_layers', args: { design_path: '${made.path}', layers_shorthand: [{ id: 'title', type: 'text', content: '${params.title}', pos: [120, 120, 1400, 200], size: 110 }] } },
];

describe('recipes', () => {
  let root = '';
  const prev: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of ['FOLIO_PROJECTS_DIR', 'FOLIO_LIBRARY_DIR']) prev[k] = process.env[k];
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-recipe-'));
    process.env['FOLIO_PROJECTS_DIR'] = root;
    delete process.env['FOLIO_LIBRARY_DIR'];
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    for (const [k, v] of Object.entries(prev)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  });

  it('saves a checked chain in the shared library, and a second save is a new version', async () => {
    const params = { project: 'which project', name: 'design name', title: 'the headline' };
    const first = await tasks({ op: 'save_recipe', recipe: 'fhd-title-card', description: 'A 1920×1080 title card', params, steps: TITLE_CARD });
    expect(first).toMatchObject({ success: true, recipe: 'fhd-title-card', version: 1, steps: 2 });
    expect(recipesDir()).toBe(path.join(root, '.library', 'recipes'));
    expect(fs.existsSync(path.join(recipesDir(), 'fhd-title-card.recipe.json'))).toBe(true);
    expect(await tasks({ op: 'save_recipe', recipe: 'fhd-title-card', params, steps: TITLE_CARD })).toMatchObject({ version: 2 });
  });

  it('refuses a chain that reads a param it does not declare, and a name it cannot file', async () => {
    const r = await tasks({ op: 'save_recipe', recipe: 'card', params: { project: 'p', name: 'n' }, steps: TITLE_CARD });
    expect(String(r['error'])).toContain('${params.title}');
    expect(String((await tasks({ op: 'save_recipe', recipe: 'Bad Name!', steps: TITLE_CARD }))['error'])).toContain('not a usable name');
  });

  it('runs in one call with the values given, and asks for any it is missing', async () => {
    await tasks({ op: 'save_recipe', recipe: 'fhd-title-card', params: { project: 'p', name: 'n', title: 't' }, steps: TITLE_CARD });
    await ALL_HANDLERS['create_project']?.({ name: 'launch' });
    const missing = await tasks({ op: 'run_recipe', recipe: 'fhd-title-card', params: { project: 'launch' } });
    expect(String(missing['error'])).toMatch(/needs name \(n\), title \(t\)/);
    const r = await tasks({ op: 'run_recipe', recipe: 'fhd-title-card', params: { project: 'launch', name: 'opener', title: 'Ship it' } });
    expect(r).toMatchObject({ success: true, op: 'run_recipe', ran: 2 });
    expect(fs.readFileSync(path.join(root, 'launch', 'designs', 'opener.design.yaml'), 'utf8')).toContain('Ship it');
    const list = await tasks({ op: 'recipes' });
    expect(list['recipes']).toEqual([expect.objectContaining({ recipe: 'fhd-title-card', steps: 2, params: { project: 'p', name: 'n', title: 't' } })]);
  }, 30_000);

  it('a recipe runs recipes — a function calling a function', async () => {
    await tasks({ op: 'save_recipe', recipe: 'fhd-title-card', params: { project: 'p', name: 'n', title: 't' }, steps: TITLE_CARD });
    const saved = await tasks({ op: 'save_recipe', recipe: 'two-cards', params: { project: 'which project', title: 'first headline' }, steps: [
      { recipe: 'fhd-title-card', params: { project: '${params.project}', name: 'first', title: '${params.title}' }, as: 'one' },
      { recipe: 'fhd-title-card', params: { project: '${params.project}', name: 'second', title: 'After ${params.title}' } },
    ] });
    expect(saved['success']).toBe(true);
    await ALL_HANDLERS['create_project']?.({ name: 'deck' });
    const r = await tasks({ op: 'run_recipe', recipe: 'two-cards', params: { project: 'deck', title: 'Hello' } });
    expect(r).toMatchObject({ success: true, ran: 2 });
    expect((r['steps'] as R[]).map(s => s['tool'])).toEqual(['recipe:fhd-title-card', 'recipe:fhd-title-card']);
    expect(fs.readFileSync(path.join(root, 'deck', 'designs', 'second.design.yaml'), 'utf8')).toContain('After Hello');
  }, 30_000);

  it('refuses a recipe that runs itself — directly when saved, through another when run', async () => {
    await tasks({ op: 'save_recipe', recipe: 'x', steps: [{ tool: 'create_project', args: { name: 'x-proj' } }] });
    await tasks({ op: 'save_recipe', recipe: 'y', steps: [{ recipe: 'x' }] });
    expect(String((await tasks({ op: 'save_recipe', recipe: 'y', steps: [{ recipe: 'y' }] }))['error'])).toContain('runs itself');
    await tasks({ op: 'save_recipe', recipe: 'x', steps: [{ recipe: 'y' }] });
    const r = await tasks({ op: 'run_recipe', recipe: 'x' });
    expect(r['success']).toBe(false);
    expect(JSON.stringify(r)).toContain('would run itself: x → y → x');
  });
});

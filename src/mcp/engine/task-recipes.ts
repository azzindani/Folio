// tasks {op:"save_recipe" | "run_recipe" | "recipes"} — a chain that worked, kept
// under a name and run again with new values.
//
// The toolbox grows from the workshop: a build first done step by step with
// op:execute is saved once, and from then on it is ONE call — for any project,
// since recipes live in the shared library (<projects>/.library/recipes), not in
// the project that made them. What varies between runs is declared as params
// and read in the steps as ${params.name}; everything else is fixed, so a
// recipe runs the same way every time. The chain is checked when it is saved,
// not discovered broken when it is next needed.
import * as fs from 'fs';
import * as path from 'path';
import type { ToolResult } from '../types';
import { okResult, errResult, buildContext, pOk } from './utils';
import { libraryRoot } from './asset-library';
import { parseSteps, executeSteps, type Step } from './task-execute';

export interface Recipe {
  name: string;
  description: string;
  /** param name → what it is; every one must be given to run_recipe. */
  params: Record<string, string>;
  steps: Step[];
  version: number;
  saved: string;
}

const NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

export function recipesDir(): string {
  return path.join(path.dirname(libraryRoot()), 'recipes');
}

const fileOf = (name: string): string => path.join(recipesDir(), `${name}.recipe.json`);

export function readRecipe(name: string): Recipe | null {
  try { return JSON.parse(fs.readFileSync(fileOf(name), 'utf8')) as Recipe; } catch { return null; }
}

/** Every ${params.x} a chain reads. */
function paramRefs(steps: Step[]): string[] {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (typeof v === 'string') for (const m of v.matchAll(/\$\{params\.([\w-]+)/g)) out.add(m[1] ?? '');
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null && typeof v === 'object') Object.values(v).forEach(walk);
  };
  steps.forEach(s => walk(s.args));
  return [...out];
}

export function saveRecipe(a: { recipe?: string; description?: string; params?: unknown; steps?: unknown }): ToolResult {
  const op = 'save_recipe';
  const name = String(a.recipe ?? '').trim().toLowerCase();
  if (!NAME.test(name)) return errResult(op, `recipe:"${a.recipe ?? ''}" is not a usable name`, 'Lowercase letters, digits, _ and - (at most 48), e.g. recipe:"fhd-title-card".');
  const params = a.params !== null && typeof a.params === 'object' && !Array.isArray(a.params)
    ? Object.fromEntries(Object.entries(a.params as Record<string, unknown>).map(([k, v]) => [k, String(v ?? '')]))
    : {};
  const parsed = parseSteps(a.steps, ['params']);
  if ('error' in parsed) return errResult(op, parsed.error, parsed.hint);
  const undeclared = paramRefs(parsed.steps).filter(p => !(p in params));
  if (undeclared.length) return errResult(op, `The steps read ${undeclared.map(p => `\${params.${p}}`).join(', ')}, which params does not declare`, 'Add each to params:{name:"what it is"}.');
  const unused = Object.keys(params).filter(p => !paramRefs(parsed.steps).includes(p));
  const prior = readRecipe(name);
  const recipe: Recipe = {
    name, description: String(a.description ?? '').slice(0, 400), params, steps: parsed.steps,
    version: (prior?.version ?? 0) + 1, saved: new Date().toISOString().split('T')[0] ?? '',
  };
  fs.mkdirSync(recipesDir(), { recursive: true });
  const tmp = `${fileOf(name)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(recipe, null, 2)}\n`);
  fs.renameSync(tmp, fileOf(name));
  return okResult(op, {
    recipe: name, version: recipe.version, steps: parsed.steps.length, params: Object.keys(params),
    ...(unused.length ? { unused_params: unused } : {}),
    next_action: { tool: 'tasks', params: { op: 'run_recipe', recipe: name, params: Object.fromEntries(Object.keys(params).map(p => [p, `<${params[p] || p}>`])) }, remaining: 0,
      hint: `Saved${prior ? ` (replaces v${prior.version})` : ''} in the shared library — any project can run it in one call.` },
    progress: [pOk('Saved', `${name} v${recipe.version}: ${parsed.steps.length} step(s), ${Object.keys(params).length} param(s)`)],
    context: buildContext(op, `recipe ${name} v${recipe.version}`),
  });
}

export async function runRecipe(a: { recipe?: string; params?: unknown; dry_run?: boolean }): Promise<ToolResult> {
  const op = 'run_recipe';
  const name = String(a.recipe ?? '').trim().toLowerCase();
  const recipe = NAME.test(name) ? readRecipe(name) : null;
  if (!recipe) return errResult(op, `No recipe "${a.recipe ?? ''}"`, 'tasks {op:"recipes"} lists the saved ones.');
  const given = a.params !== null && typeof a.params === 'object' && !Array.isArray(a.params) ? a.params as Record<string, unknown> : {};
  const missing = Object.keys(recipe.params).filter(p => given[p] === undefined);
  if (missing.length) return errResult(op, `${name} needs ${missing.map(p => `${p} (${recipe.params[p] || 'no description'})`).join(', ')}`, `Pass params:{${missing.map(p => `${p}:…`).join(', ')}}.`);
  return executeSteps({ steps: recipe.steps, ...(a.dry_run ? { dry_run: true } : {}) }, { params: given }, op);
}

export function listRecipes(): ToolResult {
  const op = 'recipes';
  let names: string[] = [];
  try { names = fs.readdirSync(recipesDir()).filter(f => f.endsWith('.recipe.json')).map(f => f.replace(/\.recipe\.json$/, '')); } catch { names = []; }
  const recipes = names.sort().flatMap(n => {
    const r = readRecipe(n);
    return r ? [{ recipe: r.name, description: r.description, params: r.params, steps: r.steps.length, version: r.version, saved: r.saved }] : [];
  });
  return okResult(op, {
    recipes,
    hint: recipes.length ? 'Run one with tasks {op:"run_recipe", recipe, params}.' : 'None saved yet — a chain that worked in op:execute is saved with op:"save_recipe".',
    progress: [pOk('Listed', `${recipes.length} recipe(s)`)],
    context: buildContext(op, `${recipes.length} recipe(s)`),
  });
}


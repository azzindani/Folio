// Where saved recipes live and how one is read — shared by tasks op:execute (a
// step may run a recipe) and the recipe ops (task-recipes.ts), so neither has
// to import the other.
import * as fs from 'fs';
import * as path from 'path';
import { libraryRoot } from './asset-library';

type Rec = Record<string, unknown>;

/** One step of a chain: a tool call, or a saved recipe run inline. */
export interface Step { tool?: string; recipe?: string; args?: Rec; params?: Rec; as?: string }

export interface Recipe {
  name: string;
  description: string;
  /** param name → what it is; every one must be given to run the recipe. */
  params: Record<string, string>;
  steps: Step[];
  version: number;
  saved: string;
}

export const RECIPE_NAME = /^[a-z0-9][a-z0-9_-]{0,47}$/;

/** The shared library's recipes — beside its assets, so any project can run one. */
export function recipesDir(): string {
  return path.join(path.dirname(libraryRoot()), 'recipes');
}

export const recipeFile = (name: string): string => path.join(recipesDir(), `${name}.recipe.json`);

export function readRecipe(name: string): Recipe | null {
  if (!RECIPE_NAME.test(name)) return null;
  try { return JSON.parse(fs.readFileSync(recipeFile(name), 'utf8')) as Recipe; } catch { return null; }
}

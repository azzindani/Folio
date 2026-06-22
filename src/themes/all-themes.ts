// Combined theme registry — the core builtins PLUS the imported "inspired-by"
// brand systems (./brand-pack). SERVER/MCP-side only: apply_theme, list_themes,
// the export/render theme resolution. NOT imported by the editor bundle — that
// imports BUILTIN_THEMES (core only) to stay within the 500KB main-entry budget;
// brand themes are applied via MCP and seeded to the project on disk, so the
// editor renders a brand-themed design from the seeded YAML, not from this map.
import type { ThemeSpec } from '../schema/types';
import { BUILTIN_THEMES } from './builtin';
import { BRAND_THEMES } from './brand-pack';

// Core first so a curated builtin always wins an id collision with a brand.
export const ALL_THEMES: Record<string, ThemeSpec> = { ...BRAND_THEMES, ...BUILTIN_THEMES };

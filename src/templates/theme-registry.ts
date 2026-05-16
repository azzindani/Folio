// Catalog-friendly view of the built-in themes. Surfaces the slice of theme
// data the picker needs (id, name, swatches, tags) without exposing the full
// ThemeSpec to the dialog layer.

import { BUILTIN_THEMES } from '../themes/builtin';
import type { ThemeSpec } from '../schema/types';

export interface ThemeCardData {
  id: string;
  name: string;
  spec: ThemeSpec;
  /** 5-color swatch preview, in order: background, surface, primary, secondary, text. */
  swatches: [string, string, string, string, string];
  /** Human-readable mood tags shown on the card. */
  tags: string[];
  /** Whether the theme uses a light background — used to flip preview text color. */
  light: boolean;
}

const TAGS_BY_ID: Record<string, string[]> = {
  'dark-tech':   ['dark', 'pink-accent', 'classic'],
  'light-clean': ['light', 'minimal', 'editorial'],
  'ocean-blue':  ['dark', 'teal', 'calm'],
  'neon-bloom':  ['dark', 'neon', 'event'],
  'indigo-pro':  ['dark', 'indigo', 'saas'],
  'sunset-glow': ['dark', 'warm', 'sunset'],
  'mono-print':  ['light', 'mono', 'editorial'],
  'forest-deep': ['dark', 'green', 'organic'],
};

function asString(v: string | Record<string, string> | undefined, fallback = '#000000'): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object') return v['light'] ?? v['dark'] ?? Object.values(v)[0] ?? fallback;
  return fallback;
}

function isLight(bg: string): boolean {
  // crude luminance check on #RRGGBB
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(bg);
  if (!m) return false;
  const r = parseInt(m[1], 16);
  const g = parseInt(m[2], 16);
  const b = parseInt(m[3], 16);
  // perceived luminance (rec. 709)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 160;
}

let cache: ThemeCardData[] | null = null;

export function loadThemeCatalog(): ThemeCardData[] {
  if (cache) return cache;
  cache = Object.entries(BUILTIN_THEMES).map(([id, spec]) => {
    const c = spec.colors;
    const bg = asString(c['background'], '#000000');
    const sf = asString(c['surface'], bg);
    const pr = asString(c['primary'], '#888888');
    const sc = asString(c['secondary'], '#888888');
    const tx = asString(c['text'], '#FFFFFF');
    return {
      id,
      name: spec.name,
      spec,
      swatches: [bg, sf, pr, sc, tx] as [string, string, string, string, string],
      tags: TAGS_BY_ID[id] ?? [],
      light: isLight(bg),
    };
  });
  return cache;
}

export function getThemeById(id: string): ThemeCardData | undefined {
  return loadThemeCatalog().find(t => t.id === id);
}

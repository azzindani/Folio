// Bundled-font registry for VECTOR pdf export. The hybrid PDF path draws text
// as real glyphs (selectable, infinitely crisp) using jsPDF's TTF embedding,
// which needs the actual font file. We already ship the curated families as
// .ttf in src/mcp/fonts (for resvg raster); this maps a design's font-family +
// weight to the best bundled file so the vector text matches the editor.
//
// Variable fonts (one .ttf spanning all weights) embed at their default
// instance (~400) — jsPDF can't pick an axis position — so a heavy weight on a
// variable family is flagged `fauxBold` and the drawer thickens it with a thin
// stroke. Static families (IBM Plex Mono, Space Mono) ship per-weight files and
// pick the closest one directly.

import * as fs from 'fs';
import * as path from 'path';
import { fontsDir } from './fonts';

export interface FontPick {
  /** TTF filename within fontsDir(). */
  file: string;
  /** Stable jsPDF alias for this file (register once, reuse). */
  alias: string;
  /** Synthesize bold via stroke (variable family with no dedicated weight file). */
  fauxBold: boolean;
}

let _files: Record<string, string[]> | null = null;
function fontFiles(): Record<string, string[]> {
  if (_files) return _files;
  try {
    const raw = fs.readFileSync(path.join(fontsDir(), 'manifest.json'), 'utf8');
    _files = (JSON.parse(raw) as { files?: Record<string, string[]> }).files ?? {};
  } catch {
    _files = {};
  }
  return _files;
}

/** Case-insensitive family → manifest key (e.g. "inter" → "Inter"). */
function resolveFamilyKey(family: string): string | null {
  const want = family.trim().toLowerCase();
  if (!want) return null;
  for (const key of Object.keys(fontFiles())) {
    if (key.toLowerCase() === want) return key;
  }
  return null;
}

const WEIGHT_ORDER: Record<string, string[]> = {
  bold: ['bold', 'semibold', 'medium', 'regular'],
  semibold: ['semibold', 'bold', 'medium', 'regular'],
  medium: ['medium', 'regular', 'semibold', 'bold'],
  regular: ['regular', 'medium', 'semibold', 'bold'],
};

function pickWeightFile(list: string[], weight: number): { file: string; dedicated: boolean } {
  if (list.length === 1) return { file: list[0], dedicated: false };
  const bucket = weight >= 700 ? 'bold' : weight >= 600 ? 'semibold' : weight >= 500 ? 'medium' : 'regular';
  for (const token of WEIGHT_ORDER[bucket]) {
    const f = list.find(x => x.toLowerCase().includes(token));
    if (f) return { file: f, dedicated: true };
  }
  return { file: list[0], dedicated: false };
}

/** Resolve a font-family + weight to a bundled TTF, or null when not bundled
 *  (the caller then leaves that text in the raster rather than mis-rendering it). */
export function pickFont(family: string, weight: number): FontPick | null {
  const key = resolveFamilyKey(family);
  if (!key) return null;
  const list = fontFiles()[key];
  if (!list || list.length === 0) return null;
  const { file, dedicated } = pickWeightFile(list, weight);
  const alias = `f_${`${key}_${file}`.replace(/[^a-z0-9]/gi, '_')}`;
  return { file, alias, fauxBold: !dedicated && weight >= 600 };
}

/** Base64 of a bundled TTF, for jsPDF.addFileToVFS. */
export function fontFileBase64(file: string): string {
  return fs.readFileSync(path.join(fontsDir(), file)).toString('base64');
}

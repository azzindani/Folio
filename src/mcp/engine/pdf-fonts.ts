// Bundled-font registry (server side) for VECTOR pdf export. The hybrid PDF
// path draws text as real glyphs (selectable, infinitely crisp) using jsPDF's
// TTF embedding, which needs the actual font file. We ship the curated families
// as .ttf in src/mcp/fonts (also used by resvg raster); this maps a design's
// font-family + weight to the best bundled file via the shared selector so the
// vector text matches the editor.

import * as fs from 'fs';
import * as path from 'path';
import { fontsDir, projectFontEntries } from './fonts';
import { selectFontFile, type FontSelection } from '../../export/pdf-font-select';

export type FontPick = FontSelection;

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

// Project-font map (WP-1.6): family-guess → ABSOLUTE file paths under
// <project>/assets/fonts, so an uploaded TTF embeds as selectable vector text
// exactly like a bundled one. Absolute paths keep fontFileBase64 unambiguous.
function projectFontFiles(projectDir?: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const e of projectFontEntries(projectDir)) {
    if (!/\.(ttf|otf)$/i.test(e.file)) continue;   // jsPDF embeds TTF/OTF only
    // A file is registered under every name it answers to — the family the
    // file DECLARES and the one its filename suggests — so a design written
    // against either spelling embeds rather than silently staying raster.
    for (const fam of e.families) (out[fam] ??= []).push(e.file);
  }
  return out;
}

/** Resolve a font-family + weight to a bundled OR project TTF, or null when
 *  neither has it (the caller then leaves that text in the raster). */
export function pickFont(family: string, weight: number, projectDir?: string): FontPick | null {
  return selectFontFile(fontFiles(), family, weight)
    ?? selectFontFile(projectFontFiles(projectDir), family, weight);
}

/** Base64 of a bundled (relative) or project (absolute path) TTF, for
 *  jsPDF.addFileToVFS. */
export function fontFileBase64(file: string): string {
  return fs.readFileSync(path.isAbsolute(file) ? file : path.join(fontsDir(), file)).toString('base64');
}

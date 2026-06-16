// Bundled-font registry (server side) for VECTOR pdf export. The hybrid PDF
// path draws text as real glyphs (selectable, infinitely crisp) using jsPDF's
// TTF embedding, which needs the actual font file. We ship the curated families
// as .ttf in src/mcp/fonts (also used by resvg raster); this maps a design's
// font-family + weight to the best bundled file via the shared selector so the
// vector text matches the editor.

import * as fs from 'fs';
import * as path from 'path';
import { fontsDir } from './fonts';
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

/** Resolve a font-family + weight to a bundled TTF, or null when not bundled
 *  (the caller then leaves that text in the raster rather than mis-rendering it). */
export function pickFont(family: string, weight: number): FontPick | null {
  return selectFontFile(fontFiles(), family, weight);
}

/** Base64 of a bundled TTF, for jsPDF.addFileToVFS. */
export function fontFileBase64(file: string): string {
  return fs.readFileSync(path.join(fontsDir(), file)).toString('base64');
}

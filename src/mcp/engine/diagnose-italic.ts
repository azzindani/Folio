/**
 * Italic text with no italic face to draw it. Found in the benchmark (r8): a
 * save-the-date set "Nadia & Tomás" in Playfair Display italic. The editor is a
 * browser, and with no italic face it slants the upright one; the export looks
 * for an italic in its font folders, finds none, and draws the names upright.
 * The gate said "nothing left to judge". An italic is its own file, and this
 * names the call that fetches it.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { Layer } from '../../schema/types';
import type { Finding } from './diagnose';
import { fontsDir, projectFontEntries, libraryFontEntries } from './fonts';

const squash = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const slanted = (file: string): boolean => /italic|oblique/i.test(path.basename(file));

/** Every face the export can load: its family, and whether it is an italic. */
function faces(projectDir: string): Array<{ family: string; italic: boolean }> {
  const out: Array<{ family: string; italic: boolean }> = [];
  let bundled: string[] = [];
  try { bundled = fs.readdirSync(fontsDir()); } catch { /* no bundled fonts */ }
  for (const n of bundled) if (/\.(ttf|otf)$/i.test(n)) out.push({ family: squash(n.split(/[-.]/)[0] ?? ''), italic: slanted(n) });
  for (const e of [...projectFontEntries(projectDir), ...libraryFontEntries()]) {
    for (const f of e.families) out.push({ family: squash(f), italic: slanted(e.file) });
  }
  return out;
}

/** One finding per family set italic whose upright face is here and whose italic is not. */
export function italicFindings(layers: Layer[], designPath: string, projectPath?: string): Finding[] {
  const projectDir = projectPath ?? path.dirname(path.dirname(designPath));
  const wanted = new Map<string, { family: string; weight: number; ids: string[] }>();
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const kids = (l as { layers?: unknown }).layers;
      if (Array.isArray(kids)) visit(kids as Layer[]);
      const style = (l as { style?: { font_family?: unknown; font_style?: unknown; font_weight?: unknown } }).style;
      if (l.type !== 'text' || typeof style?.font_family !== 'string' || !/italic|oblique/i.test(String(style.font_style ?? ''))) continue;
      const key = squash(style.font_family);
      const hit = wanted.get(key) ?? { family: style.font_family, weight: Number(style.font_weight) || 400, ids: [] };
      hit.ids.push(l.id);
      wanted.set(key, hit);
    }
  };
  visit(layers);
  if (!wanted.size) return [];
  const known = faces(projectDir);
  const out: Finding[] = [];
  for (const [key, w] of wanted) {
    const here = known.filter(f => f.family === key);
    if (!here.some(f => !f.italic) || here.some(f => f.italic)) continue;
    const ref = `font:${w.family.toLowerCase().trim().replace(/\s+/g, '-')}`;
    out.push({
      code: 'missing_italic', severity: 'warning', layer_id: w.ids[0] ?? '', ...(w.ids.length > 1 ? { layers: w.ids } : {}),
      message: `${w.ids.map(id => `"${id}"`).join(', ')} ${w.ids.length > 1 ? 'are' : 'is'} set in ${w.family} italic, but no italic ${w.family} face is installed — the editor slants the upright face; the export draws it upright.`,
      fix: `Fetch the italic face (manage_design {op:"asset_fetch", ref:"${ref}", italic:true}), or set the text upright.`,
      call: { tool: 'manage_design', params: { op: 'asset_fetch', project_path: projectDir, ref, italic: true, weight: w.weight } },
    });
  }
  return out;
}

/**
 * Characters a text's face does not have — a line that exports in another font.
 *
 * The editor is a browser: a character missing from the face is borrowed from
 * another font, one glyph at a time, and the line looks right. The export
 * renderer does not borrow a glyph — the line holding it is drawn in a
 * fallback face, often at another weight. Benchmark r5: "30 years ≈ £761" in
 * Outfit 600 exported as a thin monospace line, and diagnose said Clean. The
 * bundled faces' own character maps say which characters they have
 * (utils/font-metrics.ts), so the model hears which character, before it ships.
 */

import * as path from 'path';
import type { Layer } from '../../schema/types';
import type { Finding } from './diagnose';
import { layerText } from '../../schema/layer-text';
import { metricsForFamily, numericWeight } from '../../utils/font-metrics';
import { fontsDir, projectFontsDir } from './fonts';

/** Whitespace, controls, joiners and variation selectors draw nothing of their own. */
const silent = (cp: number): boolean =>
  cp < 0x20 || cp === 0x20 || cp === 0xa0 || cp === 0xad || (cp >= 0x2000 && cp <= 0x200f) || cp === 0x2028 || cp === 0x2029
  || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0xfeff || /\s/u.test(String.fromCodePoint(cp));

const label = (ch: string): string => `"${ch}" (U+${(ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')})`;

/** Text layers using characters their bundled face lacks. Faces that are not bundled are skipped — the export notes those itself. */
export function glyphFindings(layers: Layer[], designPath: string, projectPath?: string): Finding[] {
  const dirs = [fontsDir(), projectFontsDir(projectPath ?? path.dirname(path.dirname(designPath))) ?? ''].filter(Boolean);
  const out: Finding[] = [];
  const visit = (ls: Layer[]): void => {
    for (const l of ls) {
      const kids = (l as { layers?: unknown }).layers;
      if (Array.isArray(kids)) visit(kids as Layer[]);
      if (l.type !== 'text') continue;
      const style = (l as { style?: { font_family?: unknown; font_weight?: unknown; text_transform?: unknown } }).style ?? {};
      if (typeof style.font_family !== 'string') continue;
      const face = metricsForFamily(style.font_family, dirs, numericWeight(style.font_weight));
      if (!face) continue;
      const raw = layerText(l);
      const text = style.text_transform === 'uppercase' ? raw.toUpperCase() : raw;
      const missing = [...new Set([...text])].filter(ch => {
        const cp = ch.codePointAt(0);
        return cp !== undefined && !silent(cp) && face.advance(cp) === undefined;
      });
      if (!missing.length) continue;
      out.push({ code: 'missing_glyph', severity: 'warning', layer_id: l.id,
        message: `"${l.id}" uses ${missing.slice(0, 4).map(label).join(', ')}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}, which ${style.font_family} does not have. The editor borrows it from another font; the export (PNG, PDF, GIF, MP4) draws the whole line in a fallback face instead, often at another weight.`,
        fix: `Write it with characters ${style.font_family} has ("≈" → "about", an emoji → an icon or image layer), or pick a font_family that has it.` });
    }
  };
  visit(layers);
  return out;
}

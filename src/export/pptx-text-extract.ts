// WP-5.1 — pick out the text layers a PPTX export can promote to NATIVE
// (editable + selectable) text boxes, and the ids to HIDE from the background
// raster so they aren't drawn twice. Conservative on purpose: only text whose
// appearance we can reproduce faithfully in OOXML is promoted; anything with a
// gradient/token colour, rotation, curve, effect, or a transformed ancestor
// stays baked in the raster ("keep raster fallback for effect-heavy layers"),
// so the slide is always visually unchanged.

import type { Layer } from '../schema/types';
import type { PptxText } from './pptx-export';

export interface ExtractResult {
  texts: PptxText[];
  hideIds: Set<string>;      // layer ids to render invisible in the background
}

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function plainText(content: unknown): string | null {
  if (!content || typeof content !== 'object') {
    return typeof content === 'string' ? content : null;
  }
  const c = content as { type?: string; value?: string; spans?: Array<{ text?: string }> };
  if (c.type === 'plain' || c.type === 'markdown') return typeof c.value === 'string' ? c.value : null;
  if (c.type === 'rich' && Array.isArray(c.spans)) return c.spans.map(s => s?.text ?? '').join('');
  // expression / unknown → not promotable (dynamic or unrecognized)
  return null;
}

function transformText(s: string, transform?: string): string {
  if (transform === 'uppercase') return s.toUpperCase();
  if (transform === 'lowercase') return s.toLowerCase();
  return s;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

// A text layer with no reproducible-appearance blockers → a PptxText.
function toPptxText(l: Record<string, unknown>): PptxText | null {
  if ((l as { rotation?: number }).rotation) return null;
  if ((l as { effects?: unknown }).effects) return null;
  const style = (l.style ?? {}) as Record<string, unknown>;
  if (style.text_path) return null;                        // curved text
  const color = style.color;
  if (typeof color !== 'string' || !HEX.test(color)) return null;   // only solid-hex

  const raw = plainText(l.content) ?? (typeof l.text === 'string' ? l.text as string : null);
  if (raw === null || raw.trim() === '') return null;
  const text = transformText(raw, style.text_transform as string | undefined);

  const x = num(l.x), y = num(l.y), w = num(l.width);
  if (x === null || y === null || w === null) return null;
  const sizePx = num(style.font_size) ?? 24;
  const lines = text.split('\n').length;
  const h = num(l.height) ?? Math.ceil(sizePx * (num(style.line_height) ?? 1.3) * lines);

  const alignRaw = (style.text_align ?? style.align) as string | undefined;
  const align = alignRaw === 'center' ? 'ctr' : alignRaw === 'right' ? 'r' : 'l';
  const valRaw = style.vertical_align as string | undefined;
  const valign = valRaw === 'middle' ? 'ctr' : valRaw === 'bottom' ? 'b' : 't';
  const weight = num(style.font_weight) ?? 400;
  const fam = typeof style.font_family === 'string' && !style.font_family.startsWith('$') ? style.font_family : undefined;

  return {
    text, x, y, w, h,
    sizePt: Math.round((sizePx * 72 / 96) * 10) / 10,
    color, bold: weight >= 600, italic: style.font_style === 'italic',
    align, valign, font: fam,
  };
}

/** Walk a layer tree; promote reproducible text layers. `blocked` = an ancestor
 *  group had a rotation/opacity/effect, so its descendants stay in the raster. */
export function extractPptxTexts(layers: Layer[], blocked = false): ExtractResult {
  const texts: PptxText[] = [];
  const hideIds = new Set<string>();
  const walk = (list: Layer[], isBlocked: boolean): void => {
    for (const layer of list) {
      const l = layer as unknown as Record<string, unknown>;
      if (layer.type === 'group' && Array.isArray(l.layers)) {
        const groupBlocks = !!l.rotation || !!l.effects || (num(l.opacity) !== null && (num(l.opacity) as number) < 1);
        walk(l.layers as Layer[], isBlocked || groupBlocks);
        continue;
      }
      if (layer.type !== 'text' || isBlocked) continue;
      const t = toPptxText(l);
      if (t && layer.id) { texts.push(t); hideIds.add(layer.id); }
    }
  };
  walk(layers, blocked);
  return { texts, hideIds };
}

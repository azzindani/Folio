/**
 * Fit a poster's canvas to the one full-bleed preset that IS the poster.
 *
 * A flow preset (sections/stat/…) builds its group at the origin sized to its
 * own content, so the document is fitted to it — HEIGHT (short → shorter page,
 * long → taller, no dead band, no spill) AND WIDTH, so a poster created on a
 * mismatched canvas (a 2000×1080 landscape doc holding a 1080-wide portrait
 * preset) does not render in a half-width column with its bottom clipped.
 * Full-canvas backdrop rects that came in with it are clamped to the new box,
 * so there is no strip of ground showing past the content.
 *
 * Only for a poster whose content this call created: a design that already had
 * layers, one with a camera world (wider than the canvas on purpose) or an add
 * into an existing group keeps its canvas.
 */

import type { DesignSpec, Layer } from '../schema/types';
import type { ProgressItem } from './types';
import { pInfo } from './engine/utils';
import { honorPosterRatio } from './poster-ratio';

export function autoFitPosterCanvas(spec: DesignSpec, incoming: Layer[], progress: ProgressItem[] = []): void {
  const { width: DW, height: DH } = spec.document;
  type Box = Layer & { x?: number; y?: number; width?: number; height?: number };
  const groups = incoming.filter(l => l.type === 'group') as Box[];
  const others = incoming.filter(l => l.type !== 'group') as Box[];
  const fullCanvasRect = (l: Box): boolean => l.type === 'rect'
    && (l.width ?? 0) >= DW * 0.9 && (l.height ?? 0) >= DH * 0.9;
  const g = groups.length === 1 ? groups[0] : undefined;
  if (g && others.every(fullCanvasRect)
    && (g.x ?? 0) <= DW * 0.02 && (g.y ?? 0) <= DH * 0.02
    && typeof g.width === 'number' && g.width > 0 && typeof g.height === 'number' && g.height > 0) {
    // The user/model created the doc with a deliberate standard portrait/
    // square ratio (4:5, 9:16, 1:1, …) → HONOR it instead of silently
    // resizing the canvas to the content's natural height (4:5 → 3:5).
    const ratioFit = honorPosterRatio(g as unknown as Layer, others as unknown as Layer[], DW, DH);
    if (ratioFit) {
      spec.document.width = ratioFit.width;
      spec.document.height = ratioFit.height;
      progress.push(pInfo(`Kept the requested ${DW}×${DH} aspect ratio`, `fit the content to a ${ratioFit.width}×${ratioFit.height} canvas (same shape) instead of reshaping it to the content's height`));
    } else {
      spec.document.width = g.width;
      spec.document.height = g.height;
      for (const r of others) {
        if ((r.height ?? 0) > g.height) r.height = g.height;
        if ((r.width ?? 0) > g.width) r.width = g.width;
      }
    }
  }
}

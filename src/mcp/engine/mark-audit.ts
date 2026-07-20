/**
 * The diagnose_design hook for mark geometry.
 *
 * Rasterises a design once and runs the measurements a model working without
 * eyes cannot do for itself. Deliberately opt-in by shape rather than by flag:
 * running a scale-survival sweep on a nine-page carousel would cost real time
 * for no benefit, so it only fires on the thing it is for — a small,
 * single-page design that is plausibly a mark.
 */

import type { DesignSpec } from '../../schema/types';
import type { RasterImage } from '../../utils/png-codec';
import { opticalCenter, scaleSurvival, type OpticalCenterResult, type ScaleSurvivalResult } from './marks';
import { markContrast, clearspace, type ContrastResult, type ClearspaceResult } from './marks-contrast';

export interface MarkAudit {
  optical_center: OpticalCenterResult;
  scale_survival: ScaleSurvivalResult;
  contrast: ContrastResult;
  clearspace: ClearspaceResult;
  notes: string[];
}

/**
 * Is this design plausibly a mark rather than a poster or a deck?
 *
 * Square-ish, single-page, not large, and not many layers. The test is
 * deliberately conservative: a false negative costs nothing (the caller can
 * still call the measurement functions directly), while a false positive
 * spends seconds rasterising a poster at six sizes to say nothing useful.
 */
export function looksLikeMark(spec: DesignSpec): boolean {
  if (spec.pages && spec.pages.length > 1) return false;
  const w = spec.document?.width ?? 0;
  const h = spec.document?.height ?? 0;
  if (w <= 0 || h <= 0) return false;

  const ratio = w / h;
  if (ratio < 0.6 || ratio > 1.67) return false;   // roughly square
  if (Math.max(w, h) > 1200) return false;          // posters are bigger

  const layers = spec.pages?.[0]?.layers ?? spec.layers ?? [];
  const count = countLayers(layers);
  return count > 0 && count <= 12;
}

function countLayers(layers: unknown[]): number {
  let n = 0;
  for (const l of layers) {
    n++;
    const kids = (l as { layers?: unknown[] }).layers;
    if (Array.isArray(kids)) n += countLayers(kids);
  }
  return n;
}

/** Run every mark measurement over an already-rasterised design. */
export function auditMark(img: RasterImage): MarkAudit {
  const oc = opticalCenter(img);
  const ss = scaleSurvival(img);
  const ct = markContrast(img);
  const cs = clearspace(img);

  const notes: string[] = [];

  if (oc.needsAdjustment) {
    const dx = Math.round(oc.offset.x * 10) / 10;
    const dy = Math.round(oc.offset.y * 10) / 10;
    // Say which way to move it, not merely that it is off — the direction is
    // the part a caller cannot work out from a number they cannot see.
    const parts: string[] = [];
    if (Math.abs(oc.offsetFraction.x) > 0.02) parts.push(`${Math.abs(dx)}px ${dx > 0 ? 'left' : 'right'}`);
    if (Math.abs(oc.offsetFraction.y) > 0.02) parts.push(`${Math.abs(dy)}px ${dy > 0 ? 'up' : 'down'}`);
    notes.push(
      `The mark's visual mass sits off its bounding-box centre. To look centred, nudge it ${parts.join(' and ')}. ` +
      'Box-centring is what makes a play triangle look pushed left.',
    );
  }

  notes.push(...ss.notes, ...ct.notes, ...cs.notes);
  return { optical_center: oc, scale_survival: ss, contrast: ct, clearspace: cs, notes };
}

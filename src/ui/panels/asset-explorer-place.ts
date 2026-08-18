// Asset explorer — putting an asset onto the canvas.
//
// The one place the file manager stops being a file manager and becomes part of
// the editor. Kept separate because it is the only code here that knows what a
// design layer is.
import type { StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';
import type { AssetRow } from './asset-explorer-io';

let insertCounter = 0;

/**
 * Add an image asset as a layer: centred, scaled to fit, on top.
 *
 * 60% of the canvas is the largest an unplanned drop should ever be — big
 * enough to see and work with, small enough that it never covers the design you
 * were dropping it onto.
 *
 * Fonts and docs are skipped: they have no visual form to place. `quiet`
 * suppresses the toast when placing a whole selection, so twenty files do not
 * mean twenty notifications.
 */
export function placeAsset(state: StateManager, a: AssetRow, quiet = false): void {
  if (a.kind === 'fonts' || a.kind === 'docs') return;
  const design = state.get().design;
  if (!design) return;

  const docW = design.document.width, docH = design.document.height;
  const w = a.width ?? 600, h = a.height ?? 400;
  const scale = Math.min(1, (docW * 0.6) / w, (docH * 0.6) / h);
  const lw = Math.round(w * scale), lh = Math.round(h * scale);
  const maxZ = Math.max(0, ...state.getCurrentLayers().map(l => l.z));
  const id = `${a.id}-${++insertCounter}`;

  state.addLayer({
    id, type: 'image', z: maxZ + 1,
    x: Math.round((docW - lw) / 2), y: Math.round((docH - lh) / 2),
    width: lw, height: lh,
    src: a.path, fit: 'cover',
    ...(a.alt ? { alt: a.alt } : {}),
  } as unknown as Layer);
  state.set('selectedLayerIds', [id]);

  if (!quiet) {
    void import('../../utils/toast').then(({ showToast }) =>
      showToast(`Placed ${a.path.split('/').pop() ?? a.path}`, 'success'));
  }
}

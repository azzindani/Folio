// Folio editor — resolve a design's style-pack references.
//
// A design may point at a palette / type pack / effects pack by ref rather than
// carrying the values inline. Each one is fetched lazily and dropped into the
// matching state slot when it lands; the renderer falls back to the base theme
// until then, so a slow fetch never blocks the first paint.
//
// Split out of app.ts to keep that file inside the line budget.
import type { StateManager } from './state';
import type { DesignSpec } from '../schema/types';
import { loadFullPalette } from '../styles/palette-loader';
import { loadFullTypePack } from '../styles/type-pack-loader';
import { loadFullEffectsPack } from '../styles/effects-pack-loader';

/**
 * Fire-and-forget: each pack lands independently.
 *
 * Every result is discarded unless `spec` is still the open design — switching
 * designs mid-fetch must not repaint the new one in the old one's palette.
 */
export function resolveStyleRefs(state: StateManager, spec: DesignSpec): void {
  if (spec.palette?.ref) {
    void loadFullPalette(spec.palette.ref).then(p => {
      if (p && state.get().design === spec) state.set('palette', p);
    });
  }
  if (spec.type_pack?.ref) {
    void loadFullTypePack(spec.type_pack.ref).then(tp => {
      if (tp && state.get().design === spec) state.set('typePack', tp);
    });
  }
  if (spec.effects_pack?.ref) {
    void loadFullEffectsPack(spec.effects_pack.ref).then(ep => {
      if (ep && state.get().design === spec) state.set('effectsPack', ep);
    });
  }
}

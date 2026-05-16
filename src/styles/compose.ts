/**
 * Theme composition — layer optional style primitives on top of a base
 * ThemeSpec without mutating the original.
 *
 * The renderer only knows about ThemeSpec. New axes (Palette, and later
 * TypePack / EffectsPack / RadiiPreset) compose into a ThemeSpec here
 * before the renderer ever sees them, so the renderer stays ignorant
 * of the composition machinery.
 *
 * Each axis overlays one slice of the theme:
 *   - PaletteSpec       overlays  theme.colors
 *   - (future) TypePack overlays  theme.typography
 *   - (future) FxPack   overlays  theme.effects
 *
 * Overlay = shallow merge at the section level: later wins on key
 * collision, anything not redeclared falls through to the base theme.
 */

import type { ThemeSpec, PaletteSpec } from '../schema/types';

export interface ComposeInputs {
  palette?: PaletteSpec;
  // typePack?: TypePackSpec;   ← reserved
  // effects?: EffectsPackSpec; ← reserved
}

/**
 * Returns a fresh ThemeSpec with the given primitives merged on top of
 * `base`. `base` is never mutated.
 *
 * If no primitives are supplied, returns the base theme unchanged
 * (still by reference — callers can rely on identity equality).
 */
export function composeTheme(base: ThemeSpec, inputs: ComposeInputs = {}): ThemeSpec {
  if (!inputs.palette) return base;

  return {
    ...base,
    colors: {
      ...base.colors,
      ...inputs.palette.colors,
    },
  };
}

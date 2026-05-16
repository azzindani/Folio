/**
 * Theme composition — layer optional style primitives on top of a base
 * ThemeSpec without mutating the original.
 *
 * The renderer only knows about ThemeSpec. New axes (Palette, TypePack,
 * EffectsPack) compose into a ThemeSpec here before the renderer ever
 * sees them, so the renderer stays ignorant of the composition machinery.
 *
 * Each axis overlays one slice of the theme:
 *   - PaletteSpec     overlays  theme.colors
 *   - TypePackSpec    overlays  theme.typography.families  (and .scale if set)
 *   - EffectsPackSpec overlays  theme.effects
 *
 * Overlay semantics = shallow merge at the section level: later wins on
 * key collision, anything not redeclared falls through to the base theme.
 */

import type { ThemeSpec, PaletteSpec, TypePackSpec, EffectsPackSpec } from '../schema/types';

export interface ComposeInputs {
  palette?: PaletteSpec;
  typePack?: TypePackSpec;
  effectsPack?: EffectsPackSpec;
}

/**
 * Returns a fresh ThemeSpec with the given primitives merged on top of
 * `base`. `base` is never mutated. Returns the base by reference when
 * no overlays are supplied so callers can rely on identity equality.
 */
export function composeTheme(base: ThemeSpec, inputs: ComposeInputs = {}): ThemeSpec {
  const { palette, typePack, effectsPack } = inputs;
  if (!palette && !typePack && !effectsPack) return base;

  const out: ThemeSpec = { ...base };

  if (palette) {
    out.colors = { ...base.colors, ...palette.colors };
  }

  if (typePack) {
    out.typography = {
      families: { ...base.typography.families, ...typePack.families },
      scale: typePack.scale
        ? { ...base.typography.scale, ...typePack.scale }
        : base.typography.scale,
    };
  }

  if (effectsPack) {
    out.effects = { ...base.effects, ...effectsPack.effects };
  }

  return out;
}

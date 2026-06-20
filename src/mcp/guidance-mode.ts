// Guidance tier — how much AESTHETIC prescription the engine pushes at the model.
//
//   full    (default) — the prescriptive house-style steering ("flat canvas, NO
//             gradient, Playfair/Anton, ONE accent, left-anchor"). A crutch that
//             keeps a vision-less mid-size model from shipping garbage.
//   minimal (frontier) — strip the aesthetic prescription; keep only the SPATIAL
//             scaffolding (presets measure + fit, group/locked preserves
//             placement, notes flag overflow/contrast). The model designs freely.
//
// §0.4: spatial correctness is the engine's job; aesthetic choice is the model's.
// On an unknown/mid-size instance keep `full`; set FOLIO_GUIDANCE=minimal on an
// instance a FRONTIER model connects to so its own design judgment isn't capped.
// Read at use-time (not import-time) so a test or a restart can flip it.
export type GuidanceMode = 'full' | 'minimal';

export function guidanceMode(): GuidanceMode {
  const v = (process.env.FOLIO_GUIDANCE ?? '').trim().toLowerCase();
  return v === 'minimal' || v === 'frontier' ? 'minimal' : 'full';
}

export function isMinimalGuidance(): boolean {
  return guidanceMode() === 'minimal';
}

// The neutral, free-compose replacement for the add_layers description's always-on
// aesthetic prescription (the main homogenizer the model sees on every compose).
export const COMPOSE_NEUTRAL = 'Compose FREELY — palette, type, color, composition and hierarchy are YOUR decisions; the engine imposes no house style. It does the SPATIAL work (measures every block, fits to canvas, prevents collisions) and returns advisory notes you can act on. Use a PRESET when one fits the intent (it guarantees the spatial layout) or hand-place for full control.';

// Strip the prescriptive aesthetic lead from the add_layers description, leaving
// everything from "ALWAYS PREFER A PRESET" onward (the spatial/preset guidance).
// Anchor-based so it's robust to the exact punctuation in the literal; a no-op
// when not minimal or the anchors aren't found.
export function freeComposeDescription(desc: string, minimal: boolean): string {
  if (!minimal) return desc;
  const PRE = 'in one call via layers_shorthand. ';
  const ANCHOR = ' ALWAYS PREFER A PRESET';
  const i = desc.indexOf(PRE), j = desc.indexOf(ANCHOR);
  if (i < 0 || j <= i) return desc;
  return desc.slice(0, i + PRE.length) + COMPOSE_NEUTRAL + desc.slice(j);
}

/**
 * The authored opacity a track's opacity multiplies — ONE rule for the
 * editor's CSS player and the exported frames, which disagreed.
 *
 * Frames multiplied the track by the layer's own opacity (x/y are offsets
 * from where the layer sits; opacity is relative the same way, so a 0.5
 * ghost that fades in lands at 0.5). The CSS player wrote the track's value
 * as the element's opacity, replacing the authored one: every partly
 * transparent layer that merely MOVED showed at full opacity in the editor.
 * And a layer authored at 0 and keyframed up to 0.9 — the natural way to
 * write "hidden until the glitch hits" (one-shot benchmark r2) — flashed in
 * the editor and never appeared in the GIF or the MP4, where 0 × 0.9 = 0.
 *
 * So: a track scales the authored opacity; an authored 0 on a layer whose
 * track animates opacity means hidden-until-shown, and the track reads as
 * absolute. A layer at 0 with no opacity channel stays hidden.
 */
export function opacityBase(authored: unknown, keyframes?: ReadonlyArray<Record<string, unknown>>): number {
  const a = typeof authored === 'number' && Number.isFinite(authored) ? Math.max(0, Math.min(1, authored)) : 1;
  if (a > 0) return a;
  return (keyframes ?? []).some(k => typeof k['opacity'] === 'number') ? 1 : 0;
}

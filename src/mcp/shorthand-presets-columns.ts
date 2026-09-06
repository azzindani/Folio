// `columns` — the landscape container.
//
// Review §1.1: every preset is portrait-first and overflows a 16:9 slide.
// `sections` wants 2016px of height on a 1920-wide canvas that has 1080; even
// `stat`, the guide's "only safe 16:9 one", wants 1152. Three deck rebuilds came
// out of that. What shipped since was the RESCUE (compress the preset into the
// box) and the HONESTY (measure it, document it, raise an error) — the deck
// still ends up squeezed, just knowingly.
//
// The structural answer is NOT a landscape-native preset. A canned wide recipe
// is exactly the template-stamp §0.4 forbids: every deck built from it would
// look like every other deck built from it. The guide already names the right
// move and asks the model to do it by hand:
//
//   "Hand-place into halves: two groups side by side, each ~900px wide, so each
//    column's preset sees a PORTRAIT box and sizes itself sanely."
//
// That is geometry, and geometry is the engine's job. `columns` does the split
// and hands each child a box; WHICH presets go in it, how many, how they are
// weighted and what they say stay entirely the model's decisions. A 1920×1080
// slide holding two columns gives each child ~900×920 — portrait, which is the
// shape every preset was built for. The 16:9 problem dissolves into the case
// the presets already handle well, without anyone being told what to draw.
import type { Layer } from '../schema/types';
import { shBox, type ShorthandLayer } from './shorthand-helpers';

/** Children may arrive under any of these — models reach for all three. */
function childrenOf(sh: ShorthandLayer): ShorthandLayer[] {
  const raw = sh as unknown as Record<string, unknown>;
  for (const key of ['cols', 'columns', 'items', 'layers']) {
    const v = raw[key];
    if (Array.isArray(v) && v.length) return v as ShorthandLayer[];
  }
  return [];
}

/** Column widths from optional weights. Junk weights fall back to equal shares
 *  rather than collapsing a column to nothing. */
export function columnWidths(inner: number, count: number, weights?: unknown): number[] {
  const w = Array.isArray(weights)
    ? weights.slice(0, count).map(n => (typeof n === 'number' && n > 0 ? n : 0))
    : [];
  const usable = w.length === count && w.every(n => n > 0) ? w : new Array<number>(count).fill(1);
  const total = usable.reduce((a, b) => a + b, 0);
  const out = usable.map(n => Math.floor((inner * n) / total));
  // Give the rounding remainder to the last column so the row fills its box
  // exactly — a 1px gutter on the right edge reads as a mistake.
  const drift = inner - out.reduce((a, b) => a + b, 0);
  if (out.length) out[out.length - 1] = (out[out.length - 1] ?? 0) + drift;
  return out;
}

/**
 * Lay children left-to-right across the box, each getting a full-height column.
 * Returns a plain group of POSITIONED shorthand children — the caller expands
 * them, so a column can hold any layer type, presets included, and nesting
 * works without this file knowing what any of them are.
 */
export function buildColumns(
  sh: ShorthandLayer, id: string, z: number,
  expand: (children: ShorthandLayer[]) => Layer[],
): Layer {
  const { X, Y, W, H } = shBox(sh, 1920, 1080);
  const raw = sh as unknown as Record<string, unknown>;
  const kids = childrenOf(sh);
  const askedGap = typeof raw['gap'] === 'number' ? Math.max(0, raw['gap']) : 56;
  const askedPad = typeof raw['pad'] === 'number' ? Math.max(0, raw['pad']) : 0;

  if (kids.length === 0) return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers: [] } as unknown as Layer;

  // Clamp both against the box they divide. Unclamped, a gap or pad larger than
  // the space available produced geometry that was not merely ugly but wrong:
  // gap 9999 in a 400px box gave the first column width 0 and put the second at
  // x=10099, thousands of pixels outside its own parent, with nothing reported.
  // A container's one job is that its children land inside it.
  const pad = Math.min(askedPad, Math.floor(Math.min(W, H) / 4));
  const maxGap = kids.length > 1
    ? Math.max(0, Math.floor((W - pad * 2 - kids.length) / (kids.length - 1)))
    : 0;
  const gap = Math.min(askedGap, maxGap);

  const innerW = Math.max(1, W - pad * 2 - gap * (kids.length - 1));
  const innerH = Math.max(1, H - pad * 2);
  const widths = columnWidths(innerW, kids.length, raw['weights']);

  let cursor = X + pad;
  const placed: ShorthandLayer[] = kids.map((kid, i) => {
    const cw = widths[i] ?? 0;
    // An explicit pos on a child is honoured — the escape hatch matters more
    // than the tidiness of the row, and a model that positioned something on
    // purpose should not have the container silently move it.
    const positioned: ShorthandLayer = kid.pos
      ? kid
      : { ...kid, pos: [Math.round(cursor), Math.round(Y + pad), Math.round(cw), Math.round(innerH)] };
    cursor += cw + gap;
    return positioned;
  });

  return {
    id, type: 'group', z, x: X, y: Y, width: W, height: H,
    layers: expand(placed),
  } as unknown as Layer;
}

// Fallback expansion for layer types the expander does not model — split from
// shorthand-expand.ts to keep that file inside the 700-line budget.
import type { Layer } from '../schema/types';
import type { ShorthandLayer } from './shorthand-helpers';


/**
 * Shorthand keys that have already been consumed into `base`, or that only
 * ever mean something to the expander. Everything else on an unknown type is
 * the caller's own vocabulary and must survive.
 */
const CONSUMED_SHORTHAND_KEYS = new Set([
  'type', 'id', 'z', 'pos', 'position', 'at', 'size', 'x', 'y', 'width', 'height',
  'opacity', 'rotation', 'rotate', 'angle', 'flip_h', 'flip_v', 'visible', 'locked', 'link',
  'repeat', 'repeat_data', 'span', 'flow_h',
]);

/**
 * Carry an unrecognised layer type through with its fields intact.
 *
 * This branch used to return `{ ...base, type }` under a comment claiming it
 * passed through as-is — but `base` is geometry only, so EVERY other field was
 * dropped. That silently broke the whole interactive-component vocabulary:
 * `interactive_chart`, `interactive_table`, `callout`, `filter_bar`, `tabs`,
 * `toggle` and friends are not expander cases, so a report authored exactly as
 * the engine guide documents lost its `data_ref`, `chart_type`, `x_field`,
 * `columns` and `content` on the way in. The design stored fine, rendered
 * empty, and the HTML export then crashed on the missing data_ref.
 *
 * Dropping unknown keys is never the safe default: the expander cannot know
 * what a type it does not model requires, so the only correct behaviour is to
 * preserve what it was given and let the renderer and `report(op:validate)`
 * judge it.
 */
export function passThroughUnknown(sh: ShorthandLayer, base: Record<string, unknown>): Layer {
  const out: Record<string, unknown> = { ...base, type: sh.type };
  for (const [key, value] of Object.entries(sh)) {
    if (CONSUMED_SHORTHAND_KEYS.has(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out as unknown as Layer;
}


/**
 * Carry flow-report grid placement onto any layer type.
 *
 * A flow layer is sized by `span` (1–12 columns) and `flow_h`, not by pixels —
 * computeFlowLayout turns those into real geometry at render time. They must
 * ride on the shared base so EVERY type keeps them: dropping them left the
 * layer with no width at all, and add_layers rejected the whole call with
 * "needs a positive width" for a report authored exactly as the guide documents.
 */
export function applyFlowGrid(sh: ShorthandLayer, base: Record<string, unknown>): void {
  const span = (sh as { span?: unknown }).span;
  if (typeof span === 'number' && span > 0) base['span'] = span;
  const flowH = (sh as { flow_h?: unknown }).flow_h;
  if (typeof flowH === 'number' && flowH > 0) base['flow_h'] = flowH;
}

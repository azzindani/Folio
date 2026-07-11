// WP-4.7 — path-boolean runner, split out of properties-panel.ts to keep it
// under the 700-line budget. Merges two shape layers into one NEW `path` layer
// (union/subtract/intersect/exclude). Subtract = bottom − top. Sources are
// removed; the result inherits the bottom layer's fill.

import type { StateManager } from '../../editor/state';
import type { Layer } from '../../schema/types';

export type BoolOp = 'union' | 'subtract' | 'intersect' | 'exclude';

export async function runPathBoolean(
  state: StateManager, top: Layer, bottom: Layer, op: BoolOp, btn: HTMLButtonElement,
): Promise<void> {
  btn.disabled = true;
  try {
    const { booleanPathD } = await import('../../editor/boolean-ops');
    const [a, b] = op === 'subtract' ? [bottom, top] : [top, bottom];
    const d = await booleanPathD(a, b, op);
    if (!d) {
      const { showToast } = await import('../../utils/toast');
      showToast('Boolean produced no shape (do the layers overlap?)', 'error');
      return;
    }
    const src = bottom as unknown as { fill?: unknown; stroke?: unknown; opacity?: number };
    const result = {
      id: `bool-${op}-${Math.max(top.z, bottom.z)}-${bottom.id.slice(0, 6)}`,
      type: 'path', d,
      z: Math.max(top.z, bottom.z),
      ...(src.fill !== undefined ? { fill: src.fill } : { fill: { type: 'solid', color: '#6c5ce7' } }),
      ...(src.stroke !== undefined ? { stroke: src.stroke } : {}),
      ...(src.opacity !== undefined ? { opacity: src.opacity } : {}),
    } as unknown as Layer;
    state.batch(() => {
      state.removeLayer(top.id);
      state.removeLayer(bottom.id);
      state.addLayer(result);
      state.set('selectedLayerIds', [result.id]);
    });
  } finally {
    btn.disabled = false;
  }
}

/**
 * Keep the two places animation lives in agreement.
 *
 * A design carries animation in two shapes, and both are load-bearing:
 *
 *   layer.animation    per-layer, where the MCP ops write and where the
 *                      SVG/GIF export paths read
 *   spec.animations    a top-level map keyed by layer id, which is what the
 *                      EDITOR loads into state and turns into the <style>
 *                      block on its canvas (app.ts lifts it, canvas-base.ts
 *                      injects it)
 *
 * Nothing kept them in sync, so a design animated over MCP exported with
 * motion and opened in the editor completely static — the editor was looking
 * at a field the tools never wrote. The schema documents the top-level map as
 * the editor-facing one, so it is a mirror rather than a second source of
 * truth: per-layer stays authoritative, this projects it.
 *
 * Written server-side deliberately. Teaching the editor to read `layer.animation`
 * would work equally well but needs a client bundle rebuild, and building the
 * editor on this host OOMs it.
 */

import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';

type AnimatedLayer = Layer & { animation?: AnimationSpec; layers?: Layer[] };

/** Every layer id that carries an animation, across all pages and nested groups. */
export function collectSpecAnimations(spec: DesignSpec): Record<string, AnimationSpec> {
  const out: Record<string, AnimationSpec> = {};

  const visit = (layer: AnimatedLayer): void => {
    if (layer.animation && typeof layer.id === 'string') out[layer.id] = layer.animation;
    if (Array.isArray(layer.layers)) for (const c of layer.layers) visit(c as AnimatedLayer);
  };

  for (const l of spec.layers ?? []) visit(l as AnimatedLayer);
  for (const page of spec.pages ?? []) {
    for (const l of page.layers ?? []) visit(l as AnimatedLayer);
  }

  return out;
}

/**
 * Refresh `spec.animations` from the layer tree, in place.
 *
 * Rebuilt from scratch rather than merged, so removing a layer's animation
 * actually removes it: a merge would leave the old entry behind and the editor
 * would keep animating a layer the design says is still.
 *
 * Returns the number of animated layers, for the caller's progress output.
 */
export function syncAnimationsToSpec(spec: DesignSpec): number {
  const anims = collectSpecAnimations(spec);
  const count = Object.keys(anims).length;

  const target = spec as DesignSpec & { animations?: Record<string, AnimationSpec> };
  if (count === 0) {
    delete target.animations;
  } else {
    target.animations = anims;
  }

  return count;
}

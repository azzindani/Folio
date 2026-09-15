import type { DesignSpec } from '../schema/types';

/**
 * A design plays as scenes once it has two pages or more.
 *
 * Kept apart from scene-player so the toolbar can decide whether to show Play
 * all without importing the scene compositor: that import put the editor's main
 * bundle past its 500KB budget, so the player and its stage load on first use.
 */
export function playsAsScenes(design: DesignSpec | null | undefined): boolean {
  return (design?.pages?.length ?? 0) >= 2;
}

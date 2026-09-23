/**
 * The animation map for the ONE page the editor canvas paints.
 *
 * The editor holds animation in a flat map keyed by layer id (spec.animations,
 * the server's mirror of each layer's own track). Ids repeat across pages —
 * every slide of a deck has its "title" and its "disc" — and a flat map keeps
 * one entry per id, the last page's. So the canvas played slide 6's title
 * entrance on slide 1 (one-shot benchmark r2, a six-scene explainer), while
 * Play and the export, which read each layer's own track, were right.
 *
 * Only the page on screen is painted, so only its ids are kept, in the map's
 * order (stagger sequences fire in the order the YAML declared). Where an id
 * also lives on another page the map cannot say whose entry it holds, and the
 * layer's own track wins.
 */
import type { Layer } from '../schema/types';
import type { AnimationSpec } from './types';

type Tracked = Layer & { animation?: AnimationSpec; layers?: Layer[] };

function walk(layers: ReadonlyArray<Layer>, visit: (l: Tracked) => void): void {
  for (const l of layers) {
    visit(l as Tracked);
    const kids = (l as Tracked).layers;
    if (Array.isArray(kids)) walk(kids, visit);
  }
}

export function pageAnimations(
  map: Readonly<Record<string, AnimationSpec>>,
  page: ReadonlyArray<Layer>,
  pages: ReadonlyArray<ReadonlyArray<Layer>>,
): Map<string, AnimationSpec> {
  const seen = new Map<string, number>();
  for (const p of pages) {
    const onThis = new Set<string>();
    walk(p, l => { if (typeof l.id === 'string') onThis.add(l.id); });
    for (const id of onThis) seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  const own = new Map<string, AnimationSpec | undefined>();
  walk(page, l => { if (typeof l.id === 'string' && !own.has(l.id)) own.set(l.id, l.animation); });

  const out = new Map<string, AnimationSpec>();
  for (const [id, anim] of Object.entries(map)) {
    if (!own.has(id)) continue;
    const mine = own.get(id);
    if ((seen.get(id) ?? 0) > 1) { if (mine) out.set(id, mine); }
    else out.set(id, anim);
  }
  return out;
}

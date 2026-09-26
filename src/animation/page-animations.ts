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
 * order (stagger sequences fire in the order the YAML declared).
 *
 * The layer's own track always wins. The map is a mirror, loaded with the file:
 * the timeline writes the track, so a keyframe dragged or an easing shaped
 * there played on the canvas at the timing the file was opened with (seen
 * live, B4). The map only fills in a layer with no track of its own — in an
 * older file it is the only copy — and only where its id is on one page.
 */
import type { DesignSpec, Layer } from '../schema/types';
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
    if (mine) out.set(id, mine);
    else if ((seen.get(id) ?? 0) <= 1) out.set(id, anim);
  }
  // A track the map has never heard of: given on the timeline since the file was opened.
  for (const [id, mine] of own) if (mine && !out.has(id)) out.set(id, mine);
  return out;
}

type WithMap = DesignSpec & { animations?: Record<string, AnimationSpec> };

/**
 * The design as saved: its top-level `animations` map refreshed from the
 * layers' own tracks, so a save never writes back the timing the file was
 * opened with. The map's order is kept (new tracks follow in layer order); an
 * entry whose layer has no track of its own is kept, since in an older file it
 * is the only copy, and one whose layer is gone is dropped.
 */
export function withAnimationMirror(design: DesignSpec): DesignSpec {
  const tracks = new Map<string, AnimationSpec>();
  const present = new Set<string>();
  // A motion rule is not mirrored: the canvas and every export resolve it into its track.
  const ruled = new Set<string>();
  const trees = [design.layers ?? [], ...(design.pages ?? []).map(p => p.layers ?? [])];
  for (const tree of trees) walk(tree, l => {
    if (typeof l.id !== 'string') return;
    present.add(l.id);
    if (l.animation?.rule) ruled.add(l.id);
    else if (l.animation) tracks.set(l.id, l.animation);
  });
  const old = (design as WithMap).animations ?? {};
  const next: Record<string, AnimationSpec> = {};
  for (const [id, anim] of Object.entries(old)) {
    if (ruled.has(id)) continue;
    const mine = tracks.get(id);
    if (mine) next[id] = mine;
    else if (present.has(id)) next[id] = anim;
  }
  for (const [id, mine] of tracks) if (!(id in next)) next[id] = mine;
  const { animations: _stale, ...rest } = design as WithMap;
  void _stale;
  return Object.keys(next).length ? { ...rest, animations: next } as DesignSpec : rest as DesignSpec;
}

/**
 * A frame — or a band of one — that draws exactly what an earlier one drew is not
 * rasterised again. Holds, rests and static overlays are most of a video's frames,
 * and on a busy host every resvg pass is CPU the encoder and decoder need.
 *
 * Identity is the SVG text with its def ids renumbered: the renderer mints
 * gradient/clip ids from a global counter, so one frame serialises as `lg-1` and
 * the next, identical one as `lg-4` — different bytes, the same pixels.
 */

/** The SVG with every def id replaced by its order of appearance, so equal drawings give equal keys. */
export function svgKey(svg: string): string {
  const ids = new Map<string, string>();
  for (const m of svg.matchAll(/\sid="([^"]+)"/g)) {
    const id = m[1] ?? '';
    if (!ids.has(id)) ids.set(id, `~${ids.size}`);
  }
  if (!ids.size) return svg;
  return svg.replace(/(\sid="|url\(#|href="#)([^")]+)/g, (all: string, pre: string, id: string) => {
    const c = ids.get(id);
    return c === undefined ? all : pre + c;
  });
}

/** The last few distinct rasters, by key. Callers must not mutate what they are given. */
export class RasterMemo<T> {
  private readonly held = new Map<string, Promise<T>>();
  hits = 0;

  constructor(private readonly size = 6) {}

  get(key: string, make: () => Promise<T>): Promise<T> {
    const hit = this.held.get(key);
    if (hit) {
      this.hits++;
      this.held.delete(key);
      this.held.set(key, hit);
      return hit;
    }
    const made = make();
    this.held.set(key, made);
    // A failed render is not remembered: the next ask tries again.
    made.catch(() => { if (this.held.get(key) === made) this.held.delete(key); });
    while (this.held.size > this.size) this.held.delete(this.held.keys().next().value ?? key);
    return made;
  }
}

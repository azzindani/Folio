// A rendered frame cut into what lies between its clips, in paint order.
//
// SVG paints in document order, so "under the clip" is everything before the
// clip's element and "over it" everything after — at any depth. A slice keeps
// the nodes strictly between two clips and the ancestors they sit in (shallow
// copies: the transform, clip and opacity of a camera or a group still apply),
// so a clip inside a group is cut out as cleanly as one at the top level.

/** Each node's place in document order: [its own index, its last descendant's]. */
export type TreeIndex = Map<Node, [number, number]>;

export function indexTree(root: Node): TreeIndex {
  const idx: TreeIndex = new Map();
  let i = 0;
  const visit = (n: Node): void => {
    const start = i++;
    for (const c of Array.from(n.childNodes)) visit(c);
    idx.set(n, [start, i - 1]);
  };
  visit(root);
  return idx;
}

/** A copy of `n` holding only what lies strictly between indices lo and hi; null when none of it does. */
export function sliceNode(n: Node, idx: TreeIndex, lo: number, hi: number): Node | null {
  const r = idx.get(n);
  if (!r) return null;
  const [s, e] = r;
  if (s > lo && e < hi) return n.cloneNode(true);
  if (e <= lo || s >= hi) return null;
  const copy = n.cloneNode(false);
  for (const c of Array.from(n.childNodes)) {
    const part = sliceNode(c, idx, lo, hi);
    if (part) copy.appendChild(part);
  }
  return copy;
}

/** Whether a node paints anything: an element other than an empty group shell. */
export function paints(n: Node): boolean {
  if (n.nodeType !== 1) return false;
  if ((n as Element).nodeName.toLowerCase() !== 'g') return true;
  return Array.from(n.childNodes).some(paints);
}

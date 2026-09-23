/**
 * The pieces of a split line, joined back into the line they read as — the
 * view the static checks judge.
 *
 * op:text and split_text turn one line into a text layer per word or letter
 * (each behind its own mask with mask:true). A reader sees one line; the
 * critic saw eleven: "10 different left edges", two words "almost
 * left-aligned (off by 2.0px)", an accent "on 12 layers" (benchmark r5,
 * right after an op:text). Joined here, each line is one block again: the
 * union of its pieces' boxes, their words, the first piece's style — and the
 * first piece's id, so a finding still names a layer that exists.
 */

import type { Layer } from '../../schema/types';

type Node = Layer & { layers?: Layer[]; split_of?: unknown; animation?: unknown };

const MASK = /_mask\d+$/;

/** The piece a layer is, unwrapped from its mask group — or null. */
function pieceOf(l: Layer): Node | null {
  const n = l as Node;
  if (typeof n.split_of === 'string') return n;
  const only = n.type === 'group' && MASK.test(n.id) && n.layers?.length === 1 ? n.layers[0] as Node | undefined : undefined;
  return only && typeof only.split_of === 'string' ? only : null;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const said = (l: Node): string => {
  const c = (l as { content?: { value?: unknown } }).content;
  return typeof c?.value === 'string' ? c.value : '';
};

/** One text layer standing for a split line's pieces. */
function joined(pieces: Node[]): Layer {
  const first = pieces[0] as Node;
  const size = num((first as { style?: { font_size?: unknown } }).style?.font_size) || 16;
  const x0 = Math.min(...pieces.map(p => num(p.x))), y0 = Math.min(...pieces.map(p => num(p.y)));
  const x1 = Math.max(...pieces.map(p => num(p.x) + num(p.width))), y1 = Math.max(...pieces.map(p => num(p.y) + num(p.height)));
  // Lines by baseline, then left to right; letters join without a space, words with one.
  const lines: Node[][] = [];
  for (const p of [...pieces].sort((a, b) => num(a.y) - num(b.y) || num(a.x) - num(b.x))) {
    const line = lines.find(l => Math.abs(num(l[0]?.y) - num(p.y)) < size / 2);
    if (line) line.push(p); else lines.push([p]);
  }
  const text = lines.map(l => {
    const ordered = [...l].sort((a, b) => num(a.x) - num(b.x));
    return ordered.map(said).join(ordered.every(p => [...said(p).trim()].length <= 1) ? '' : ' ');
  }).join('\n');
  const { animation: _a, split_of: _s, ...rest } = first;
  return { ...rest, x: x0, y: y0, width: x1 - x0, height: y1 - y0, content: { type: 'plain', value: text } } as unknown as Layer;
}

/** `layers` with every split line joined back into one block, at any depth. Unsplit layers pass through as they are. */
export function joinSplitPieces(layers: Layer[]): Layer[] {
  const byLine = new Map<string, Node[]>();
  for (const l of layers) {
    const p = pieceOf(l);
    if (p) byLine.set(String(p.split_of), [...(byLine.get(String(p.split_of)) ?? []), p]);
  }
  const placed = new Set<string>();
  const out: Layer[] = [];
  for (const l of layers) {
    const p = pieceOf(l);
    if (p) {
      const line = String(p.split_of);
      if (!placed.has(line)) { placed.add(line); out.push(joined(byLine.get(line) ?? [p])); }
      continue;
    }
    const kids = (l as Node).layers;
    out.push(Array.isArray(kids) ? ({ ...l, layers: joinSplitPieces(kids) } as Layer) : l);
  }
  return out;
}

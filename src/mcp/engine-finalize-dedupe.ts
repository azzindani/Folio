// Folio MCP engine — seal-time duplicate-SECTION collapse (WP-3.5).
//
// A thrashing blind model re-issues the same add_layers call and stacks the
// same preset block down the page (live 120B run: "What's Inside" ×5, the
// offer block ×2, canvas ballooned 1350 → 4826px). Each copy is a GROUP, so
// the older text-level dedup (top-level texts, gated on duplicate full-canvas
// backdrops) never sees it.
//
// Signature = the normalized concatenation of every descendant text value.
// Two top-level layers sharing a ≥24-char signature is thrash, not design —
// deliberate repetition (column labels, background typography) is short or
// differs somewhere. Keep the FIRST copy in flow (topmost), drop the rest,
// and close each removed band by shifting everything below it up.
import type { Layer } from '../schema/types';
import { layerBBox, layerText } from './engine-finalize-geom';

const MIN_SIG_CHARS = 24;

function norm(s: string): string {
  return s.replace(/[–—]/g, '-').replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Normalized text content of a layer INCLUDING all descendants, in order. */
function textSignature(l: Layer): string {
  const parts: string[] = [];
  const visit = (x: Layer): void => {
    if (!x) return;
    if (x.type === 'text') {
      const v = norm(layerText(x));
      if (v) parts.push(v);
    }
    const kids = (x as unknown as Record<string, unknown>)['layers'];
    if (Array.isArray(kids)) for (const k of kids as Layer[]) visit(k);
  };
  visit(l);
  return parts.join('\n');
}

interface Node { arr: Layer[]; idx: number; layer: Layer; top: boolean }

/** Every layer at every depth, with its containing array (for splicing). */
function collectNodes(layers: Layer[]): Node[] {
  const out: Node[] = [];
  const visit = (arr: Layer[], top: boolean): void => {
    for (let i = 0; i < arr.length; i++) {
      const l = arr[i];
      if (!l) continue;
      out.push({ arr, idx: i, layer: l, top });
      const kids = (l as unknown as Record<string, unknown>)['layers'];
      if (Array.isArray(kids)) visit(kids as Layer[], false);
    }
  };
  visit(layers, true);
  return out;
}

/** Splice a set of layers out of their arrays (safe for nested removals). */
function remove(nodes: Node[]): void {
  // Per-array, delete from the highest index down so earlier splices don't
  // shift later ones.
  const byArr = new Map<Layer[], number[]>();
  for (const n of nodes) byArr.set(n.arr, [...(byArr.get(n.arr) ?? []), n.idx]);
  for (const [arr, idxs] of byArr) for (const i of [...new Set(idxs)].sort((a, b) => b - a)) arr.splice(i, 1);
}

/**
 * Remove duplicated content among layers at ANY depth — whole repeated
 * blocks (identical text signature) plus stacked short-text echoes — and
 * compact the vertical space of removed TOP-LEVEL blocks.
 * Mutates `layers`. Returns removed count.
 */
export function collapseDuplicateSections(layers: Layer[], docW: number, docH: number): number {
  if (!Array.isArray(layers) || layers.length < 2) return 0;

  const nodes = collectNodes(layers);

  // Pass 1 — duplicated BLOCKS: same full text signature (≥24 chars) at any
  // depth. Keep the copy highest in the flow; skip nodes nested inside an
  // already-dropped ancestor (their array gets spliced with the ancestor).
  const bySig = new Map<string, Node[]>();
  for (const n of nodes) {
    const sig = textSignature(n.layer);
    if (sig.length < MIN_SIG_CHARS) continue;
    bySig.set(sig, [...(bySig.get(sig) ?? []), n]);
  }
  const dropNodes: Node[] = [];
  const dropped = new Set<Layer>();
  const insideDropped = (n: Node): boolean => {
    for (const d of dropped) {
      const kids = (d as unknown as Record<string, unknown>)['layers'];
      if (Array.isArray(kids) && (kids as Layer[]).includes(n.layer)) return true;
    }
    return false;
  };
  for (const group of bySig.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => layerBBox(a.layer).y - layerBBox(b.layer).y);
    // A parent and its own child share a signature when the parent has one
    // text-bearing child — never drop the child of a KEPT parent.
    const kept = sorted[0];
    const keptKids = (kept.layer as unknown as Record<string, unknown>)['layers'];
    for (const n of sorted.slice(1)) {
      if (Array.isArray(keptKids) && (keptKids as Layer[]).includes(n.layer)) continue;
      if (insideDropped(n)) continue;
      dropNodes.push(n); dropped.add(n.layer);
    }
  }

  // Pass 2 — stacked ECHOES: identical shorter text (≥12 chars) repeated
  // directly below itself (x-overlap, small vertical gap). Deliberate echoes
  // (a brand word top + bottom) sit far apart and are left alone.
  const texts = collectNodes(layers) // re-collect: pass 1 marks, nothing spliced yet
    .filter(n => !dropped.has(n.layer) && !insideDropped(n) && n.layer.type === 'text')
    .map(n => ({ n, v: norm(layerText(n.layer)), b: layerBBox(n.layer) }))
    .filter(t => t.v.length >= 12)
    .sort((a, b) => a.b.y - b.b.y);
  for (let i = 0; i < texts.length; i++) {
    const a = texts[i];
    if (dropped.has(a.n.layer)) continue;
    for (let j = i + 1; j < texts.length; j++) {
      const c = texts[j];
      if (dropped.has(c.n.layer) || c.v !== a.v) continue;
      const ah = Math.max(20, a.b.b - a.b.y);
      const dy = c.b.y - a.b.y;
      const xOverlap = Math.min(a.b.r, c.b.r) - Math.max(a.b.x, c.b.x);
      if (dy <= Math.max(2.5 * ah, 140) && xOverlap > 0.5 * Math.min(a.b.r - a.b.x, c.b.r - c.b.x)) {
        dropNodes.push(c.n); dropped.add(c.n.layer);
      }
    }
  }

  // Pass 3 — repeated IMAGES, gated on thrash already being detected above:
  // the copies a rebuild pass stamped (same src, same dims) survive passes
  // 1–2 when their section's text was unique-ified. Never fires on a clean
  // design; keeps the first of each (src, w×h) pair. Full-bleed washes with
  // distinct dims are naturally distinct keys.
  if (dropNodes.length) {
    const seen = new Set<string>();
    for (const n of collectNodes(layers)) {
      if (dropped.has(n.layer) || insideDropped(n) || n.layer.type !== 'image') continue;
      const rec = n.layer as unknown as Record<string, unknown>;
      const src = String(rec['src'] ?? '');
      if (!src) continue;
      const b = layerBBox(n.layer);
      const key = `${src}|${Math.round((b.r - b.x) / 10)}x${Math.round((b.b - b.y) / 10)}`;
      if (seen.has(key)) { dropNodes.push(n); dropped.add(n.layer); }
      else seen.add(key);
    }
  }

  if (!dropNodes.length) return 0;

  const removed = dropNodes.length;
  remove(dropNodes);

  // Compact: the removals leave holes wherever the duplicated blocks sat
  // (they overlap each other, so per-band arithmetic double-counts). Instead
  // walk the SURVIVING top-level content in y order and collapse any vertical
  // gap beyond MAX_GAP. Only runs on thrash (something was removed), so a
  // deliberate airy layout is never squeezed. Backdrops don't move or count.
  const MAX_GAP = 160;
  const isBackdrop = (l: Layer): boolean => {
    const b = layerBBox(l);
    return (b.r - b.x) >= docW * 0.9 && (b.b - b.y) >= docH * 0.9;
  };
  const flow = layers
    .filter(l => l && !isBackdrop(l) && typeof (l as unknown as Record<string, unknown>)['y'] === 'number')
    .map(l => ({ l, b: layerBBox(l) }))
    .sort((a, b) => a.b.y - b.b.y);
  let shift = 0;
  let maxBottom = flow.length ? flow[0].b.y : 0;   // leading top margin is deliberate — keep it
  for (const item of flow) {
    const top = item.b.y - shift;
    const gap = top - maxBottom;
    if (gap > MAX_GAP) shift += gap - MAX_GAP;
    if (shift > 0) {
      const rec = item.l as unknown as Record<string, unknown>;
      rec['y'] = (rec['y'] as number) - shift;
    }
    maxBottom = Math.max(maxBottom, item.b.b - shift);
  }
  return removed;
}

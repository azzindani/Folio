// Scatter doodle system. A library of small hand-drawn marks (sparkle, star,
// squiggle, swirl, arrow, blob, leaf, plus, ring, dot, triangle) plus a SEEDED
// scatterer that sprinkles them across a box while avoiding keep-out regions. This
// is the playful confetti the reference mind maps / posters carry in their margins.
// Math is deterministic (seeded, no Math.random) so a render is reproducible.
import type { Layer } from '../schema/types';
import { shStr, shBox, seededDefaults, ShorthandLayer } from './shorthand-helpers';

export type DoodleKind =
  | 'spark' | 'star' | 'squiggle' | 'swirl' | 'arrow' | 'blob'
  | 'leaf' | 'plus' | 'ring' | 'dot' | 'triangle' | 'corner';

export const DOODLE_KINDS: DoodleKind[] = ['spark', 'star', 'squiggle', 'swirl', 'arrow', 'blob', 'leaf', 'plus', 'ring', 'dot', 'triangle', 'corner'];

const R = (n: number): number => Math.round(n * 100) / 100;

// Each glyph is drawn relative to its center (cx,cy) within a half-size `s`. Stroke
// glyphs return a path with a stroke; solid glyphs return a filled path/shape. A
// rotation is baked via the layer transform (x/y/w/h give the pivot).
function glyphPath(kind: DoodleKind, cx: number, cy: number, s: number): { d: string; filled: boolean } {
  switch (kind) {
    case 'spark': { // 4-point sparkle
      const i = s * 0.34;
      return { filled: true, d: `M${R(cx)} ${R(cy - s)} L${R(cx + i)} ${R(cy - i)} L${R(cx + s)} ${R(cy)} L${R(cx + i)} ${R(cy + i)} L${R(cx)} ${R(cy + s)} L${R(cx - i)} ${R(cy + i)} L${R(cx - s)} ${R(cy)} L${R(cx - i)} ${R(cy - i)} Z` };
    }
    case 'star': { // 5-point star
      const pts: string[] = [];
      for (let k = 0; k < 10; k++) {
        const ang = -Math.PI / 2 + (k * Math.PI) / 5;
        const r = k % 2 ? s * 0.42 : s;
        pts.push(`${k ? 'L' : 'M'}${R(cx + Math.cos(ang) * r)} ${R(cy + Math.sin(ang) * r)}`);
      }
      return { filled: true, d: pts.join(' ') + ' Z' };
    }
    case 'squiggle': // 2.5 sine humps
      return { filled: false, d: `M${R(cx - s)} ${R(cy)} Q${R(cx - s * 0.5)} ${R(cy - s)} ${R(cx)} ${R(cy)} Q${R(cx + s * 0.5)} ${R(cy + s)} ${R(cx + s)} ${R(cy)}` };
    case 'swirl': // open curl / spiral
      return { filled: false, d: `M${R(cx + s)} ${R(cy)} C${R(cx + s)} ${R(cy - s)} ${R(cx - s)} ${R(cy - s)} ${R(cx - s)} ${R(cy)} C${R(cx - s)} ${R(cy + s * 0.7)} ${R(cx + s * 0.4)} ${R(cy + s * 0.7)} ${R(cx + s * 0.4)} ${R(cy + s * 0.1)}` };
    case 'arrow': // little curved arrow
      return { filled: false, d: `M${R(cx - s)} ${R(cy - s * 0.4)} Q${R(cx)} ${R(cy - s)} ${R(cx + s * 0.7)} ${R(cy + s * 0.2)} M${R(cx + s * 0.7)} ${R(cy + s * 0.2)} L${R(cx + s * 0.1)} ${R(cy + s * 0.05)} M${R(cx + s * 0.7)} ${R(cy + s * 0.2)} L${R(cx + s * 0.5)} ${R(cy - s * 0.55)}` };
    case 'blob':
      return { filled: true, d: `M${R(cx - s)} ${R(cy - s * 0.2)} C${R(cx - s)} ${R(cy - s)} ${R(cx)} ${R(cy - s)} ${R(cx + s * 0.6)} ${R(cy - s * 0.6)} C${R(cx + s * 1.1)} ${R(cy - s * 0.2)} ${R(cx + s)} ${R(cy + s * 0.7)} ${R(cx + s * 0.2)} ${R(cy + s)} C${R(cx - s * 0.6)} ${R(cy + s * 1.05)} ${R(cx - s)} ${R(cy + s * 0.5)} ${R(cx - s)} ${R(cy - s * 0.2)} Z` };
    case 'leaf':
      return { filled: true, d: `M${R(cx)} ${R(cy - s)} C${R(cx + s)} ${R(cy - s * 0.4)} ${R(cx + s)} ${R(cy + s * 0.4)} ${R(cx)} ${R(cy + s)} C${R(cx - s)} ${R(cy + s * 0.4)} ${R(cx - s)} ${R(cy - s * 0.4)} ${R(cx)} ${R(cy - s)} Z` };
    case 'plus':
      return { filled: false, d: `M${R(cx)} ${R(cy - s)} L${R(cx)} ${R(cy + s)} M${R(cx - s)} ${R(cy)} L${R(cx + s)} ${R(cy)}` };
    case 'triangle':
      return { filled: false, d: `M${R(cx)} ${R(cy - s)} L${R(cx + s)} ${R(cy + s * 0.7)} L${R(cx - s)} ${R(cy + s * 0.7)} Z` };
    case 'corner': // small right-angle bracket
      return { filled: false, d: `M${R(cx - s)} ${R(cy - s)} L${R(cx - s)} ${R(cy + s)} L${R(cx + s)} ${R(cy + s)}` };
    case 'ring':
    case 'dot':
    default:
      return { filled: kind === 'dot', d: '' }; // ring/dot use an ellipse element, handled by caller
  }
}

/** One doodle as 1 layer (path or ellipse). */
export function doodleLayer(kind: DoodleKind, id: string, z: number, cx: number, cy: number, size: number, color: string, rot: number, sw: number): Layer {
  const s = size / 2;
  if (kind === 'ring' || kind === 'dot') {
    return { id, type: 'ellipse', z, x: R(cx - s), y: R(cy - s), width: R(size), height: R(size),
      ...(kind === 'dot' ? { fill: { type: 'solid', color } } : { stroke: { color, width: sw } }) } as unknown as Layer;
  }
  const { d, filled } = glyphPath(kind, cx, cy, s);
  const base = { id, type: 'path', z, x: R(cx - s), y: R(cy - s), width: R(size), height: R(size), d, rotation: rot } as Record<string, unknown>;
  // Stroke glyphs omit fill entirely → renderPath defaults to fill="none".
  if (filled) base['fill'] = { type: 'solid', color };
  else base['stroke'] = { color, width: sw, linecap: 'round', linejoin: 'round' };
  return base as unknown as Layer;
}

// ── Seeded scatter ──────────────────────────────────────────
export interface KeepOut { x: number; y: number; w: number; h: number }
export interface ScatterBox { X: number; Y: number; W: number; H: number }
export interface ScatterOpts {
  count: number; colors: string[]; idp: string; z0: number; seed: number;
  sizeMin: number; sizeMax: number; sw: number; kinds?: DoodleKind[];
  keepOut?: KeepOut[]; opacity?: number;
}

// Deterministic PRNG (mulberry32) — seeded so a design renders identically.
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function inKeepOut(px: number, py: number, pad: number, ko?: KeepOut[]): boolean {
  if (!ko) return false;
  return ko.some(k => px > k.x - pad && px < k.x + k.w + pad && py > k.y - pad && py < k.y + k.h + pad);
}

/** Sprinkle `count` doodles across `box`, skipping keep-out regions. Uses a jittered
 *  grid walked in seeded order so marks spread evenly without a top-left bias. */
export function scatterLayers(box: ScatterBox, o: ScatterOpts): Layer[] {
  const rnd = prng(o.seed || 1);
  const kinds = o.kinds && o.kinds.length ? o.kinds : DOODLE_KINDS;
  const aspect = box.W / Math.max(1, box.H);
  const cols = Math.max(2, Math.round(Math.sqrt(o.count * aspect) + 0.5));
  const rows = Math.max(2, Math.ceil((o.count * 1.8) / cols));
  const cells: number[] = [];
  for (let i = 0; i < cols * rows; i++) cells.push(i);
  for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }

  const out: Layer[] = [];
  let n = 0;
  for (const cell of cells) {
    if (n >= o.count) break;
    const c = cell % cols, r = Math.floor(cell / cols);
    const cw = box.W / cols, ch = box.H / rows;
    const px = box.X + (c + 0.2 + rnd() * 0.6) * cw;
    const py = box.Y + (r + 0.2 + rnd() * 0.6) * ch;
    const size = o.sizeMin + rnd() * (o.sizeMax - o.sizeMin);
    if (inKeepOut(px, py, size * 0.6 + 8, o.keepOut)) continue;
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const color = o.colors[Math.floor(rnd() * o.colors.length)];
    const rot = Math.round((rnd() - 0.5) * 60);
    const L = doodleLayer(kind, `${o.idp}_d${n}`, o.z0 + n, px, py, size, color, rot, o.sw);
    if (o.opacity != null) (L as unknown as { opacity: number }).opacity = o.opacity;
    out.push(L);
    n++;
  }
  return out;
}

// ── Preset: a standalone scatter the model can drop as decor ─
const WHEEL = ['#E6483D', '#F4A024', '#3F9A4E', '#2E6FB7', '#7A4E9E', '#E26C8E'];
export function buildDoodles(sh: ShorthandLayer, id: string, z: number): Layer {
  const r = sh as Record<string, unknown>;
  const { X, Y, W, H } = shBox(sh);
  const m = seededDefaults(r, [id, shStr(r['topic'])]);
  const accent = shStr(r['accent'], m?.accent ?? '#E6483D');
  const palette = (Array.isArray(r['palette']) ? r['palette'] : (m?.palette ?? [])).filter((c): c is string => typeof c === 'string');
  const colors = palette.length >= 2 ? palette : [accent, ...WHEEL];
  const density = shStr(r['density']).toLowerCase();
  const count = typeof r['count'] === 'number' ? r['count'] as number : density === 'sparse' ? 8 : density === 'dense' ? 26 : 16;
  const seed = Math.abs([...id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) | 0, 5));
  const kindsArg = Array.isArray(r['kinds']) ? (r['kinds'] as string[]).filter(k => (DOODLE_KINDS as string[]).includes(k)) as DoodleKind[] : undefined;
  const layers = scatterLayers({ X, Y, W, H }, {
    count, colors, idp: id, z0: 0, seed, sizeMin: Math.round(W * 0.025), sizeMax: Math.round(W * 0.055),
    sw: Math.max(2, Math.round(W * 0.006)), kinds: kindsArg, opacity: typeof r['opacity'] === 'number' ? r['opacity'] as number : 0.9,
  });
  return { id, type: 'group', z, x: X, y: Y, width: W, height: H, layers } as unknown as Layer;
}

// Legible at the moment it is seen (phase 2, A1).
//
// The contrast checks judge text against a SOLID colour painted under it; text
// over a photo, footage or a gradient was skipped as "backdrop unknown"
// (engine-finalize-legibility) and nothing else looked. So the one case where
// legibility fails most — words over an image — was the one case never measured.
//
// This reads what the viewer SEES. The page (or a shot's rest pose) is
// rendered as it is, and once more as a mask of where the glyphs fall. Each
// glyph pixel at a letter's edge is compared with the non-glyph pixels right
// around it, both as seen: so a scrim painted OVER the words, a fade, a layer
// covering them, count against it — and a shadow or outline that lifts them
// counts for it. (A first cut compared the text's own colour with a text-free
// render and passed white type sunk under a 70% scrim: live A1 check.) The
// result: the share of those edges under WCAG (4.5:1; 3:1 large; 2:1 display),
// the median, how busy the ground is. What to do stays the model's call.
import type { Layer } from '../../schema/types';
import { IDENTITY, poseAffine, compose, mapBox, type Affine } from './layout-pose';
import { drawnBox } from '../../export/frame-geometry';
import { relativeLuminance } from './marks-contrast';
import { isDisplaySize } from './caps-tracking';

export interface SeenText { id: string; x: number; y: number; w: number; h: number; px: number; bold: boolean; rgb: [number, number, number] }
export interface TextOnGround {
  id: string; font_px: number; needs: number;
  /** Median contrast of its letters' edges against what surrounds them, as seen. */
  median: number;
  /** Share of its letters' edges, as seen, under `needs`. */
  below: number;
  /** Luminance spread of that ground, 0 (flat) … 0.5 (noise). */
  busy: number;
}

/** WCAG's 3:1 is for large TEXT; a numeral filling a third of the screen reads
 *  at less (APCA's floors fall with size). A 760px yellow 3 on tomato, 2.5:1,
 *  is plainly legible (benchmark r2). Display size = the caps-tracking rule. */
const DISPLAY_NEEDS = 2;
/** Faint on purpose — a watermark numeral, a ghost — is not copy to be read. */
const FAINT = 0.5;
const kids = (l: Layer): Layer[] | null => { const k = (l as { layers?: unknown }).layers; return Array.isArray(k) ? (k as Layer[]) : null; };

function hex(c: unknown): [number, number, number] | null {
  if (typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c)) return null;
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}

/** Every text a viewer can read, where it is seen: poses carried down, opacity multiplied. */
export function seenTexts(layers: Layer[], at: Affine = IDENTITY, alpha = 1, out: SeenText[] = []): SeenText[] {
  for (const l of layers) {
    const o = l as unknown as { opacity?: unknown; visible?: unknown; style?: { color?: unknown; font_size?: unknown; font_weight?: unknown } };
    const a = alpha * (typeof o.opacity === 'number' ? o.opacity : 1);
    if (o.visible === false || a < FAINT) continue;
    const pose = poseAffine(l);
    const here = pose ? compose(at, pose) : at;
    const inner = kids(l);
    if (inner) { seenTexts(inner, here, a, out); continue; }
    if (l.type !== 'text') continue;
    const rgb = hex(o.style?.color), px = o.style?.font_size, b = drawnBox(l);
    if (!rgb || typeof px !== 'number' || !b) continue;
    const g = mapBox(here, { x: b.x, y: b.y, w: b.width, h: b.height });
    const weight = Number(o.style?.font_weight ?? 400);
    out.push({ id: l.id, ...g, px: px * here.sy, bold: weight >= 700, rgb });
  }
  return out;
}

const PAINT = ['fill', 'stroke', 'effects', 'background', 'shadow'];

/** The glyph mask: every text a viewer reads, in solid black, and nothing else — poses
 *  kept. A faint text is left out: a glitch ghost waiting at opacity 0 marked ink
 *  where the viewer sees plain ground, and a whole title read 1:1 (benchmark b09). */
export function textMask(layers: Layer[], alpha = 1): Layer[] {
  return layers.flatMap(l => {
    const o = l as unknown as { opacity?: unknown; visible?: unknown; style?: Record<string, unknown> };
    const a = alpha * (typeof o.opacity === 'number' ? o.opacity : 1);
    if (o.visible === false || a < FAINT) return [];
    const inner = kids(l);
    if (inner) {
      const bare = { ...l, opacity: 1, layers: textMask(inner, a) } as unknown as Record<string, unknown>;
      for (const k of PAINT) delete bare[k];
      return [bare as unknown as Layer];
    }
    if (l.type !== 'text') return [];
    const style: Record<string, unknown> = { ...(o.style ?? {}), color: '#000000' };
    delete style['stroke']; delete style['highlight'];
    const t = { ...l, style, opacity: 1 } as unknown as Record<string, unknown>;
    delete t['effects'];
    return [t as unknown as Layer];
  });
}

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const lumAt = (px: Uint8Array, i: number): number => relativeLuminance([px[i] ?? 0, px[i + 1] ?? 0, px[i + 2] ?? 0]);
/** Mask coverage (black ink on white). A glyph pixel is one wholly inside a stroke — a
 *  part-covered edge pixel is part ground, and read small type (a 3.5:1 label) as
 *  failing; its surround is pixels with almost no ink. */
const INK = 0.9, CLEAR = 0.1, RING = 2;
/** A ground whose luminance spreads this much (p10–p90) is varied, not flat. */
const VARIED = 0.1;

/** Each text as seen: its letters' edges against what surrounds them, in the full render (RGBA, rw×rh for a W×H canvas). */
export function textOnGround(full: Uint8Array, mask: Uint8Array, rw: number, rh: number, W: number, H: number, texts: SeenText[]): TextOnGround[] {
  const sx = rw / W, sy = rh / H;
  const inkAt = (x: number, y: number): number => 1 - (mask[(y * rw + x) * 4] ?? 255) / 255;
  return texts.flatMap(t => {
    const x0 = Math.max(0, Math.floor(t.x * sx)), x1 = Math.min(rw, Math.ceil((t.x + t.w) * sx));
    const y0 = Math.max(0, Math.floor(t.y * sy)), y1 = Math.min(rh, Math.ceil((t.y + t.h) * sy));
    if (x1 <= x0 || y1 <= y0) return [];
    const needs = isDisplaySize(t.px, Math.min(W, H)) ? DISPLAY_NEEDS : t.px >= 24 || (t.bold && t.px >= 18.66) ? 3 : 4.5;
    const cr: number[] = [], ground: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const m = inkAt(x, y);
      if (m <= CLEAR) { ground.push(lumAt(full, (y * rw + x) * 4)); continue; }
      if (m < INK) continue;
      const around: number[] = [];
      for (let v = Math.max(0, y - RING); v <= Math.min(rh - 1, y + RING); v++) {
        for (let u = Math.max(0, x - RING); u <= Math.min(rw - 1, x + RING); u++) if (inkAt(u, v) <= CLEAR) around.push(lumAt(full, (v * rw + u) * 4));
      }
      if (!around.length) continue;                        // the middle of a stroke — edges decide
      around.sort((a, b) => a - b);
      cr.push(contrast(lumAt(full, (y * rw + x) * 4), around[Math.floor(around.length / 2)] ?? 0));
    }
    if (!cr.length) return [];
    cr.sort((a, b) => a - b); ground.sort((a, b) => a - b);
    const q = (v: number[], p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    return [{ id: t.id, font_px: Math.round(t.px), needs, median: r2(q(cr, 0.5)), below: r2(cr.filter(c => c < needs).length / cr.length), busy: r2(q(ground, 0.9) - q(ground, 0.1)) }];
  });
}

/** Hard to read: its typical edge is under the bar, or a real share is on a varied
 *  ground (a photo — some letters sit on light, some on dark). On a flat ground the
 *  median IS the contrast; the share there is anti-aliasing (an 18px 4.8:1 list). */
export function hardToRead(t: TextOnGround): boolean {
  return t.median < t.needs || (t.below >= 0.2 && t.busy >= VARIED);
}

/** The texts a viewer will struggle to read, as sentences. */
export function legibilityNotes(r: TextOnGround[]): string[] {
  return r.filter(hardToRead).map(t => {
    const ground = t.busy >= 0.25 ? 'a busy ground' : 'its ground';
    return `"${t.id}" (${t.font_px}px) reads under ${t.needs}:1 against ${ground} along ${Math.round(t.below * 100)}% of its letters' edges (median ${t.median}:1).`;
  });
}

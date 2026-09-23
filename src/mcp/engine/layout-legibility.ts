// Legible at the moment it is seen (phase 2, A1).
//
// The contrast checks judge text against a SOLID colour painted under it; text
// over a photo, footage or a gradient was skipped as "backdrop unknown"
// (engine-finalize-legibility) and nothing else looked. So the one case where
// legibility fails most — words over an image — was the one case never measured.
//
// The review already renders every page (and every shot's rest pose). This
// renders it once more WITHOUT its text, and reads the pixels that sit behind
// each visible text's drawn lines: the share of that ground too close to the
// text's colour to read (WCAG: 3:1 for large type, 4.5:1 otherwise), the
// median contrast, and how busy the ground is. Numbers and places; what to do —
// a scrim, a shadow, another spot, another colour — stays the model's call.
import type { Layer } from '../../schema/types';
import { IDENTITY, poseAffine, compose, mapBox, type Affine } from './layout-pose';
import { drawnBox } from '../../export/frame-geometry';
import { relativeLuminance } from './marks-contrast';
import { isDisplaySize } from './caps-tracking';

export interface SeenText { id: string; x: number; y: number; w: number; h: number; px: number; bold: boolean; rgb: [number, number, number] }
export interface TextOnGround {
  id: string; font_px: number; needs: number;
  /** Median contrast of the text against the ground behind it. */
  median: number;
  /** Share of the ground behind the text under `needs`. */
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

/** The layers with every text leaf left out — what the words sit on. */
export function withoutText(layers: Layer[]): Layer[] {
  return layers.filter(l => l.type !== 'text').map(l => {
    const inner = kids(l);
    return inner ? ({ ...l, layers: withoutText(inner) } as Layer) : l;
  });
}

const contrast = (a: number, b: number): number => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** Each text against the pixels behind it in the text-free render (RGBA, rw×rh for a W×H canvas). */
export function textOnGround(backdrop: Uint8Array, rw: number, rh: number, W: number, H: number, texts: SeenText[]): TextOnGround[] {
  const sx = rw / W, sy = rh / H;
  return texts.flatMap(t => {
    const x0 = Math.max(0, Math.floor(t.x * sx)), x1 = Math.min(rw, Math.ceil((t.x + t.w) * sx));
    const y0 = Math.max(0, Math.floor(t.y * sy)), y1 = Math.min(rh, Math.ceil((t.y + t.h) * sy));
    if (x1 <= x0 || y1 <= y0) return [];
    const lt = relativeLuminance(t.rgb);
    const needs = isDisplaySize(t.px, Math.min(W, H)) ? DISPLAY_NEEDS : t.px >= 24 || (t.bold && t.px >= 18.66) ? 3 : 4.5;
    const lum: number[] = [], cr: number[] = [];
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const i = (y * rw + x) * 4;
      const l = relativeLuminance([backdrop[i] ?? 0, backdrop[i + 1] ?? 0, backdrop[i + 2] ?? 0]);
      lum.push(l); cr.push(contrast(lt, l));
    }
    cr.sort((a, b) => a - b); lum.sort((a, b) => a - b);
    const q = (v: number[], p: number): number => v[Math.min(v.length - 1, Math.floor(p * v.length))] ?? 0;
    const r2 = (v: number): number => Math.round(v * 100) / 100;
    return [{ id: t.id, font_px: Math.round(t.px), needs, median: r2(q(cr, 0.5)), below: r2(cr.filter(c => c < needs).length / cr.length), busy: r2(q(lum, 0.9) - q(lum, 0.1)) }];
  });
}

/** The texts a viewer will struggle to read, as sentences. */
export function legibilityNotes(r: TextOnGround[]): string[] {
  return r.filter(t => t.below >= 0.2).map(t => {
    const ground = t.busy >= 0.25 ? 'a busy ground' : 'its ground';
    return `"${t.id}" (${t.font_px}px) is under ${t.needs}:1 against ${ground} behind ${Math.round(t.below * 100)}% of it (median ${t.median}:1).`;
  });
}

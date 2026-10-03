// Pan and zoom inside a clip — which part of the footage the frame keeps.
//
// `video.focus: [x, y]` is an ALIGNMENT, the way CSS object-position reads it:
// [0, 0] keeps the footage's top-left corner in the frame, [1, 1] its bottom-
// right, [0.5, 0.5] its middle. `video.zoom` (1 = the footage just covers the
// box) enlarges it about that same point. Read this way, three renderers agree
// with no need to know the file's size: ffmpeg's crop at (iw−ow)·x, CSS's
// object-position + scale(zoom) about x%, and the export's cropped frame grab.
// `video.pan` keys the two over time on the FILE clock, so a move stays on the
// footage it follows when the clip is trimmed, moved or split.

import type { Layer } from '../schema/types';
import { resolveEasing } from './easing';

export interface PanKey { at_ms: number; focus?: [number, number]; zoom?: number; easing?: string }
export interface ClipCrop { focus: [number, number]; zoom: number }
export const MAX_ZOOM = 4;
const CENTRE: ClipCrop = { focus: [0.5, 0.5], zoom: 1 };

type Croppable = Layer & { focal?: unknown; video?: { focus?: unknown; zoom?: unknown; pan?: unknown } };

const unit = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const pair = (v: unknown): [number, number] | null => {
  if (!Array.isArray(v) || v.length !== 2) return null;
  const x = unit(v[0]), y = unit(v[1]);
  return x === null || y === null ? null : [x, y];
};
const zoomOf = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? Math.max(1, Math.min(MAX_ZOOM, v)) : null);
/** The older `focal` point snapped to thirds (start / middle / end), as it always rendered. */
const third = (v: number): number => (v < 0.34 ? 0 : v > 0.66 ? 1 : 0.5);

/** The crop a clip rests at: video.focus/zoom, else its legacy `focal` in thirds, else centred. */
export function baseCrop(l: Layer): ClipCrop {
  const o = l as Croppable;
  const focus = pair(o.video?.focus) ?? (() => { const f = pair(o.focal); return f ? [third(f[0]), third(f[1])] as [number, number] : null; })();
  return { focus: focus ?? CENTRE.focus, zoom: zoomOf(o.video?.zoom) ?? 1 };
}

/** The clip's pan keys, valid and in file order. */
export function panKeys(l: Layer): PanKey[] {
  const raw = (l as Croppable).video?.pan;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((k): PanKey[] => {
    const r = k as Record<string, unknown>;
    if (typeof r['at_ms'] !== 'number' || !Number.isFinite(r['at_ms'])) return [];
    const focus = pair(r['focus']), zoom = zoomOf(r['zoom']);
    if (!focus && zoom === null) return [];
    return [{ at_ms: r['at_ms'], ...(focus ? { focus } : {}), ...(zoom !== null ? { zoom } : {}), ...(typeof r['easing'] === 'string' ? { easing: r['easing'] } : {}) }];
  }).sort((a, b) => a.at_ms - b.at_ms);
}

/** True when the clip shows anything but its centred, unzoomed cover. */
export function hasCrop(l: Layer): boolean {
  const c = baseCrop(l);
  return c.zoom !== 1 || c.focus[0] !== 0.5 || c.focus[1] !== 0.5 || panKeys(l).length > 0;
}

/**
 * The crop at a moment of the FILE. Each key carries what it does not set from
 * the key before (the first from the resting crop); before the first key and
 * after the last the crop holds; between two it eases with the earlier key's
 * easing (default ease-in-out).
 */
export function cropAt(l: Layer, fileMs: number): ClipCrop {
  const base = baseCrop(l);
  const keys = panKeys(l);
  if (!keys.length) return base;
  const full: ClipCrop[] = [];
  keys.forEach((k, i) => { const prev = full[i - 1] ?? base; full.push({ focus: k.focus ?? prev.focus, zoom: k.zoom ?? prev.zoom }); });
  const first = keys[0] as PanKey, last = keys[keys.length - 1] as PanKey;
  if (fileMs <= first.at_ms) return full[0] as ClipCrop;
  if (fileMs >= last.at_ms) return full[full.length - 1] as ClipCrop;
  const i = keys.findIndex((k, j) => fileMs >= k.at_ms && fileMs < (keys[j + 1]?.at_ms ?? Infinity));
  const a = full[i] as ClipCrop, b = full[i + 1] as ClipCrop, ka = keys[i] as PanKey, kb = keys[i + 1] as PanKey;
  const p = resolveEasing(ka.easing ?? 'ease-in-out')((fileMs - ka.at_ms) / Math.max(1, kb.at_ms - ka.at_ms));
  const mix = (x: number, y: number): number => x + (y - x) * p;
  return { focus: [mix(a.focus[0], b.focus[0]), mix(a.focus[1], b.focus[1])], zoom: mix(a.zoom, b.zoom) };
}

/** The crop as CSS on a cover-fitted <video>/<img>: aligned by object-position, enlarged about the same point. */
export function cropCss(c: ClipCrop): string {
  const x = `${+(c.focus[0] * 100).toFixed(3)}%`, y = `${+(c.focus[1] * 100).toFixed(3)}%`;
  return `object-fit:cover;object-position:${x} ${y};transform-origin:${x} ${y};transform:scale(${+c.zoom.toFixed(4)})`;
}

/** A crop as asked for through op:video, checked: focus [x, y] in 0–1, zoom 1–MAX_ZOOM, pan keys on the file clock. The reason as a string when unusable. */
export function readCropArgs(a: { focus?: unknown; zoom?: unknown; pan?: unknown }): { focus?: [number, number] | null; zoom?: number | null; pan?: PanKey[] | null } | string {
  const out: { focus?: [number, number] | null; zoom?: number | null; pan?: PanKey[] | null } = {};
  if (a.focus !== undefined) {
    if (a.focus !== null && !(Array.isArray(a.focus) && a.focus.length === 2 && a.focus.every(v => typeof v === 'number' && v >= 0 && v <= 1))) return 'focus must be [x, y], each 0–1 ([0.5, 0.5] = the middle of the footage).';
    out.focus = a.focus === null ? null : [a.focus[0], a.focus[1]] as [number, number];
  }
  if (a.zoom !== undefined) {
    if (a.zoom !== null && !(typeof a.zoom === 'number' && a.zoom >= 1 && a.zoom <= MAX_ZOOM)) return `zoom must be 1–${MAX_ZOOM} (1 = the footage just covers the box).`;
    out.zoom = a.zoom === null ? null : a.zoom;
  }
  if (a.pan !== undefined) {
    if (a.pan === null) out.pan = null;
    else {
      if (!Array.isArray(a.pan) || !a.pan.length) return 'pan must be a list of keys [{at_ms, focus?, zoom?, easing?}] (null clears).';
      const keys: PanKey[] = [];
      for (const raw of a.pan) {
        const k = (raw ?? {}) as Record<string, unknown>;
        if (typeof k['at_ms'] !== 'number' || !(k['at_ms'] >= 0)) return 'each pan key needs at_ms: where in the FILE it lands (the clock asset_read stamps on the storyboard).';
        const checked = readCropArgs({ focus: k['focus'], zoom: k['zoom'] });
        if (typeof checked === 'string') return `pan key at ${String(k['at_ms'])} ms: ${checked}`;
        if (checked.focus === undefined && checked.zoom === undefined) return `pan key at ${String(k['at_ms'])} ms sets neither focus nor zoom.`;
        keys.push({ at_ms: Math.round(k['at_ms']), ...(checked.focus ? { focus: checked.focus } : {}), ...(typeof checked.zoom === 'number' ? { zoom: checked.zoom } : {}), ...(typeof k['easing'] === 'string' ? { easing: k['easing'] } : {}) });
      }
      out.pan = keys.sort((p, q) => p.at_ms - q.at_ms);
    }
  }
  return out;
}

// A frame with footage, split for drawing as pixels (export/footage-composite.ts).
//
// The frame is rendered ONCE by the normal renderer with each clip's picture left
// blank, then its paint order is cut at every clip (svg-slice.ts — at any depth):
// band 0 is what lies under the first clip, band 1 what lies between it and the
// next, and so on. Each band rasterises as a transparent layer; the decoded clips
// go between them. A clip is cut out this way when it is plain (a box, a fit, an
// opacity, its clock, a pose and a wipe) and every group above it only moves,
// scales, fades or clips it (footage-place.ts) — a camera world, a transition's
// wrapper. Anything else (mask, rotation, effects, a layout) sends the whole frame
// down the embedded path, which draws everything the renderer can.

import type { DesignSpec, Layer } from '../../schema/types';
import { renderToSVGElement, serializeSVGElement } from './svg-export';
import { frameRequest, type FrameRequest } from './video-frame';
import { videoFit } from '../../renderer/layer-renderers-video';
import type { ClipFit } from './video-decode';
import { clipRect, drawClip, overBand } from '../../export/footage-composite';
import { resampleRegion } from '../../export/footage-crop';
import { baseCrop, cropAt, panKeys, type ClipCrop } from '../../animation/clip-crop';
import { placeClips, type ClipPlace } from './footage-place';
import { indexTree, paints, sliceNode } from './svg-slice';
import type { Box } from '../../export/frame-geometry';

/**
 * Fields a clip may carry and still be drawn as pixels. `_frame_pose` is the flipbook's readout
 * (the renderer ignores it): a pose that moves the clip arrives as `transform`, which is not plain.
 */
const PLAIN_KEYS = new Set([
  'id', 'type', 'name', 'src', 'x', 'y', 'width', 'height', 'z', 'fit', 'focal', 'opacity', 'visible', 'locked',
  'video', 'in', 'out', 'alt', 'role', 'muted', 'volume', '_video_file', '_video_ms', '_video_frame', '_video_cut', '_video_lut', '_frame_pose',
]);
/** What a placed clip may carry besides: its pose and its wipe, both read into its place. */
const PLACED_KEYS = new Set([...PLAIN_KEYS, 'transform', 'clip_rect']);

/** One pixel, transparent: the clip's stand-in, so it renders as an ordinary <image> carrying its id. */
const BLANK = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=';

export interface FootageSlot {
  req: FrameRequest;
  x: number; y: number; w: number; h: number;
  fit: ClipFit;
  /** Which part of the footage the box keeps at this frame (animation/clip-crop.ts). */
  crop: ClipCrop;
  /** The crop moves (video.pan): decoded once at `zoomMax`, cut per frame. */
  panned: boolean;
  zoomMax: number;
  /** The clip's key and grade as ffmpeg filters (animation/clip-key.ts, clip-color.ts), or null. */
  grade: string | null;
  opacity: number;
  /** Where its picture lands on the canvas (its box moved and scaled by every group above), and the window it shows through. */
  canvas: Box;
  window: Box | null;
}

/** Graphics bands around the clips: bands[i] lies under slots[i]; the last band is on top. Band 0 is always drawn. */
export interface BandedFrame { bands: Array<string | null>; slots: FootageSlot[] }

/** The clip as pixels, or null when something about it needs the renderer. `place` is where footage-place.ts put it. */
export function plainClip(l: Layer, place?: ClipPlace): FootageSlot | null {
  if (l.type !== 'video') return null;
  const allowed = place ? PLACED_KEYS : PLAIN_KEYS;
  for (const [k, v] of Object.entries(l)) if (v !== undefined && v !== null && !allowed.has(k)) return null;
  const fit = videoFit(l.fit);
  const req = frameRequest(l);
  if (fit === 'none' || !req) return null;
  const keys = panKeys(l);
  const zoomMax = Math.max(baseCrop(l).zoom, ...keys.map(k => k.zoom ?? 1));
  const opacity = l.visible === false ? 0 : typeof l.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1;
  const x = l.x ?? 0, y = l.y ?? 0;
  return {
    req, x, y, w: req.w, h: req.h, fit, crop: cropAt(l, req.ms), panned: keys.length > 0, zoomMax, grade: req.grade ?? null,
    opacity: place ? place.opacity : opacity, canvas: place?.box ?? { x, y, width: req.w, height: req.h }, window: place?.window ?? null,
  };
}

/** Every video layer in the tree, in tree order. */
function videosIn(layers: Layer[], out: Layer[] = []): Layer[] {
  for (const l of layers) {
    if (l.type === 'video') out.push(l);
    const kids = (l as { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) videosIn(kids, out);
  }
  return out;
}

/** The tree with every clip's picture blank: the frame the bands are cut from. */
function blanked(layers: Layer[]): Layer[] {
  return layers.map(l => {
    if (l.type === 'video') return { ...l, _video_frame: BLANK } as Layer;
    const kids = (l as { layers?: Layer[] }).layers;
    return Array.isArray(kids) ? ({ ...l, layers: blanked(kids) } as Layer) : l;
  });
}

const SHARED = new Set(['defs', 'style']);

/** Whether an element sits inside another carrying the same layer id (a wrapper the renderer added). */
function nestedIn(el: Element, id: string): boolean {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.getAttribute('data-layer-id') === id) return true;
  return false;
}

/** The frame cut into bands around its clips, or null to draw it the embedded way. */
export function bandedFrame(spec: DesignSpec): BandedFrame | null {
  const top = spec.layers ?? [];
  const clips = videosIn(top);
  if (spec.pages?.length || !clips.length) return null;
  const places = placeClips(top);
  if (!places) return null;
  const slots = new Map<string, FootageSlot>();
  for (const l of clips) {
    const place = places.get(l.id);
    const slot = place ? plainClip(l, place) : null;
    if (!slot) return null;
    slots.set(l.id, slot);
  }
  const svg = renderToSVGElement({ ...spec, layers: blanked(top) });
  // Each clip's outermost element, in paint (document) order.
  const els = Array.from(svg.querySelectorAll('[data-layer-id]')).filter(el => {
    const id = el.getAttribute('data-layer-id') ?? '';
    return slots.has(id) && !nestedIn(el, id);
  });
  // A clip the renderer wrapped, repeated or left out — let the renderer draw it all.
  if (els.length !== slots.size || new Set(els.map(el => el.getAttribute('data-layer-id'))).size !== els.length) return null;
  const shared = Array.from(svg.childNodes).filter(n => SHARED.has(n.nodeName.toLowerCase()));
  const idx = indexTree(svg);
  const bounds = els.map(el => idx.get(el) ?? [0, 0]);
  const bands = bounds.concat([[Infinity, Infinity]]).map(([start], i) => {
    const lo = i === 0 ? -1 : (bounds[i - 1]?.[1] ?? -1), hi = start;
    const root = svg.cloneNode(false) as SVGSVGElement;
    for (const n of shared) root.appendChild(n.cloneNode(true));
    let drawn = false;
    for (const n of Array.from(svg.childNodes)) {
      if (shared.includes(n)) continue;
      const part = sliceNode(n, idx, lo, hi);
      if (part) { root.appendChild(part); drawn ||= paints(part); }
    }
    return i > 0 && !drawn ? null : serializeSVGElement(root);
  });
  return { bands, slots: els.map(el => slots.get(el.getAttribute('data-layer-id') ?? '') as FootageSlot) };
}

export interface Painted { width: number; height: number; pixels: Buffer }

/** How a banded frame gets its pixels: a band rasterised (band 0 on the frame's ground; rasters may be shared, never written), a clip decoded at w×h. */
export interface BandPainter {
  render(svg: string, ground: boolean): Promise<Painted>;
  clip(slot: FootageSlot, w: number, h: number): Promise<Buffer | null>;
}

/** Zoom steps a scaled clip decodes at: a camera push restarts the clip's decoder only when it crosses one. */
const ZOOM_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4];

/** Where a clip lands in output pixels. Moved but not scaled, it keeps its own rounded size, so it never needs a resample. */
export function placedRect(s: FootageSlot, scale: number): { x: number; y: number; w: number; h: number } {
  const c = s.canvas;
  if (Math.abs(c.width - s.w) < 1e-6 && Math.abs(c.height - s.h) < 1e-6) {
    const own = clipRect(s.x, s.y, s.w, s.h, scale);
    return { x: Math.round(c.x * scale), y: Math.round(c.y * scale), w: own.w, h: own.h };
  }
  return clipRect(c.x, c.y, c.width, c.height, scale);
}

/** The size a clip decodes at: its output box when drawn at its own size, else its own box at the next zoom step (then resampled into place). */
export function decodeSize(s: FootageSlot, r: { w: number; h: number }, scale: number): { w: number; h: number } {
  const own = clipRect(s.x, s.y, s.w, s.h, scale);
  if (r.w === own.w && r.h === own.h) return r;
  const zoom = Math.max(r.w / own.w, r.h / own.h);
  const step = Math.min(ZOOM_STEPS.find(z => z >= zoom - 1e-3) ?? 4, 3840 / Math.max(own.w, own.h, 1));
  return { w: Math.max(2, Math.round(own.w * Math.max(1, step))), h: Math.max(2, Math.round(own.h * Math.max(1, step))) };
}

/** The frame painted at `scale`: bands rasterised, clips decoded and laid between them. Null when a clip gave no picture. */
export async function paintBanded(b: BandedFrame, scale: number, p: BandPainter): Promise<Painted | null> {
  const rects = b.slots.map(s => placedRect(s, scale));
  const sizes = b.slots.map((s, i) => decodeSize(s, rects[i] ?? { w: 1, h: 1 }, scale));
  // Every clip is asked for before the first await, so each stream hears its moments in frame order.
  const [layers, clips] = await Promise.all([
    Promise.all(b.bands.map((svg, i) => (svg === null ? null : p.render(svg, i === 0)))),
    Promise.all(b.slots.map((s, i) => (s.opacity > 0 ? p.clip(s, sizes[i]?.w ?? 1, sizes[i]?.h ?? 1) : null))),
  ]);
  const ground = layers[0];
  if (!ground) return null;
  const base = { width: ground.width, height: ground.height, pixels: Buffer.from(ground.pixels) };
  for (const [i, s] of b.slots.entries()) {
    const r = rects[i], px = clips[i], d = sizes[i];
    if (s.opacity > 0) {
      if (!px || !r || !d) return null;
      const fitted = d.w === r.w && d.h === r.h ? px : resampleRegion(px, d.w, d.h, 0, 0, d.w, d.h, r.w, r.h);
      const w = s.window;
      const win = w ? { x0: Math.round(w.x * scale), y0: Math.round(w.y * scale), x1: Math.round((w.x + w.width) * scale), y1: Math.round((w.y + w.height) * scale) } : undefined;
      drawClip(base.pixels, base.width, base.height, fitted, r.w, r.h, r.x, r.y, s.opacity, win);
    }
    const band = layers[i + 1];
    if (band) overBand(base.pixels, band.pixels);
  }
  return base;
}

// A frame with footage, split for drawing as pixels (export/footage-composite.ts).
//
// The frame is rendered ONCE by the normal renderer with each clip's picture left
// blank, then its top-level paint order is cut at every clip: band 0 is what lies
// under the first clip, band 1 what lies between it and the next, and so on. Each
// band rasterises as a transparent layer; the decoded clips go between them. Only
// a plain clip (a box, a fit, an opacity, its clock) is cut out this way — any
// other treatment (mask, rotation, effects, a clip inside a group) sends the whole
// frame down the embedded-JPEG path, which draws everything the renderer can.

import type { DesignSpec, Layer } from '../../schema/types';
import { renderToSVGElement, serializeSVGElement } from './svg-export';
import { frameRequest, type FrameRequest } from './video-frame';
import { videoFit } from '../../renderer/layer-renderers-video';
import type { ClipFit } from './video-decode';
import { clipRect, drawClip, overBand } from '../../export/footage-composite';
import { baseCrop, cropAt, panKeys, type ClipCrop } from '../../animation/clip-crop';

/**
 * Fields a clip may carry and still be drawn as pixels. `_frame_pose` is the flipbook's readout
 * (the renderer ignores it): a pose that moves the clip arrives as `transform`, which is not plain.
 */
const PLAIN_KEYS = new Set([
  'id', 'type', 'name', 'src', 'x', 'y', 'width', 'height', 'z', 'fit', 'focal', 'opacity', 'visible', 'locked',
  'video', 'in', 'out', 'alt', 'role', 'muted', 'volume', '_video_file', '_video_ms', '_video_frame', '_video_cut', '_frame_pose',
]);

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
  opacity: number;
}

/** Graphics bands around the clips: bands[i] lies under slots[i]; the last band is on top. Band 0 is always drawn. */
export interface BandedFrame { bands: Array<string | null>; slots: FootageSlot[] }

/** The clip as pixels, or null when something about it needs the renderer. */
export function plainClip(l: Layer): FootageSlot | null {
  if (l.type !== 'video') return null;
  for (const [k, v] of Object.entries(l)) if (v !== undefined && v !== null && !PLAIN_KEYS.has(k)) return null;
  const fit = videoFit(l.fit);
  const req = frameRequest(l);
  if (fit === 'none' || !req) return null;
  const keys = panKeys(l);
  const zoomMax = Math.max(baseCrop(l).zoom, ...keys.map(k => k.zoom ?? 1));
  const opacity = l.visible === false ? 0 : typeof l.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1;
  return { req, x: l.x ?? 0, y: l.y ?? 0, w: req.w, h: req.h, fit, crop: cropAt(l, req.ms), panned: keys.length > 0, zoomMax, opacity };
}

function holdsVideo(l: Layer): boolean {
  const kids = (l as { layers?: Layer[] }).layers;
  return Array.isArray(kids) && kids.some(k => k.type === 'video' || holdsVideo(k));
}

const SHARED = new Set(['defs', 'style']);

/** The frame cut into bands around its clips, or null to draw it the embedded way. */
export function bandedFrame(spec: DesignSpec): BandedFrame | null {
  const top = spec.layers ?? [];
  if (spec.pages?.length || !top.some(l => l.type === 'video') || top.some(holdsVideo)) return null;
  const slots = new Map<string, FootageSlot>();
  for (const l of top) {
    if (l.type !== 'video') continue;
    const slot = plainClip(l);
    if (!slot || slots.has(l.id)) return null;
    slots.set(l.id, slot);
  }
  const svg = renderToSVGElement({ ...spec, layers: top.map(l => (l.type === 'video' ? { ...l, _video_frame: BLANK } : l)) as Layer[] });
  const shared: Node[] = [];
  const groups: Node[][] = [[]];
  const order: FootageSlot[] = [];
  for (const node of Array.from(svg.childNodes)) {
    const el = node as Element;
    if (SHARED.has(el.nodeName.toLowerCase())) { shared.push(node); continue; }
    const slot = el.nodeType === 1 ? slots.get(el.getAttribute('data-layer-id') ?? '') : undefined;
    if (slot) { order.push(slot); groups.push([]); continue; }
    groups[groups.length - 1]?.push(node);
  }
  // A clip the renderer wrapped or left out is not a top-level <image> — let the renderer draw it all.
  if (order.length !== slots.size) return null;
  const bands = groups.map((nodes, i) => {
    if (i > 0 && !nodes.some(n => n.nodeType === 1)) return null;
    const root = svg.cloneNode(false) as SVGSVGElement;
    for (const s of shared) root.appendChild(s.cloneNode(true));
    for (const n of nodes) root.appendChild(n);
    return serializeSVGElement(root);
  });
  return { bands, slots: order };
}

export interface Painted { width: number; height: number; pixels: Buffer }

/** How a banded frame gets its pixels: a band rasterised (band 0 on the frame's ground; rasters may be shared, never written), a clip decoded at w×h. */
export interface BandPainter {
  render(svg: string, ground: boolean): Promise<Painted>;
  clip(slot: FootageSlot, w: number, h: number): Promise<Buffer | null>;
}

/** The frame painted at `scale`: bands rasterised, clips decoded and laid between them. Null when a clip gave no picture. */
export async function paintBanded(b: BandedFrame, scale: number, p: BandPainter): Promise<Painted | null> {
  const rects = b.slots.map(s => clipRect(s.x, s.y, s.w, s.h, scale));
  // Every clip is asked for before the first await, so each stream hears its moments in frame order.
  const [layers, clips] = await Promise.all([
    Promise.all(b.bands.map((svg, i) => (svg === null ? null : p.render(svg, i === 0)))),
    Promise.all(b.slots.map((s, i) => (s.opacity > 0 ? p.clip(s, rects[i]?.w ?? 1, rects[i]?.h ?? 1) : null))),
  ]);
  const ground = layers[0];
  if (!ground) return null;
  const base = { width: ground.width, height: ground.height, pixels: Buffer.from(ground.pixels) };
  for (const [i, s] of b.slots.entries()) {
    const r = rects[i], px = clips[i];
    if (s.opacity > 0) {
      if (!px || !r) return null;
      drawClip(base.pixels, base.width, base.height, px, r.w, r.h, r.x, r.y, s.opacity);
    }
    const band = layers[i + 1];
    if (band) overBand(base.pixels, band.pixels);
  }
  return base;
}

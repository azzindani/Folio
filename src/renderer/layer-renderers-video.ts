// A video layer on the canvas.
//
// On the server, video-frame.ts has already put the clip's picture for this
// moment in `_video_frame` (or '' when there is none), so the layer draws as
// an image — every image treatment applies to footage. In the browser there
// is no frame: the file itself plays in a <video>, sized and fitted like the
// image would be; the editor drives its currentTime from the playhead.

import type { ImageLayer, VideoLayer } from '../schema/types';
import { createSVGElement } from './svg-utils';
import { resolveAssetUrl } from './render-context';
import { renderImage } from './layer-renderers-shapes';
import { applyCommonAttributes } from './layer-renderers-shared';
import { cropAt, cropCss, hasCrop } from '../animation/clip-crop';

const XHTML = 'http://www.w3.org/1999/xhtml';

/** How a clip fills its box — the same in the editor's <video> and the server's <image>: cover unless the layer says otherwise. */
export function videoFit(fit: unknown): 'cover' | 'contain' | 'fill' | 'none' {
  return fit === 'contain' || fit === 'fill' || fit === 'none' ? fit : 'cover';
}

export function renderVideo(layer: VideoLayer, svg: SVGSVGElement): SVGElement {
  const frame = (layer as VideoLayer & { _video_frame?: string })._video_frame;
  if (typeof frame === 'string' || !layer.src) {
    // An <image> with no preserveAspectRatio letterboxes; the <video> covers, or stretches for fill.
    // A frame already cut to the box (a clip panned or zoomed inside, video-frame.ts) draws unscaled.
    const cut = (layer as VideoLayer & { _video_cut?: boolean })._video_cut === true;
    const fit = cut ? 'fill' : videoFit(layer.fit);
    const el = renderImage({ ...layer, ...(cut ? { focal: undefined } : {}), type: 'image', src: frame ?? '', fit: fit === 'cover' || fit === 'contain' ? fit : undefined } as unknown as ImageLayer, svg);
    if (fit === 'fill') (el.tagName.toLowerCase() === 'image' ? el : el.querySelector('image'))?.setAttribute('preserveAspectRatio', 'none');
    return el;
  }
  const x = layer.x ?? 0, y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 640;
  const h = typeof layer.height === 'number' ? layer.height : 360;
  const fo = createSVGElement('foreignObject', { x, y, width: w, height: h });
  const video = svg.ownerDocument.createElementNS(XHTML, 'video');
  video.setAttribute('src', resolveAssetUrl(layer.src));
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.setAttribute('preload', 'auto');
  video.setAttribute('data-video-layer', layer.id);
  // A pan or zoom inside the footage (animation/clip-crop.ts) as CSS: the resting crop here, the moving one per tick in canvas-video.
  const fit = videoFit(layer.fit);
  const offset = Number((layer as VideoLayer & { video?: { offset_ms?: unknown } }).video?.offset_ms) || 0;
  const crop = fit === 'cover' && hasCrop(layer) ? `;${cropCss(cropAt(layer, offset))}` : '';
  video.setAttribute('style', `width:100%;height:100%;display:block;object-fit:${fit}${crop}`);
  fo.appendChild(video);
  applyCommonAttributes(fo, layer);
  return fo;
}

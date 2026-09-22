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

const XHTML = 'http://www.w3.org/1999/xhtml';

export function renderVideo(layer: VideoLayer, svg: SVGSVGElement): SVGElement {
  const frame = (layer as VideoLayer & { _video_frame?: string })._video_frame;
  if (typeof frame === 'string' || !layer.src) {
    return renderImage({ ...layer, type: 'image', src: frame ?? '' } as unknown as ImageLayer, svg);
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
  const fit = layer.fit === 'contain' ? 'contain' : layer.fit === 'fill' ? 'fill' : layer.fit === 'none' ? 'none' : 'cover';
  video.setAttribute('style', `width:100%;height:100%;display:block;object-fit:${fit}`);
  fo.appendChild(video);
  applyCommonAttributes(fo, layer);
  return fo;
}

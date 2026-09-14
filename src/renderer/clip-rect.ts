/**
 * Rectangular clipping — the mask a layer is seen through.
 *
 * Two ways in, one mechanism:
 *  • `clip: true` on a group clips its children to the group's own box. That is
 *    After Effects' track matte: a line of type rises from BELOW a fixed edge,
 *    because the child moves and the group does not.
 *  • `clip_rect` on any layer, in canvas coordinates. It is how a wipe — a scene
 *    transition, the reveal channel — lands in a sampled frame.
 *
 * The rectangle lives in the element's own user space, so a layer that rotates
 * or scales carries its mask with it, as a layer mask does in After Effects.
 */

import type { Layer } from '../schema/types';
import { createSVGElement, defIdFor, appendDefOnce, getOrCreateDefs } from './svg-utils';

export interface ClipRect { x: number; y: number; width: number; height: number }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The rectangle a layer is clipped to, or null when it is not clipped. */
export function clipRectFor(layer: Layer): ClipRect | null {
  const o = layer as unknown as Record<string, unknown>;
  const r = o['clip_rect'] as Record<string, unknown> | undefined;
  if (r && typeof r === 'object' && finite(r['x']) && finite(r['y']) && finite(r['width']) && finite(r['height'])) {
    return { x: r['x'], y: r['y'], width: Math.max(0, r['width']), height: Math.max(0, r['height']) };
  }
  if (o['clip'] === true && layer.type === 'group' && finite(o['width']) && finite(o['height'])) {
    return { x: finite(o['x']) ? o['x'] : 0, y: finite(o['y']) ? o['y'] : 0, width: Math.max(0, o['width']), height: Math.max(0, o['height']) };
  }
  return null;
}

/**
 * Clip an element to a rectangle. An element that already has a clip-path (a
 * `clip_path_ref` shape mask) is wrapped instead, so both masks apply.
 */
export function applyClipRect(el: SVGElement, rect: ClipRect, svg: SVGSVGElement): SVGElement {
  const id = defIdFor('cliprect', rect);
  const clip = createSVGElement('clipPath', { id, clipPathUnits: 'userSpaceOnUse' });
  clip.appendChild(createSVGElement('rect', { x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
  appendDefOnce(getOrCreateDefs(svg), clip);
  if (!el.getAttribute('clip-path')) {
    el.setAttribute('clip-path', `url(#${id})`);
    return el;
  }
  const wrap = createSVGElement('g', { 'clip-path': `url(#${id})` });
  wrap.appendChild(el);
  return wrap;
}

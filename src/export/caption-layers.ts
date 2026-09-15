/**
 * A caption drawn into a frame — centred text over a box, above every layer, a
 * margin in from the bottom (or top) edge.
 *
 * The box is sized by plainTextLayout, the wrap rule the renderer draws text
 * with, so it fits the lines that are actually drawn. The same function feeds
 * the export's frames and Play all's stage.
 */

import type { CaptionStyle, DesignSpec, Layer } from '../schema/types';
import { plainTextLayout } from '../renderer/layer-renderers-shared';
import { captionAt, type CaptionPlan } from './caption-plan';

/** Above anything a design stacks. */
export const CAPTION_Z = 1_000_000;

export function captionLayers(plan: CaptionPlan, style: CaptionStyle | undefined, doc: { width: number; height: number }, t: number): Layer[] {
  const cue = captionAt(plan, t);
  if (!cue) return [];
  const W = doc.width, H = doc.height;
  const size = style?.font_size ?? Math.round(H * 0.045);
  const lineWidth = Math.round(W * Math.min(1, Math.max(0.2, style?.max_width ?? 0.8)) - size * 1.2);
  const margin = style?.margin ?? Math.round(H * 0.06);
  const padX = Math.round(size * 0.6), padY = Math.round(size * 0.35);
  const textStyle = {
    font_family: style?.font_family ?? 'Archivo', font_size: size, font_weight: style?.font_weight ?? 600,
    color: style?.color ?? '#FFFFFF', line_height: 1.25, text_align: 'center' as const,
  };
  const layout = plainTextLayout(cue.text, textStyle, { width: lineWidth });
  const drawnW = Math.min(lineWidth, Math.ceil(Math.max(0, ...layout.lineWidths)));
  const boxW = drawnW + 2 * padX;
  const boxH = Math.round(layout.lines.length * layout.lineH + 2 * padY);
  const boxY = style?.position === 'top' ? margin : H - margin - boxH;
  const layers: Layer[] = [];
  const background = style?.background ?? '#000000';
  if (background !== 'none') {
    layers.push({
      id: '__caption_box', type: 'rect', z: CAPTION_Z, x: Math.round((W - boxW) / 2), y: boxY, width: boxW, height: boxH,
      fill: background, opacity: style?.background_opacity ?? 0.72, radius: Math.round(size * 0.25),
    } as unknown as Layer);
  }
  // The text keeps the full line width it was wrapped at, centred, so the renderer wraps it the same way.
  layers.push({
    id: '__caption_text', type: 'text', z: CAPTION_Z + 1, x: Math.round((W - lineWidth) / 2), y: boxY + padY, width: lineWidth,
    content: { type: 'plain', value: cue.text }, style: textStyle,
  } as unknown as Layer);
  return layers;
}

/** A frame with the caption at t drawn over it. */
export function withCaptions(frame: DesignSpec, plan: CaptionPlan | null, style: CaptionStyle | undefined, t: number): DesignSpec {
  if (!plan || plan.cues.length === 0) return frame;
  const extra = captionLayers(plan, style, frame.document, t);
  if (!extra.length) return frame;
  const page = frame.pages?.[0];
  if (page) return { ...frame, pages: [{ ...page, layers: [...(page.layers ?? []), ...extra] }, ...(frame.pages ?? []).slice(1)] };
  return { ...frame, layers: [...(frame.layers ?? []), ...extra] };
}

/**
 * Safe areas — where words survive being shown.
 *
 * Two facts about the canvas a model cannot see from its coordinates:
 *
 *   title-safe  text set hard against an edge reads as cut off and is the first
 *               thing a crop, a rounded phone corner or a feed's frame eats. A
 *               margin of 4% of the short side is judged on the INK — a
 *               left-aligned headline in a full-width box is not at the right edge.
 *   9:16 feeds  Stories, Reels, TikTok and Shorts draw their own interface over
 *               a vertical video: a header strip at the top, the caption, sound
 *               line and call to action at the bottom, and a column of buttons
 *               on the lower right. Words under them are covered. The zones are
 *               the union across the four apps, scaled from 1080×1920, so a
 *               piece clear of them is clear on every one.
 *
 * Measured where things are drawn — group poses applied — and, on a moving
 * page, at each shot's rest. The engine reports; where the words go is the
 * designer's call.
 */

import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { Finding } from './diagnose';
import { canvasBoxes, type CanvasBox } from '../../export/frame-cull';
import { layersAt, animationDuration } from '../../export/gif-frames';
import { shotRests } from './motion-lint';
import { readMarkers } from './motion-time';

type Box = CanvasBox['box'];

/** Title-safe margin as a share of the canvas's short side. */
const TITLE_SAFE = 0.04;
/** 9:16, within 2%. */
const VERTICAL = 9 / 16;

interface Zone { name: string; covers: string; box: Box; where: string }

/** The UI zones of a vertical feed at 1080×1920, scaled to this canvas. */
function feedZones(W: number, H: number): Zone[] {
  const sx = W / 1080, sy = H / 1920;
  const r = Math.round;
  const z = (name: string, where: string, covers: string, x: number, y: number, w: number, h: number): Zone =>
    ({ name, where, covers, box: { x: x * sx, y: y * sy, width: w * sx, height: h * sy } });
  return [
    z('top band', `y < ${r(290 * sy)}`, 'the Reels and Stories profile header, TikTok\'s tabs and the Shorts search bar', 0, 0, 1080, 290),
    z('bottom band', `y > ${r(1440 * sy)}`, 'the caption, sound line and call-to-action button on TikTok, Reels and Shorts', 0, 1440, 1080, 480),
    z('right column', `x > ${r(900 * sx)}, y ${r(700 * sy)}–${r(1440 * sy)}`, 'the like, comment and share buttons on TikTok, Reels and Shorts', 900, 700, 180, 740),
  ];
}

const area = (b: Box): number => Math.max(0, b.width) * Math.max(0, b.height);
const meet = (a: Box, b: Box): number => {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

/** Words a viewer is meant to read: visible text, on the canvas. */
function wordsOn(frame: Layer[], W: number, H: number): CanvasBox[] {
  const canvas = { x: 0, y: 0, width: W, height: H };
  return canvasBoxes(frame).filter(b => b.layer.type === 'text' && b.opacity > 0.3 && area(b.box) > 0 && meet(b.box, canvas) > 0.5 * area(b.box));
}

/** Edges the ink comes within `m` px of (or runs past), with the distance. */
function crowded(b: Box, W: number, H: number, m: number): string[] {
  const gaps: Array<[string, number]> = [['left', b.x], ['right', W - b.x - b.width], ['top', b.y], ['bottom', H - b.y - b.height]];
  return gaps.filter(([, g]) => g < m).map(([side, g]) => (g < 0 ? `runs ${Math.round(-g)} px past the ${side} edge` : `${Math.round(g)} px from the ${side} edge`));
}

/** The moments a page is seen at: as authored when still, else each shot's rest. */
function moments(spec: DesignSpec, layers: Layer[], page?: Page): Array<{ label: string; frame: Layer[] }> {
  const moving = animationDuration(layers);
  if (moving <= 0) return [{ label: '', frame: layers }];
  const held = page?.auto_advance;
  const end = typeof held === 'number' && held > 0 ? held : moving;
  const marks = Object.entries(readMarkers(spec, page)).map(([id, at]) => ({ id, at: Number(at) })).filter(m => Number.isFinite(m.at));
  return shotRests(layers, marks, end).slice(0, 12).map(r => ({ label: ` in "${r.shot}" at ${r.t} ms`, frame: layersAt(layers, r.t) }));
}

/** Title-safe and vertical-feed findings for one surface. */
export function safeAreaFindings(spec: DesignSpec, layers: Layer[], page?: Page): Finding[] {
  const W = spec.document?.width ?? 1080, H = spec.document?.height ?? 1080;
  const margin = Math.round(TITLE_SAFE * Math.min(W, H));
  const zones = Math.abs(W / H - VERTICAL) <= 0.02 * VERTICAL ? feedZones(W, H) : [];
  const clear = zones.length
    ? `x ${margin}–${Math.round((900 / 1080) * W)} and y ${Math.round((290 / 1920) * H)}–${Math.round((1440 / 1920) * H)} px`
    : '';
  const out: Finding[] = [];
  const said = new Set<string>();
  for (const { label, frame } of moments(spec, layers, page)) {
    for (const b of wordsOn(frame, W, H)) {
      const id = b.layer.id;
      for (const z of zones) {
        const share = meet(b.box, z.box) / area(b.box);
        if (share < 0.2 || said.has(`${id}:${z.name}`)) continue;
        said.add(`${id}:${z.name}`);
        out.push({ code: 'safe_area', severity: 'warning', layer_id: id,
          message: `"${id}"${label} sits ${Math.round(share * 100)}% inside the ${z.name} of a vertical feed (${z.where}) — under ${z.covers}.`,
          fix: `Keep words a viewer must read inside ${clear} — clear on every app — or let this one be covered on purpose.` });
      }
      const edges = crowded(b.box, W, H, margin);
      if (!edges.length || said.has(`${id}:edge`)) continue;
      said.add(`${id}:edge`);
      out.push({ code: 'title_safe', severity: 'suggestion', layer_id: id,
        message: `"${id}"${label}: its letters are ${edges.join(' and ')} — inside the ${margin} px title-safe margin (4% of the short side).`,
        fix: `Hold words at least ${margin} px from every edge, or run them off the edge on purpose.` });
    }
  }
  return out;
}

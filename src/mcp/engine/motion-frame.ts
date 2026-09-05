/**
 * `animation(op:frame)` — render the design as it looks at time t.
 *
 * A model authoring motion cannot watch it play. What it CAN do is look at a
 * still: "at 400ms, is the headline where I meant it to be?" This resolves
 * every track at t through the same sampler the GIF route uses, renders that
 * still through the ordinary preview path, and returns it as an image
 * attachment — so a vision-capable caller sees the pose, and a blind one
 * gets the resolved geometry of every animated layer as numbers.
 */

import * as fs from 'fs';
import * as path from 'path';
import { Resvg } from '@resvg/resvg-js';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, readYAML, errResult, okResult, pOk, pInfo } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { resolveImageAssets } from './asset-resolve';
import { specAt, animationDuration } from '../../export/gif-frames';

type FrameArgs = {
  design_path: string;
  /** Time to render, ms from scene start. */
  t?: number;
  page_id?: string;
  scale?: number;
  /** Write the PNG here as well as returning it inline. */
  output_path?: string;
  project_path?: string;
};

interface Pose {
  id: string; x?: number; y?: number; width?: number; height?: number; opacity?: number; rotation?: number;
  /** How skew/scale actually materialise — a transform the renderer applies. */
  transform?: string;
  /** How `draw` materialises: the dash pattern that hides the untraced part. */
  stroke_dasharray?: string | number;
  stroke_dashoffset?: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/** Geometry of every layer that carries a track, after sampling. */
function animatedPoses(original: Layer[], resolved: Layer[]): Pose[] {
  const out: Pose[] = [];
  const walk = (o: Layer[], r: Layer[]): void => {
    o.forEach((ol, i) => {
      const rl = r[i] as (Layer & Record<string, unknown>) | undefined;
      if (!rl) return;
      // A layer travelling a motion_path is animated too. Reporting only
      // keyframed layers left the numbers empty for a design whose whole motion
      // was a path — the render moved, the readout said nothing moved, and the
      // readout is the half a blind caller can actually read.
      const hasPath = Boolean((ol as unknown as Record<string, unknown>)['motion_path']);
      if (hasPath || (ol as Layer & { animation?: AnimationSpec }).animation?.keyframes?.length) {
        // skew, scale and draw do not move x/y — they land on `transform` and on
        // the dash pair. Reporting only the box said "nothing changed" about a
        // frame that visibly had, and the readout is the half a blind caller can
        // actually read. Same bug as the motion_path omission just above, one
        // set of channels later.
        const dash = rl['stroke_dasharray'];
        out.push({
          id: ol.id,
          x: num(rl['x']), y: num(rl['y']), width: num(rl['width']), height: num(rl['height']),
          opacity: num(rl['opacity']), rotation: num(rl['rotation']),
          transform: str(rl['transform']),
          stroke_dasharray: typeof dash === 'number' ? dash : str(dash),
          stroke_dashoffset: num(rl['stroke_dashoffset']),
        });
      }
      const ok = (ol as Layer & { layers?: Layer[] }).layers;
      const rk = (rl as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(ok) && Array.isArray(rk)) walk(ok, rk);
    });
  };
  walk(original, resolved);
  return out;
}

export function renderFrame(args: FrameArgs): ToolResult {
  const op = 'frame';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);

  const pageIndex = args.page_id ? Math.max(0, (spec.pages ?? []).findIndex((p: Page) => p.id === args.page_id)) : 0;
  const layers = spec.pages?.[pageIndex]?.layers ?? spec.layers ?? [];
  const sceneMs = animationDuration(layers);
  if (sceneMs <= 0) {
    return errResult(op, 'Nothing on this page is animated, so every frame is the same still.', 'Add motion with animation(op:sequence | motion | track) first, or use render_preview for a plain still.');
  }
  const t = Math.max(0, args.t ?? 0);
  const scale = typeof args.scale === 'number' && args.scale > 0 ? Math.min(2, args.scale) : 1;
  const progress: ProgressItem[] = [];

  try {
    const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
    const at = specAt(spec, pageIndex, t);
    const renderSpec: DesignSpec = at.pages?.length
      ? ({ ...at, layers: at.pages[0]?.layers ?? [], pages: undefined } as DesignSpec)
      : at;
    const svg = renderToSVGString(renderSpec);
    const projDir = args.project_path ?? path.dirname(path.dirname(dPath));
    const png = Buffer.from(new Resvg(svg, {
      fitTo: { mode: 'zoom', value: scale }, background: '#ffffff', font: resvgFontOption(projDir),
    }).render().asPng());

    if (args.output_path) {
      fs.mkdirSync(path.dirname(args.output_path), { recursive: true });
      fs.writeFileSync(args.output_path, png);
    }

    const poses = animatedPoses(layers, renderSpec.layers ?? []);
    progress.push(pOk(`Rendered t=${t}ms`, `${png.length} bytes @ ${scale}× · scene is ${sceneMs}ms`));
    if (t > sceneMs) progress.push(pInfo('Past the end', `t=${t}ms is after the last motion finishes at ${sceneMs}ms — this is the resting pose.`));

    return okResult(op, {
      design_path: dPath, t, scene_ms: sceneMs, scale, bytes: png.length,
      poses,
      ...(args.output_path ? { output_path: args.output_path } : {}),
      ...(assetNotes.length ? { notes: assetNotes } : {}),
      progress,
      _attachments: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }],
    });
  } catch (err) {
    return errResult(op, `Frame render failed: ${(err as Error).message}`, 'Run diagnose_design to find the bad layer.', progress);
  }
}

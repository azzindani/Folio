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
import { rasterize, rasterizeSync } from '../../utils/resvg-isolate';
import { encodePNG } from '../../utils/png-codec';
import type { DesignSpec, Layer, Page } from '../../schema/types';
import type { AnimationSpec, LayerLink } from '../../animation/types';
import type { ToolResult, ProgressItem } from '../types';
import { resolveDesignPath, readYAML, errResult, okResult, pOk, pInfo } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { resolveImageAssets } from './asset-resolve';
import { specAt, animationDuration } from '../../export/gif-frames';
import { cullFrame, parseTransform } from '../../export/frame-cull';
import { PREVIEW_FRAME_MS } from '../../export/motion-blur';
import { drawnBox } from '../../export/frame-geometry';
import { planScenes, sceneAt } from '../../export/scene-plan';
import { FRAME_POSE, type FramePose } from '../../export/frame-pose';
import { composeSceneFrame, turningFrame, blankPage } from '../../export/scene-compose';
import { paintTurning } from '../../export/warp';
import { planCaptions } from '../../export/caption-plan';
import { withCaptions } from '../../export/caption-layers';
import { sourceOptions } from '../../renderer/resolve-source';

type FrameArgs = {
  design_path: string;
  /** Time to render, ms from scene start — or from the start of the piece with `scenes`. */
  t?: number;
  page_id?: string;
  /** Render a moment of every page played in order, transitions included. */
  scenes?: boolean;
  hold_ms?: number;
  scale?: number;
  /** Write the PNG here as well as returning it inline. */
  output_path?: string;
  project_path?: string;
};

interface Pose {
  id: string; x?: number; y?: number; width?: number; height?: number; opacity?: number; rotation?: number;
  /** Offset from the authored position — the only position a line or a path reports. */
  offset?: [number, number];
  scale?: [number, number];
  skew?: [number, number];
  /** The transform the renderer applies — offset, rotate, skew and scale in one. */
  transform?: string;
  /** Where the middle of what it draws is now — for a layer turning about another's pivot, which x/y cannot show. */
  center?: [number, number];
  /** How `draw` materialises: the dash pattern that hides the untraced part. */
  stroke_dasharray?: string | number;
  stroke_dashoffset?: number;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined);

/**
 * Geometry of every animated layer ON SCREEN at t, after sampling: in full
 * while it is off its authored pose, by id once it rests there (its geometry
 * is then what the caller wrote). Found live on a 260-layer continuous scene:
 * listing every animated layer, off-window ones included, made one frame
 * reply ~38K tokens, nearly all of it layers not even in the frame.
 */
function animatedPoses(original: Layer[], resolved: Layer[]): { poses: Pose[]; at_rest: string[] } {
  const out: Pose[] = [];
  const atRest: string[] = [];
  // `outer` is every ancestor's transform, outermost first — a child's world is its groups' too.
  const walk = (o: Layer[], r: Layer[], outer: string): void => {
    o.forEach((ol, i) => {
      const rl = r[i] as (Layer & Record<string, unknown>) | undefined;
      // Outside its in/out window (or hidden) a layer is not in the frame, nor is anything inside it.
      if (!rl || rl['visible'] === false) return;
      const world = `${outer} ${str(rl['transform']) ?? ''}`.trim();
      // A layer travelling a motion_path is animated too. Reporting only
      // keyframed layers left the numbers empty for a design whose whole motion
      // was a path — the render moved, the readout said nothing moved, and the
      // readout is the half a blind caller can actually read.
      const hasPath = Boolean((ol as unknown as Record<string, unknown>)['motion_path']);
      // A link or parent wrapper has no track of its own until the timeline resolves one.
      const linked = Boolean((ol as unknown as Record<string, unknown>)['link']);
      if (hasPath || linked || (ol as Layer & { animation?: AnimationSpec }).animation?.keyframes?.length) {
        // skew, scale and draw do not move x/y — they land on `transform` and on
        // the dash pair. Reporting only the box said "nothing changed" about a
        // frame that visibly had, and the readout is the half a blind caller can
        // actually read. Same bug as the motion_path omission just above, one
        // set of channels later.
        const dash = rl['stroke_dasharray'];
        // The sampler moves, turns and scales by TRANSFORM, not by editing the
        // box, so the readout adds the sampled pose back onto the authored box.
        const pose = rl[FRAME_POSE] as FramePose | undefined;
        const r2 = (v: number): number => Math.round(v * 100) / 100;
        const plus3 = (v: number | undefined): number | undefined => (v === undefined ? undefined : Math.round(v * 1000) / 1000);
        const plus = (a: number | undefined, b: number | undefined): number | undefined =>
          (a === undefined ? undefined : r2(a + (b ?? 0)));
        const turned = pose?.rotation ? r2((num(rl['rotation']) ?? 0) + pose.rotation) : num(rl['rotation']);
        const moved = Boolean(pose && (pose.dx !== 0 || pose.dy !== 0 || pose.scale_x !== 1 || pose.scale_y !== 1
          || pose.skew_x !== 0 || pose.skew_y !== 0 || pose.rotation));
        const faded = (num(rl['opacity']) ?? 1) !== (num((ol as unknown as Record<string, unknown>)['opacity']) ?? 1);
        if (!moved && !faded && dash === undefined && rl['stroke_dashoffset'] === undefined) atRest.push(ol.id);
        else out.push({
          id: ol.id,
          x: plus(num(rl['x']), pose?.dx), y: plus(num(rl['y']), pose?.dy),
          width: num(rl['width']), height: num(rl['height']),
          opacity: plus3(num(rl['opacity'])), rotation: turned,
          ...(pose && (pose.dx !== 0 || pose.dy !== 0) ? { offset: [r2(pose.dx), r2(pose.dy)] as [number, number] } : {}),
          ...(pose && (pose.scale_x !== 1 || pose.scale_y !== 1) ? { scale: [r2(pose.scale_x), r2(pose.scale_y)] as [number, number] } : {}),
          ...(pose && (pose.skew_x !== 0 || pose.skew_y !== 0) ? { skew: [r2(pose.skew_x), r2(pose.skew_y)] as [number, number] } : {}),
          transform: str(rl['transform']),
          ...orbitCenter(ol, world),
          stroke_dasharray: typeof dash === 'number' ? dash : str(dash),
          stroke_dashoffset: num(rl['stroke_dashoffset']),
        });
      }
      const ok = (ol as Layer & { layers?: Layer[] }).layers;
      const rk = (rl as Layer & { layers?: Layer[] }).layers;
      if (Array.isArray(ok) && Array.isArray(rk)) walk(ok, rk, world);
    });
  };
  walk(original, resolved, '');
  return { poses: out, at_rest: atRest };
}

/**
 * Where the middle of what a layer draws is on the canvas, when it turns about a
 * canvas pivot (a parented child) — through every group around it. In a chain
 * only the innermost wrapper says it: the levels outside it hold the same layer.
 */
function orbitCenter(authored: Layer, world: string): { center?: [number, number] } {
  // The sampled layer has no track left; the authored one says what it turns about.
  const o = authored as Layer & { animation?: AnimationSpec; link?: LayerLink; layers?: Array<Layer & { link?: LayerLink }> };
  if (!o.link?.pivot && !o.animation?.playback?.pivot) return {};
  if (o.layers?.length === 1 && o.layers[0]?.link) return {};
  const box = drawnBox(authored), m = parseTransform(world);
  if (!box || !m) return {};
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  return { center: [Math.round(m[0] * cx + m[2] * cy + m[4]), Math.round(m[1] * cx + m[3] * cy + m[5])] };
}

export function renderFrame(args: FrameArgs): ToolResult {
  const op = 'frame';
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  const spec = readYAML<DesignSpec>(dPath);
  if (args.scenes) return renderSceneFrame(spec, dPath, args);

  const pageIndex = args.page_id ? Math.max(0, (spec.pages ?? []).findIndex((p: Page) => p.id === args.page_id)) : 0;
  const layers = spec.pages?.[pageIndex]?.layers ?? spec.layers ?? [];
  const sceneMs = animationDuration(layers, sourceOptions(spec, spec.pages?.[pageIndex]));
  if (sceneMs <= 0) {
    return errResult(op, 'Nothing on this page is animated, so every frame is the same still.', 'Add motion with animation(op:sequence | motion | track) first, or use render_preview for a plain still.');
  }
  const t = Math.max(0, args.t ?? 0);
  const scale = typeof args.scale === 'number' && args.scale > 0 ? Math.min(2, args.scale) : 1;
  const progress: ProgressItem[] = [];

  try {
    const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
    const pageId = spec.pages?.[pageIndex]?.id;
    const captions = planCaptions(spec, { total_ms: sceneMs, scenes: pageId ? [{ page_id: pageId, start_ms: 0, length_ms: sceneMs }] : [] });
    // A still of a moving piece shows what a video frame shows: motion blur at 30 fps.
    const at = withCaptions(specAt(spec, pageIndex, t, PREVIEW_FRAME_MS), captions, spec.captions?.style, t);
    const renderSpec: DesignSpec = at.pages?.length
      ? ({ ...at, layers: at.pages[0]?.layers ?? [], pages: undefined } as DesignSpec)
      : at;
    // Culled for resvg only — the poses below still read every layer.
    const svg = renderToSVGString(cullFrame(renderSpec));
    const projDir = args.project_path ?? path.dirname(path.dirname(dPath));
    const png = rasterize({ svg, opts: { fitTo: { mode: 'zoom', value: scale }, background: '#ffffff', font: resvgFontOption(projDir) } }).png;

    if (args.output_path) {
      fs.mkdirSync(path.dirname(args.output_path), { recursive: true });
      fs.writeFileSync(args.output_path, png);
    }

    const { poses, at_rest } = animatedPoses(layers, renderSpec.layers ?? []);
    progress.push(pOk(`Rendered t=${t}ms`, `${png.length} bytes @ ${scale}× · scene is ${sceneMs}ms`));
    if (t > sceneMs) progress.push(pInfo('Past the end', `t=${t}ms is after the last motion finishes at ${sceneMs}ms — this is the resting pose.`));

    return okResult(op, {
      design_path: dPath, t, scene_ms: sceneMs, scale, bytes: png.length,
      poses,
      ...(at_rest.length ? { at_rest } : {}),
      ...(args.output_path ? { output_path: args.output_path } : {}),
      ...(assetNotes.length ? { notes: assetNotes } : {}),
      progress,
      _attachments: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }],
    });
  } catch (err) {
    return errResult(op, `Frame render failed: ${(err as Error).message}`, 'Run diagnose_design to find the bad layer.', progress);
  }
}

/** A moment of the multi-scene piece — the way to check a transition without exporting. */
function renderSceneFrame(spec: DesignSpec, dPath: string, args: FrameArgs): ToolResult {
  const op = 'frame';
  if (!spec.pages?.length) {
    return errResult(op, 'scenes:true plays pages in order, and this design has none.', 'Leave scenes off to sample a poster.');
  }
  const plan = planScenes(spec, { hold_ms: args.hold_ms });
  const t = Math.min(Math.max(0, args.t ?? 0), plan.total_ms);
  const m = sceneAt(plan, t);
  const scale = typeof args.scale === 'number' && args.scale > 0 ? Math.min(2, args.scale) : 1;
  try {
    const assetNotes = resolveImageAssets(spec, dPath, args.project_path);
    const captions = planCaptions(spec, plan);
    const projDir = args.project_path ?? path.dirname(path.dirname(dPath));
    const opts = { fitTo: { mode: 'zoom' as const, value: scale }, font: resvgFontOption(projDir) };
    const turn = turningFrame(spec, plan, t, PREVIEW_FRAME_MS);
    let png: Buffer;
    if (turn) {
      // A turning face: each scene drawn once and warped onto it, as the GIF / MP4 export does.
      const over = withCaptions(blankPage(spec), captions, spec.captions?.style, t);
      const [top, ...faces] = rasterizeSync([over, ...turn.faces.map(f => f.spec)].map((s, i) =>
        ({ svg: renderToSVGString(cullFrame(s)), opts: i ? { ...opts, background: '#ffffff' } : opts, want: 'pixels' as const })));
      if (!top) throw new Error('the frame over a turning face did not render');
      png = encodePNG(paintTurning(turn.stage, turn.faces.flatMap((f, i) => { const r = faces[i]; return r ? [{ img: r, corners: f.corners }] : []; }), top, spec.document.width));
    } else {
      const svg = renderToSVGString(cullFrame(withCaptions(composeSceneFrame(spec, plan, t, PREVIEW_FRAME_MS), captions, spec.captions?.style, t)));
      png = rasterize({ svg, opts: { ...opts, background: '#ffffff' } }).png;
    }
    if (args.output_path) {
      fs.mkdirSync(path.dirname(args.output_path), { recursive: true });
      fs.writeFileSync(args.output_path, png);
    }
    const notes = [...plan.warnings, ...assetNotes];
    return okResult(op, {
      design_path: dPath, t, total_ms: plan.total_ms, scale, bytes: png.length,
      scene: { page_id: m.scene.page_id, local_ms: Math.round(m.local_ms) },
      ...(m.from && m.scene.transition ? {
        transition: { type: m.scene.transition.type, from: m.from.scene.page_id, progress: Number(m.from.progress.toFixed(3)) },
      } : {}),
      ...(args.output_path ? { output_path: args.output_path } : {}),
      ...(notes.length ? { notes } : {}),
      progress: [pOk(`Rendered t=${t}ms of ${plan.total_ms}ms`, `scene ${m.scene.page_id} at ${Math.round(m.local_ms)}ms`)],
      _attachments: [{ type: 'image' as const, data: png.toString('base64'), mimeType: 'image/png' }],
    });
  } catch (err) {
    return errResult(op, `Frame render failed: ${(err as Error).message}`, 'Run diagnose_design to find the bad layer.');
  }
}

/**
 * GIF / MP4 / WebM export — sample the scene, rasterise each moment with
 * resvg, stream it straight into an encoder.
 *
 * The first GIF route held every frame in memory and capped the count against
 * a 180 MB budget, so a 30s scene at 1080×1350 got 32 frames: 1fps. Frames now
 * leave as soon as they are rendered (GifStream to disk, VideoPipe to ffmpeg),
 * so length costs time, not memory — and the only limits left are ones a
 * person would choose: clip length and a frame rate the format can play.
 */

import * as path from 'path';
import { RasterWorker, type Raster } from '../../utils/resvg-isolate';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { errResult, okResult } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { resolveImageAssets } from './asset-resolve';
import { frameTimes } from '../../export/gif-frames';
import { cullFrame } from '../../export/frame-cull';
import { GifStream, fileSink, type GifStreamStats } from '../../export/gif-stream';
import { VideoPipe, type VideoType } from '../../export/video-encode';
import { tryFfmpeg } from '../../export/animation-export';

export interface RasterMotionArgs {
  type: 'gif' | VideoType;
  fps?: number;
  duration?: number;
  project_path?: string;
  /** Qualifications the caller already knows about (scene warnings, approximations). */
  notes?: string[];
  /** Extra fields for the reply (the scene list of a multi-scene export). */
  extra?: Record<string, unknown>;
  /** Called after each frame is encoded, with the count so far — a background job's progress. */
  onFrame?: (done: number) => void;
}

/** What gets rendered: one page's timeline, or every page played as scenes. */
export interface FrameSource {
  /** Natural length of the piece, ms. */
  durationMs: number;
  /** The design at time t, as the single page to render. */
  at(t: number): DesignSpec;
}

/** Longest clip. A bound on CPU time — frames stream, so memory is flat at any length. */
export const MAX_CLIP_MS = 60_000;

/** GIF delays under 2cs are slowed down by browsers, so 50fps is the fastest a GIF plays. */
const FPS_LIMITS = { gif: { def: 12, max: 50 }, video: { def: 30, max: 60 } } as const;

const OP = 'export_animation';

/** The frame rate a type will actually play at, and how many frames that makes. */
export function rasterPlan(type: RasterMotionArgs['type'], runMs: number, askedFps?: number): { fps: number; asked: number; max: number; frames: number } {
  const limits = type !== 'gif' ? FPS_LIMITS.video : FPS_LIMITS.gif;
  const asked = askedFps ?? limits.def;
  const fps = Math.min(limits.max, Math.max(1, Math.round(asked)));
  return { fps, asked, max: limits.max, frames: frameTimes(runMs, fps).length };
}

const yieldToServer = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });

export async function exportRasterMotion(
  spec: DesignSpec, dPath: string, source: FrameSource, outputPath: string, args: RasterMotionArgs,
): Promise<ToolResult> {
  const { type } = args;
  const video = type !== 'gif';
  // Every frame is a real render, so an unresolved asset href is a hole in all of them.
  const notes = [...(args.notes ?? []), ...resolveImageAssets(spec, dPath, args.project_path)];

  const runMs = args.duration ?? source.durationMs;
  if (runMs <= 0) {
    return errResult(OP, `Nothing in this design is animated, so a ${type} would be a single still frame.`,
      'Add motion with animation(op:motion) or animation(op:keyframe) first, ' +
      'or use export_design(format:"png") if a still is what you want.');
  }
  if (runMs > MAX_CLIP_MS) {
    return errResult(OP, `The clip is ${(runMs / 1000).toFixed(1)}s; ${type} export stops at ${MAX_CLIP_MS / 1000}s.`,
      'Pass `duration` (ms) to export the first part, or split the scene across pages and export each.');
  }
  if (video && !tryFfmpeg()) {
    return errResult(OP, `${type} export needs ffmpeg, which this host does not have.`,
      'Install ffmpeg on the host (the Docker image ships it), or export type:"gif" — encoded in-process — ' +
      'or type:"svg" for vector motion at any size.');
  }

  const { fps, asked, max } = rasterPlan(type, runMs, args.fps);
  if (fps !== asked) notes.push(`fps ${asked} is outside what a ${type} plays (1–${max}); exported at ${fps}fps.`);

  const times = frameTimes(runMs, fps);
  const frameMs = runMs / times.length;
  const font = resvgFontOption(path.dirname(path.dirname(dPath)));
  // One renderer process for the whole clip: if resvg aborts, this export fails and the server stays up.
  const worker = new RasterWorker();
  // Video has no alpha: anything the design leaves transparent would encode as black.
  const renderAt = (t: number): Promise<Raster> => {
    // A clip far off the canvas aborts resvg outright. See frame-cull.ts.
    const svg = renderToSVGString(cullFrame(source.at(t)));
    return worker.render({ svg, opts: video ? { font, background: '#FFFFFF' } : { font }, want: 'pixels' });
  };

  const started = performance.now();
  let width = 0, height = 0, bytes = 0, done = 0;
  let gifStats: GifStreamStats | null = null;

  if (video) {
    let pipe: VideoPipe | null = null;
    try {
      for (const t of times) {
        const img = await renderAt(t);
        if (!pipe) {
          ({ width, height } = img);
          pipe = new VideoPipe({ type, width, height, fps, outputPath });
        }
        await pipe.write(img.pixels);
        args.onFrame?.(++done);
        await yieldToServer();
      }
      if (pipe) bytes = (await pipe.finish()).bytes;
    } catch (e) {
      worker.close();
      await pipe?.abort();
      return errResult(OP, `${type} export failed: ${(e as Error).message}`,
        'A render error names the layer — run diagnose_design. An ffmpeg error names the encoder.');
    }
  } else {
    const sink = fileSink(outputPath);
    try {
      let gif: GifStream | null = null;
      for (const t of times) {
        const img = await renderAt(t);
        if (!gif) {
          ({ width, height } = img);
          gif = new GifStream(sink, { width, height, loopCount: 0 });
        }
        gif.add(new Uint8ClampedArray(img.pixels.buffer, img.pixels.byteOffset, img.pixels.byteLength), frameMs);
        args.onFrame?.(++done);
        await yieldToServer();
      }
      if (gif) gifStats = gif.finish();
      bytes = gifStats?.bytes ?? 0;
    } catch (e) {
      worker.close();
      sink.abort();
      return errResult(OP, `Frame rendering failed: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer.');
    }
  }

  worker.close();
  return okResult(OP, {
    design_path: dPath,
    output_path: outputPath,
    type,
    frames: times.length,
    fps,
    duration: runMs,
    width,
    height,
    bytes,
    ...(gifStats ? { images_written: gifStats.images_written } : {}),
    render_ms: Math.round(performance.now() - started),
    ...(args.extra ?? {}),
    ...(notes.length ? { notes } : {}),
    note: video
      ? `Encoded by ffmpeg as the frames rendered (${type === 'mp4' ? 'H.264, yuv420p, faststart' : 'VP9'}).`
      : 'Encoded in-process as the frames rendered: identical frames merged, later frames store only what changed.',
  });
}

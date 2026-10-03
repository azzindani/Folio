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

import * as fs from 'fs';
import * as path from 'path';
import type { Raster, RasterJob } from '../../utils/resvg-isolate';
import { RasterPool } from '../../utils/raster-pool';
import type { DesignSpec } from '../../schema/types';
import type { ToolResult } from '../types';
import { errResult, okResult } from './utils';
import { renderToSVGString } from './svg-export';
import { resvgFontOption } from './fonts';
import { resolveImageAssets } from './asset-resolve';
import { frameTimes } from '../../export/gif-frames';
import { cullFrame } from '../../export/frame-cull';
import type { TurningFrame } from '../../export/scene-compose';
import { paintTurning } from '../../export/warp';
import { GifStream, fileSink, type GifStreamStats } from '../../export/gif-stream';
import { VideoPipe, type VideoType } from '../../export/video-encode';
import { x264Preset } from '../../export/video-codec';
import { tryFfmpeg } from '../../export/animation-export';
import { muxSound, type MuxClip } from '../../export/audio-mux';
import { scriptsAhead } from './script-capture';
import { maxClipMs, clipLimitText } from '../../export/clip-limits';
import { FootageFeed } from './video-feed';
import { bandedFrame, paintBanded } from './footage-bands';
import { RasterMemo, svgKey } from '../../export/raster-memo';

export interface RasterMotionArgs {
  /** The design's sound, found and planned — mixed under an mp4/webm once the frames are encoded. */
  sound?: MuxClip[];
  type: 'gif' | VideoType;
  fps?: number;
  duration?: number;
  /** Output size as a fraction of the canvas (exportScale clamps it to 0.1–1). */
  scale?: number;
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
  /** The design at time t, as the single page to render — a frame `frameMs` long, for motion blur. */
  at(t: number, frameMs?: number): DesignSpec;
  /** When a face turns at t: each scene to warp onto it and what lies over them (warp.ts) — else null, and `at` draws it. */
  turning?(t: number, frameMs?: number): (TurningFrame & { over: DesignSpec }) | null;
}

type Frame = Pick<Raster, 'width' | 'height' | 'pixels'>;

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

/** The scale an export renders at: a fraction of the canvas, 0.1–1. Anything else is full size. */
export function exportScale(raw?: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.min(1, Math.max(0.1, raw)) : 1;
}

/**
 * The file a raster export writes. A scaled or re-timed export gets its own name:
 * background jobs join by output file, so a 960×540 GIF asked for while the
 * full-size one renders would otherwise join it and hand back the wrong file.
 */
export function variantName(baseName: string, type: string, doc: { width: number; height: number }, args: { fps?: number; scale?: number }): string {
  if (type !== 'gif' && type !== 'mp4' && type !== 'webm') return `${baseName}.${type}`;
  const raster = type as RasterMotionArgs['type'];
  const scale = exportScale(args.scale);
  const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
  const size = scale < 1 ? `-${even(doc.width * scale)}x${even(doc.height * scale)}` : '';
  const fps = rasterPlan(raster, 0, args.fps).fps;
  const rate = fps !== rasterPlan(raster, 0).fps ? `-${fps}fps` : '';
  return `${baseName}${size}${rate}.${type}`;
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
  if (runMs > maxClipMs(type)) {
    return errResult(OP, `The clip is ${(runMs / 1000).toFixed(1)}s; ${type} export stops at ${clipLimitText(maxClipMs(type))}.`,
      video ? 'Pass `duration` (ms) to export the first part, or split the piece and export each part.'
        : `A GIF that long is a video: export type:"mp4" (up to ${clipLimitText(maxClipMs('mp4'))}), or pass \`duration\` (ms) for the first part.`);
  }
  if (video && !tryFfmpeg()) {
    return errResult(OP, `${type} export needs ffmpeg, which this host does not have.`,
      'Install ffmpeg on the host (the Docker image ships it), or export type:"gif" — encoded in-process — ' +
      'or type:"svg" for vector motion at any size.');
  }

  const { fps, asked, max } = rasterPlan(type, runMs, args.fps);
  if (fps !== asked) notes.push(`fps ${asked} is outside what a ${type} plays (1–${max}); exported at ${fps}fps.`);
  if (!video && args.sound?.length) notes.push('A GIF has no sound, so the soundtrack is not in this file — export mp4 or webm to hear it.');

  const times = frameTimes(runMs, fps);
  const frameMs = runMs / times.length;
  // Script components: captured in headless Chromium a chunk ahead of the frames (script-capture.ts).
  const scripts = await scriptsAhead(spec, (t, fm) => source.at(t, fm), times, frameMs, notes);
  const font = resvgFontOption(path.dirname(path.dirname(dPath)));
  // Renderer processes for the whole clip (raster-pool.ts): frames rasterise in parallel, and if
  // resvg aborts this export fails while the server stays up.
  const pool = new RasterPool();
  // Footage decoded as one stream per clip, a frame ahead of each render (video-feed.ts).
  const feed = new FootageFeed();
  const shutdown = async (): Promise<void> => { pool.close(); feed.close(); await scripts?.close(); };
  // Frames in flight, oldest first. Each is caught once as it is made so a later frame failing
  // while an earlier one is awaited is not an unhandled rejection; awaiting it still throws.
  const window = pool.size * 2;
  const inflight: Array<Promise<Frame>> = [];
  const launch = (t: number): void => {
    const p = renderAt(t);
    p.catch(() => undefined);
    inflight.push(p);
  };
  // Video has no alpha: anything the design leaves transparent would encode as black.
  // Rendered AT the output size, never rendered big and shrunk: half the size is a quarter of the pixels.
  const scale = exportScale(args.scale);
  const fit = scale < 1 ? { fitTo: { mode: 'zoom' as const, value: scale } } : {};
  // A clip far off the canvas aborts resvg outright. See frame-cull.ts.
  const rasterOpts = (opaque: boolean): RasterJob['opts'] => (opaque ? { font, background: '#FFFFFF', ...fit } : { font, ...fit });
  // A frame or band drawing what a recent one drew reuses its raster (raster-memo.ts): holds, rests, static overlays.
  const memo = new RasterMemo<Raster>();
  const raster = (svg: string, opaque: boolean): Promise<Raster> =>
    memo.get(`${opaque ? 'o' : 't'}|${svgKey(svg)}`, () => pool.render({ svg, opts: rasterOpts(opaque), want: 'pixels' }));
  // Footage frames: plain clips are painted as decoded pixels between graphics bands (footage-bands.ts);
  // anything else embeds the clip's picture in the SVG for resvg.
  const counts = { pixel_frames: 0, embedded_frames: 0 };
  const draw = async (s: DesignSpec, opaque = video): Promise<Frame> => {
    const frame = cullFrame(s);
    const banded = bandedFrame(frame);
    if (banded) {
      const img = await paintBanded(banded, scale, {
        render: (svg, ground) => raster(svg, ground && opaque),
        clip: (slot, w, h) => feed.pixelsAt(slot, w, h),
      });
      if (img) { counts.pixel_frames++; return img; }
    }
    if (await feed.prepare(frame)) counts.embedded_frames++;
    return raster(renderToSVGString(frame), opaque);
  };
  const renderAt = (t: number): Promise<Frame> => {
    const turn = source.turning?.(t, frameMs);
    return turn ? drawTurning(turn) : draw(source.at(t, frameMs));
  };
  // Each scene drawn once, flat, and warped onto its face — exact perspective in two renders.
  const drawTurning = async (turn: TurningFrame & { over: DesignSpec }): Promise<Frame> => {
    const [over, ...faces] = await Promise.all([draw(turn.over, false), ...turn.faces.map(f => draw(f.spec))]);
    if (!over) throw new Error('the frame over a turning face did not render');
    const img = paintTurning(turn.stage, turn.faces.flatMap((f, i) => { const r = faces[i]; return r ? [{ img: r, corners: f.corners }] : []; }), over, spec.document.width);
    return { width: img.width, height: img.height, pixels: Buffer.from(img.pixels.buffer, img.pixels.byteOffset, img.pixels.byteLength) };
  };

  const started = performance.now();
  let width = 0, height = 0, bytes = 0, done = 0;
  let gifStats: GifStreamStats | null = null;
  let soundNote = '';
  let encoder = '';
  let soundWarning = '';

  if (video) {
    // Held in an object: the pipe is opened inside writeOldest, where flow analysis cannot follow a plain `let`.
    const out: { pipe: VideoPipe | null } = { pipe: null };
    const writeOldest = async (): Promise<void> => {
      const img = await (inflight.shift() as Promise<Frame>);
      if (!out.pipe) {
        ({ width, height } = img);
        out.pipe = new VideoPipe({ type, width, height, fps, outputPath });
        encoder = out.pipe.encoder === 'libx264' ? `libx264 ${x264Preset()}` : out.pipe.encoder;
      }
      await out.pipe.write(img.pixels);
      args.onFrame?.(++done);
    };
    try {
      for (const [i, t] of times.entries()) {
        await scripts?.ahead(i);
        // Decoders of clips that have left the screen are closed once no frame in flight can still ask them.
        feed.tick(window + 2);
        launch(t);
        if (inflight.length >= window) await writeOldest();
        await yieldToServer();
      }
      while (inflight.length) await writeOldest();
      if (out.pipe) bytes = (await out.pipe.finish()).bytes;
    } catch (e) {
      await shutdown();
      await out.pipe?.abort();
      return errResult(OP, `${type} export failed: ${(e as Error).message}`,
        'A render error names the layer — run diagnose_design. An ffmpeg error names the encoder.');
    }
    // After the frames, never inside the pipe (audio-mux.ts). A failed mix keeps the
    // minutes of rendering and says loudly that the file is silent.
    if (out.pipe && args.sound?.length) {
      try {
        await muxSound(outputPath, args.sound, runMs, type);
        bytes = fs.statSync(outputPath).size;
        soundNote = ` ${args.sound.length} sound clip(s) mixed under it (${type === 'mp4' ? 'AAC 192k' : 'Opus 128k'}).`;
      } catch (e) {
        soundWarning = `The video was written WITHOUT its sound: the mix failed (${(e as Error).message}). Check the files with animation(op:audio), then export again.`;
      }
    }
  } else {
    const sink = fileSink(outputPath);
    const out: { gif: GifStream | null } = { gif: null };
    const addOldest = async (): Promise<void> => {
      const img = await (inflight.shift() as Promise<Frame>);
      if (!out.gif) {
        ({ width, height } = img);
        out.gif = new GifStream(sink, { width, height, loopCount: 0 });
      }
      out.gif.add(new Uint8ClampedArray(img.pixels.buffer, img.pixels.byteOffset, img.pixels.byteLength), frameMs);
      args.onFrame?.(++done);
    };
    try {
      for (const [i, t] of times.entries()) {
        await scripts?.ahead(i);
        // Decoders of clips that have left the screen are closed once no frame in flight can still ask them.
        feed.tick(window + 2);
        launch(t);
        if (inflight.length >= window) await addOldest();
        await yieldToServer();
      }
      while (inflight.length) await addOldest();
      if (out.gif) gifStats = out.gif.finish();
      bytes = gifStats?.bytes ?? 0;
    } catch (e) {
      await shutdown();
      sink.abort();
      return errResult(OP, `Frame rendering failed: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer.');
    }
  }

  const footage = feed.stats();
  await shutdown();
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
    render_workers: pool.size,
    rasters_reused: memo.hits,
    ...(encoder ? { encoder } : {}),
    ...(footage.clips ? { footage: { ...footage, ...counts } } : {}),
    ...(args.extra ?? {}),
    ...(notes.length ? { notes } : {}),
    ...(soundWarning ? { warning: soundWarning } : {}),
    note: video
      ? `Encoded by ffmpeg as the frames rendered (${type === 'mp4' ? 'H.264, yuv420p, faststart' : 'VP9'}).${soundNote}`
      : 'Encoded in-process as the frames rendered: identical frames merged, later frames store only what changed.',
  });
}

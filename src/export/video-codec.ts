/**
 * Which H.264 encoder an mp4 is made with, and how hard it works — host knobs.
 *
 * Measured on the 4-core host: x264 at `medium` takes ~70 ms a 1080p frame, the
 * largest single cost of a video export once frames render fast. A bigger or
 * GPU host can say so:
 *   FOLIO_VIDEO_PRESET   x264 preset (ultrafast … veryslow), default medium
 *   FOLIO_VIDEO_ENCODER  libx264 (default) | h264_nvenc | h264_vaapi | h264_videotoolbox
 *   FOLIO_VAAPI_DEVICE   render node for vaapi, default /dev/dri/renderD128
 * A hardware encoder is proven once per process with a one-frame encode; when it
 * cannot run here (no device, no driver, not in this ffmpeg) mp4s fall back to
 * libx264 rather than fail.
 */

import { spawnSync } from 'child_process';

export type H264Encoder = 'libx264' | 'h264_nvenc' | 'h264_vaapi' | 'h264_videotoolbox';

const PRESETS = new Set(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']);
const HARDWARE = new Set<H264Encoder>(['h264_nvenc', 'h264_vaapi', 'h264_videotoolbox']);

/** The x264 preset FOLIO_VIDEO_PRESET names, or medium. */
export function x264Preset(env: NodeJS.ProcessEnv = process.env): string {
  const p = (env['FOLIO_VIDEO_PRESET'] ?? '').trim().toLowerCase();
  return PRESETS.has(p) ? p : 'medium';
}

/** The encoder FOLIO_VIDEO_ENCODER names, unproven; libx264 for anything else. */
export function askedEncoder(env: NodeJS.ProcessEnv = process.env): H264Encoder {
  const e = (env['FOLIO_VIDEO_ENCODER'] ?? '').trim().toLowerCase() as H264Encoder;
  return HARDWARE.has(e) ? e : 'libx264';
}

/** The pieces of an ffmpeg command an encoder needs: before the input, in the filter chain, and after it. */
export interface EncoderArgs { global: string[]; filters: string[]; codec: string[] }

export function h264Args(enc: H264Encoder, env: NodeJS.ProcessEnv = process.env): EncoderArgs {
  switch (enc) {
    case 'h264_nvenc':
      return { global: [], filters: [], codec: ['-c:v', 'h264_nvenc', '-preset', 'p4', '-rc', 'vbr', '-cq', '19', '-pix_fmt', 'yuv420p'] };
    case 'h264_vaapi':
      return { global: ['-vaapi_device', env['FOLIO_VAAPI_DEVICE'] || '/dev/dri/renderD128'], filters: ['format=nv12', 'hwupload'], codec: ['-c:v', 'h264_vaapi', '-qp', '20'] };
    case 'h264_videotoolbox':
      return { global: [], filters: [], codec: ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p'] };
    default:
      // tune=animation spends bits on hard edges and flat fills, which is all a design is.
      return { global: [], filters: [], codec: ['-c:v', 'libx264', '-preset', x264Preset(env), '-tune', 'animation', '-crf', '18', '-pix_fmt', 'yuv420p'] };
  }
}

const proven = new Map<string, boolean>();

/** Whether `enc` can encode on this host — one 64×64 frame, once per process. */
export function encoderWorks(enc: H264Encoder, bin = 'ffmpeg', env: NodeJS.ProcessEnv = process.env): boolean {
  if (enc === 'libx264') return true;
  const key = `${bin}|${enc}|${env['FOLIO_VAAPI_DEVICE'] ?? ''}`;
  const hit = proven.get(key);
  if (hit !== undefined) return hit;
  const a = h264Args(enc, env);
  const r = spawnSync(bin, ['-hide_banner', '-loglevel', 'error', ...a.global, '-f', 'lavfi', '-i', 'color=c=black:s=64x64:d=0.04',
    ...(a.filters.length ? ['-vf', a.filters.join(',')] : []), ...a.codec, '-frames:v', '1', '-f', 'null', '-'], { timeout: 15_000 });
  const ok = !r.error && r.status === 0;
  proven.set(key, ok);
  return ok;
}

/** The encoder an mp4 is made with here: the one asked for when it works, else libx264. */
export function h264Encoder(bin = 'ffmpeg', env: NodeJS.ProcessEnv = process.env): H264Encoder {
  const asked = askedEncoder(env);
  return encoderWorks(asked, bin, env) ? asked : 'libx264';
}

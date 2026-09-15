/**
 * Lay a design's sound under a rendered video — one ffmpeg pass after the
 * frames are encoded.
 *
 * Not inside the frame pipe: frames arrive at ~150 ms each while audio encodes
 * in milliseconds, so ffmpeg would queue audio packets waiting for video and
 * overflow its muxing queue on a long piece. Afterwards the video stream is
 * copied untouched (-c:v copy) and the pass costs seconds.
 *
 * Each clip is trimmed from its offset, cut to its planned length, faded
 * (linear, the same curve clipGain describes), delayed to its start and mixed
 * at its own volume. Clips are summed, not averaged (normalize=0), so a cue
 * does not duck the music; a limiter keeps the sum from clipping.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import type { SoundClip } from './audio-plan';
import type { VideoType } from './video-encode';

export interface MuxClip extends SoundClip { /** The file on disk. */ file: string }

const sec = (ms: number): string => (Math.max(0, ms) / 1000).toFixed(3);

/** The filter graph that places, fades and mixes every clip into [aout]. Exported for tests. */
export function soundFilter(clips: MuxClip[], totalMs: number): string {
  const chains = clips.map((c, i) => {
    const delay = Math.round(c.start_ms);
    const steps = [
      `atrim=start=${sec(c.offset_ms)}`, 'asetpts=PTS-STARTPTS', `atrim=duration=${sec(c.length_ms)}`,
      'aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo',
      `volume=${c.volume.toFixed(3)}`,
      ...(c.fade_in_ms > 0 ? [`afade=t=in:st=0:d=${sec(c.fade_in_ms)}`] : []),
      ...(c.fade_out_ms > 0 ? [`afade=t=out:st=${sec(c.length_ms - c.fade_out_ms)}:d=${sec(c.fade_out_ms)}`] : []),
      `adelay=delays=${delay}|${delay}`,
    ];
    return `[${i + 1}:a]${steps.join(',')}[s${i}]`;
  });
  const labels = clips.map((_, i) => `[s${i}]`).join('');
  // level=0: the limiter only catches peaks; its default auto-level would raise the whole mix.
  const mix = clips.length > 1 ? `amix=inputs=${clips.length}:normalize=0:duration=longest,alimiter=limit=0.97:level=0:latency=1,` : '';
  return [...chains, `${labels}${mix}apad,atrim=duration=${sec(totalMs)}[aout]`].join(';');
}

/** ffmpeg arguments for the mux pass. Exported so the codec choices are testable without ffmpeg. */
export function muxArgs(video: string, clips: MuxClip[], totalMs: number, type: VideoType, target: string): string[] {
  const inputs = clips.flatMap(c => [...(c.loop ? ['-stream_loop', '-1'] : []), '-i', c.file]);
  const codec = type === 'mp4' ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'libopus', '-b:a', '128k'];
  const container = type === 'mp4' ? ['-movflags', '+faststart', '-f', 'mp4'] : ['-f', 'webm'];
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', video, ...inputs,
    '-filter_complex', soundFilter(clips, totalMs), '-map', '0:v', '-map', '[aout]',
    '-c:v', 'copy', ...codec, '-t', sec(totalMs), ...container, target,
  ];
}

/** A mux that has not finished in this long is stuck on an input, not working. */
const MUX_TIMEOUT_MS = 120_000;

/** Replace `videoPath` with the same video carrying the sound. The original stays if the pass fails. */
export async function muxSound(videoPath: string, clips: MuxClip[], totalMs: number, type: VideoType, bin = 'ffmpeg'): Promise<void> {
  if (clips.length === 0) return;
  const partial = `${videoPath}.sound.partial`;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, muxArgs(videoPath, clips, totalMs, type, partial), { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), MUX_TIMEOUT_MS);
      child.stderr?.on('data', (d: Buffer) => { stderr = (stderr + d.toString()).slice(-2000); });
      child.on('error', e => { clearTimeout(timer); reject(e); });
      child.on('close', code => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with code ${String(code)}${stderr.trim() ? `: ${stderr.trim().split('\n').slice(-3).join(' | ')}` : ''}`));
      });
    });
    fs.renameSync(partial, videoPath);
  } catch (e) {
    fs.rmSync(partial, { force: true });
    throw e;
  }
}

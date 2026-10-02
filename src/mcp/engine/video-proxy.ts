// A 720p stand-in for every stored clip. What reads footage to LOOK at it — a
// storyboard, a silence measure, the editor's playback — reads the proxy: a phone
// clip is often 4K with a 2 s keyframe spacing, slow to decode and to seek. An
// export always reads the original.
//
//   assets/video/<folder>/<name>  →  assets/video/.proxy/<folder>/<name>.mp4
//
// Built in the background after a clip is stored, one at a time; a proxy older
// than its clip is ignored (the clip was replaced) and rebuilt on the next store.

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

/** Long edge of a proxy — never upscaled. */
export const PROXY_EDGE = 1280;

/** Where a clip's proxy lives, or null for a file outside an assets/video folder. */
export function proxyPathOf(abs: string): string | null {
  const m = /^(.*[\\/]assets[\\/]video)[\\/](.+)$/.exec(abs);
  if (!m || /(^|[\\/])\.proxy([\\/]|$)/.test(m[2] ?? '')) return null;
  return path.join(m[1] ?? '', '.proxy', `${(m[2] ?? '').replace(/\.[a-z0-9]+$/i, '')}.mp4`);
}

/** The clip's proxy when one is built and newer than the clip, else null. */
export function proxyFor(abs: string): string | null {
  const p = proxyPathOf(abs);
  if (!p) return null;
  try { return fs.statSync(p).mtimeMs >= fs.statSync(abs).mtimeMs ? p : null; } catch { return null; }
}

/** 720p H.264, a keyframe every half second (fast seeks), AAC sound, index first. */
export function proxyArgs(src: string, out: string): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', src,
    '-vf', `scale='if(gte(iw,ih),min(${PROXY_EDGE},iw),-2)':'if(gte(iw,ih),-2,min(${PROXY_EDGE},ih))'`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-g', '15', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', '-f', 'mp4', out,
  ];
}

let queue: Promise<void> = Promise.resolve();

/** Build a clip's proxy in the background unless a fresh one exists. Resolves when this one is done (or failed). */
export function queueProxy(abs: string, bin = 'ffmpeg'): Promise<void> {
  const out = proxyPathOf(abs);
  if (!out || proxyFor(abs)) return Promise.resolve();
  queue = queue.then(() => new Promise<void>(resolve => {
    const partial = `${out}.partial`;
    try { fs.mkdirSync(path.dirname(out), { recursive: true }); } catch { resolve(); return; }
    const p = spawn(bin, proxyArgs(abs, partial), { stdio: ['ignore', 'ignore', 'ignore'] });
    p.on('error', () => { fs.rm(partial, { force: true }, () => resolve()); });
    p.on('close', code => {
      if (code === 0) fs.rename(partial, out, () => resolve());
      else fs.rm(partial, { force: true }, () => resolve());
    });
  }));
  return queue;
}

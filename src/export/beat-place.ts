/**
 * Where a file's beats sound on the piece — shared by animation(op:beats) on
 * the server and the editor timeline's sound row, which measures the same
 * file in the browser.
 */

import type { SoundClip } from './audio-plan';

/** Times in a file, placed where the clip sounds them on the piece — every pass of a loop. */
export function beatsOnPiece(clip: Pick<SoundClip, 'start_ms' | 'offset_ms' | 'length_ms' | 'loop'>, fileTimes: number[], fileMs: number): number[] {
  const out: number[] = [];
  const end = clip.start_ms + clip.length_ms;
  // Piece time of the file's 0 ms on this pass: the first pass starts at the offset, later ones at 0.
  let passStart = clip.start_ms - clip.offset_ms;
  for (let pass = 0; passStart < end && pass < 1000; pass++) {
    for (const t of fileTimes) {
      const at = passStart + t;
      if (at >= clip.start_ms && at <= end) out.push(Math.round(at));
    }
    if (!clip.loop || fileMs <= 0) break;
    passStart += fileMs;
  }
  return out;
}

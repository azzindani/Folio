/**
 * A processed image too heavy as PNG, stored once as JPEG.
 *
 * The process pipeline writes PNG on purpose — re-encoding a photo as JPEG on
 * every edit would compound its artefacts. But grain, noise and photographic
 * detail defeat PNG compression: the first one-shot benchmark grained an A3
 * cover photo and got a 9.6 MB PNG, over the 8 MB asset cap, and the build had
 * to drop the grain. When the PNG will not fit and the image is fully opaque
 * (JPEG has no alpha), one high-quality JPEG encode is the honest trade.
 * ffmpeg does the encoding — the image ships it for sound and video already.
 */
import { spawnSync } from 'child_process';

/** True when every pixel of an RGBA buffer is fully opaque. */
export function isOpaque(rgba: Uint8Array | Uint8ClampedArray): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
  return true;
}

/** Encode PNG bytes as a high-quality JPEG, or null when ffmpeg is missing or fails. */
export function pngToJpeg(png: Buffer): Buffer | null {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-f', 'png_pipe', '-i', 'pipe:0', '-q:v', '2', '-f', 'mjpeg', 'pipe:1'], {
    input: png, maxBuffer: 256 * 1024 * 1024,
  });
  return r.status === 0 && r.stdout && r.stdout.length > 0 ? r.stdout : null;
}

// A clip as one picture — how a model looks at footage before it cuts it.
//
// A blind model cannot trim what it cannot see, and a frame at a time costs a
// call and an image each. asset_read on a video returns ONE storyboard: frames
// sampled densely across the clip (or a from_ms–to_ms window, to zoom in),
// near-duplicates dropped so a long static shot costs one tile, each tile
// stamped with its time on the file's clock — the clock op:video's offset_ms
// and duration_ms are written in.

import { spawn } from 'child_process';
import type { ResvgRenderOptions } from '@resvg/resvg-js';
import type { ToolResult } from '../types';
import { okResult, errResult, buildContext, buildHandover, pOk } from './utils';
import { probeVideo } from './asset-video';
import { detectSilence, SILENCE_DB, SILENCE_MIN_MS, type Span } from './video-silence';
import { proxyFor } from './video-proxy';
import { encodePNG } from '../../utils/png-codec';
import { rasterize } from '../../utils/resvg-isolate';
import { showinfoTimes } from './video-decode';

export const TILE_W = 160;
export const TILE_H = 90;
const COLS = 6;
const MAX_TILES = 36;
/** Fewest tiles a storyboard shows, so a single long shot is still seen across its span. */
const MIN_TILES = 6;
/** Frames sampled before near-duplicates are dropped. */
const CANDIDATES = 120;
/** Longer than this, only keyframes are decoded — an overview, not every frame. */
const KEYFRAMES_PAST_MS = 20_000;
/** Mean luma change (0–255, on a 16×9 grid) that makes a sample a new tile. */
const NEW_SHOT = 10;

export interface Tile { ms: number; rgb: Buffer }

/** ffmpeg arguments: small RGB tiles across [fromMs, toMs), each logged by showinfo. */
export function sampleArgs(file: string, fromMs: number, toMs: number): string[] {
  const span = Math.max(1, toMs - fromMs);
  const keyOnly = span > KEYFRAMES_PAST_MS;
  const rate = keyOnly ? '' : `fps=${((CANDIDATES * 1000) / span).toFixed(4)},`;
  return [
    '-hide_banner', '-nostats', '-v', 'info', ...(keyOnly ? ['-skip_frame', 'nokey'] : []),
    '-ss', (fromMs / 1000).toFixed(3), '-t', (span / 1000).toFixed(3), '-i', file, '-an', '-sn', '-dn',
    '-vf', `${rate}showinfo,scale=${TILE_W}:${TILE_H}:force_original_aspect_ratio=decrease,pad=${TILE_W}:${TILE_H}:(ow-iw)/2:(oh-ih)/2:black,format=rgb24`,
    '-fps_mode', 'passthrough', '-f', 'rawvideo', 'pipe:1',
  ];
}

/** A tile's mean luma on a 16×9 grid. */
function lumaGrid(rgb: Buffer): Float32Array {
  const g = new Float32Array(16 * 9);
  const cw = TILE_W / 16, ch = TILE_H / 9;
  for (let y = 0; y < TILE_H; y++) {
    for (let x = 0; x < TILE_W; x++) {
      const i = (y * TILE_W + x) * 3;
      g[Math.floor(y / ch) * 16 + Math.floor(x / cw)] += 0.299 * (rgb[i] ?? 0) + 0.587 * (rgb[i + 1] ?? 0) + 0.114 * (rgb[i + 2] ?? 0);
    }
  }
  for (let k = 0; k < g.length; k++) g[k] = (g[k] ?? 0) / (cw * ch);
  return g;
}

/** Tiles that differ from the last kept one, thinned evenly to at most MAX_TILES and filled to at least MIN_TILES. */
export function distinctTiles(tiles: Tile[]): Tile[] {
  const kept: Tile[] = [];
  let last: Float32Array | null = null;
  for (const t of tiles) {
    const g = lumaGrid(t.rgb);
    if (last) {
      let d = 0;
      for (let k = 0; k < g.length; k++) d += Math.abs((g[k] ?? 0) - (last[k] ?? 0));
      if (d / g.length <= NEW_SHOT) continue;
    }
    last = g;
    kept.push(t);
  }
  if (kept.length < MIN_TILES && tiles.length > kept.length) {
    // One long shot still needs its span shown: evenly spaced samples join what changed.
    const want = Math.min(MIN_TILES, tiles.length);
    const even = Array.from({ length: want }, (_, i) => tiles[Math.floor((i * tiles.length) / want)] as Tile);
    return [...new Map([...kept, ...even].map(t => [t.ms, t])).values()].sort((a, b) => a.ms - b.ms);
  }
  if (kept.length <= MAX_TILES) return kept;
  const step = kept.length / MAX_TILES;
  return Array.from({ length: MAX_TILES }, (_, i) => kept[Math.floor(i * step)] as Tile);
}

/** m:ss.s on the file's clock. */
export function stamp(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
}

/** Every sampled tile of [fromMs, toMs), on the file's clock. */
export function sampleTiles(file: string, fromMs: number, toMs: number, bin = 'ffmpeg'): Promise<Tile[]> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, sampleArgs(file, fromMs, toMs), { stdio: ['ignore', 'pipe', 'pipe'] });
    const out: Buffer[] = [];
    let log = '';
    p.stdout.on('data', (c: Buffer) => out.push(c));
    p.stderr.on('data', (c: Buffer) => { log += c.toString(); });
    p.on('error', reject);
    p.on('close', code => {
      if (code !== 0) { reject(new Error(log.trim().split('\n').slice(-2).join(' ') || `ffmpeg exited ${String(code)}`)); return; }
      const raw = Buffer.concat(out);
      const size = TILE_W * TILE_H * 3;
      const times = showinfoTimes(log);
      const tiles: Tile[] = [];
      for (let i = 0; (i + 1) * size <= raw.length; i++) tiles.push({ ms: Math.round(fromMs + (times[i] ?? 0) * 1000), rgb: raw.subarray(i * size, (i + 1) * size) });
      resolve(tiles);
    });
  });
}

/** The tiles laid out COLS wide with their times burned in, as one PNG. */
export function storyboardPNG(tiles: Tile[], font: ResvgRenderOptions['font']): { png: Buffer; width: number; height: number } {
  const cols = Math.min(COLS, Math.max(1, tiles.length));
  const rows = Math.max(1, Math.ceil(tiles.length / cols));
  const width = cols * TILE_W, height = rows * TILE_H;
  const px = new Uint8ClampedArray(width * height * 4);
  tiles.forEach((t, n) => {
    const ox = (n % cols) * TILE_W, oy = Math.floor(n / cols) * TILE_H;
    for (let y = 0; y < TILE_H; y++) {
      for (let x = 0; x < TILE_W; x++) {
        const s = (y * TILE_W + x) * 3, d = ((oy + y) * width + ox + x) * 4;
        px[d] = t.rgb[s] ?? 0; px[d + 1] = t.rgb[s + 1] ?? 0; px[d + 2] = t.rgb[s + 2] ?? 0; px[d + 3] = 255;
      }
    }
  });
  const sheet = encodePNG({ width, height, pixels: px }).toString('base64');
  const labels = tiles.map((t, n) => {
    const x = (n % cols) * TILE_W, y = Math.floor(n / cols) * TILE_H + TILE_H - 15;
    return `<rect x="${x}" y="${y}" width="44" height="15" fill="#000" fill-opacity="0.7"/>` +
      `<text x="${x + 4}" y="${y + 11}" font-family="DejaVu Sans" font-weight="700" font-size="10" fill="#fff">${stamp(t.ms)}</text>`;
  }).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><image href="data:image/png;base64,${sheet}" width="${width}" height="${height}"/>${labels}</svg>`;
  const r = rasterize({ svg, opts: { font }, want: 'png' });
  return { png: r.png, width: r.width, height: r.height };
}

const OP = 'asset_read';

/** Whether an asset path is a clip asset_read answers with a storyboard. */
export function isVideoAsset(rel: string): boolean {
  return /\.(mp4|m4v|mov|webm)$/i.test(rel);
}

/** asset_read on a stored clip: its storyboard, over the whole file or [from_ms, to_ms). */
export async function storyboardRead(rel: string, abs: string, win: { from_ms?: number; to_ms?: number }, font: ResvgRenderOptions['font']): Promise<ToolResult> {
  const probe = probeVideo(abs);
  if (probe === 'not-video' || probe === null) return errResult(OP, `Not a readable clip: ${rel}`, 'manage_design {op:"asset_list"} shows what is stored; re-add the clip if it was replaced.');
  const dur = probe.duration_ms;
  const from = Math.max(0, Math.min(Number(win.from_ms) || 0, Math.max(0, dur - 1)));
  const to = Math.max(from + 1, Math.min(Number(win.to_ms) || dur, dur));
  let tiles: Tile[];
  // Looking reads the 720p proxy when one is built (video-proxy.ts) — same clock, faster decode.
  const look = proxyFor(abs) ?? abs;
  try { tiles = await sampleTiles(look, from, to); } catch (e) { return errResult(OP, `Could not sample ${rel}: ${(e as Error).message}`, 'Check the file plays: manage_design {op:"asset_list"} shows its duration.'); }
  const kept = distinctTiles(tiles);
  if (!kept.length) return errResult(OP, `No frames in ${stamp(from)}–${stamp(to)} of ${rel}`, 'Widen the window, or omit from_ms/to_ms for the whole clip.');
  const sheet = storyboardPNG(kept, font);
  // Where the sound stops — the dead air op:video cut can take out. A failed measure is not a failed read.
  let silence: Span[] | null = null;
  if (probe.has_audio) { try { silence = await detectSilence(look, from, to); } catch { silence = null; } }
  return okResult(OP, {
    asset_path: rel, kind: 'video', duration_ms: dur, width: probe.width, height: probe.height, ...(probe.fps ? { fps: probe.fps } : {}),
    window: { from_ms: from, to_ms: to }, sampled: tiles.length,
    tiles: kept.map((t, i) => ({ tile: i + 1, ms: t.ms })),
    ...(silence ? { sound: { silences: silence, threshold_db: SILENCE_DB, min_ms: SILENCE_MIN_MS, note: 'Spans quieter than the threshold for at least min_ms, on the file clock. op:video cut:[[from_ms, to_ms], …] removes chosen spans and closes the gap.' } } : {}),
    note: 'One image: tiles left to right, top to bottom, each stamped with its time on the FILE clock — the clock op:video offset_ms / duration_ms use. Near-identical frames are dropped, so one tile can stand for a long shot. Zoom in with from_ms/to_ms.',
    progress: [pOk('Storyboard', `${kept.length} tile(s) from ${tiles.length} samples of ${stamp(from)}–${stamp(to)}`)],
    context: buildContext(OP, `Storyboard of ${rel}`), handover: buildHandover('COMPOSE', {}),
    _attachments: [{ type: 'image' as const, data: sheet.png.toString('base64'), mimeType: 'image/png' }],
  });
}

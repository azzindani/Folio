// Footage export benchmark — the number to compare hosts and settings by.
//
//   bun scripts/bench-export.ts [seconds=6] [fps=30] [width=1920] [height=1080]
//
// Builds a throwaway project in $TMPDIR: one synthetic clip (ffmpeg testsrc2 +
// a tone), and a design over it — a dark band and a title that rises in, then
// holds. Exports it as mp4 through the same engine call as
// animation(op:export), prints the receipt, and deletes the project. Knobs
// to try: FOLIO_RENDER_WORKERS, FOLIO_VIDEO_PRESET, FOLIO_VIDEO_ENCODER
// (docs/DEPLOYMENT.md §5.4). Needs ffmpeg + ffprobe on PATH.
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { exportAnimation } from '../src/mcp/engine/motion-export';

const [seconds = 6, fps = 30, width = 1920, height = 1080] = process.argv.slice(2).map(Number);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-bench-'));
for (const d of ['designs', 'assets/video', 'exports']) fs.mkdirSync(path.join(root, d), { recursive: true });

const clip = path.join(root, 'assets/video/take.mp4');
const made = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=s=${width}x${height}:r=${fps}:d=${seconds + 2}`,
  '-f', 'lavfi', '-i', `sine=frequency=440:d=${seconds + 2}`, '-c:v', 'libx264', '-preset', 'veryfast', '-g', '60', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-shortest', '-y', clip], { stdio: 'inherit' });
if (made.status !== 0) { process.stderr.write('ffmpeg could not make the test clip\n'); process.exit(1); }

const design = path.join(root, 'designs/bench.design.yaml');
const bandH = Math.round(height * 0.24);
fs.writeFileSync(design, `_protocol: design/v1
meta: {id: bench, name: bench, type: poster}
document: {width: ${width}, height: ${height}, unit: px, dpi: 96}
layers:
- {id: bg, type: rect, z: 0, x: 0, 'y': 0, width: ${width}, height: ${height}, fill: '#FAF5EC'}
- {id: take, type: video, z: 1, src: assets/video/take.mp4, x: 0, 'y': 0, width: ${width}, height: ${height}, fit: cover, video: {offset_ms: 1000, duration_ms: ${seconds * 1000}}}
- {id: band, type: rect, z: 2, x: 0, 'y': ${height - bandH}, width: ${width}, height: ${bandH}, fill: '#101418'}
- id: title
  type: text
  z: 3
  x: ${Math.round(width * 0.05)}
  'y': ${height - bandH + Math.round(bandH * 0.2)}
  width: ${Math.round(width * 0.6)}
  height: ${Math.round(bandH * 0.6)}
  content: {type: plain, value: Footage bench}
  style: {font_family: Archivo, color: '#F4F1EA', font_size: ${Math.round(bandH * 0.42)}, font_weight: 800}
  animation: {rule: [{preset: rise, at: 0, duration: 800}]}
`);

const load = os.loadavg()[0] ?? 0;
const t0 = performance.now();
const r = await exportAnimation({ design_path: design, type: 'mp4', fps, duration: seconds * 1000, background: false }) as unknown as Record<string, unknown>;
const wall = (performance.now() - t0) / 1000;
const frames = Number(r['frames'] ?? 0);
const pick = ['success', 'error', 'frames', 'fps', 'width', 'height', 'render_workers', 'footage', 'rasters_reused', 'encoder'];
process.stdout.write(`${JSON.stringify(Object.fromEntries(pick.filter(k => k in r).map(k => [k, r[k]])), null, 1)}\n`);
process.stdout.write(`host ${os.cpus().length} cores · load ${load.toFixed(1)} at start · runtime ${typeof Bun === 'undefined' ? `node ${process.version}` : `bun ${Bun.version}`}\n`);
process.stdout.write(`wall ${wall.toFixed(1)} s · ${frames ? (wall * 1000 / frames).toFixed(1) : '—'} ms/frame · ${frames ? (frames / wall).toFixed(1) : '—'} frames/s\n`);
fs.rmSync(root, { recursive: true, force: true });
process.exit(r['success'] === true ? 0 : 1);

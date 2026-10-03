/**
 * What the editor can read off a clip's footage — GET /__project_files/__clip/measure?design=<rel>&layer=<id>
 *
 *   → {ok, from, to, shots: [file ms], silences: [[file ms, file ms]]}
 *
 * Over the part of the file the clip plays (the same arithmetic animation(op:video) cuts by), measured with
 * the engine's own readers: scene cuts on the 720p proxy when one is built (as the beat cut does), silences
 * on the sound. The same file twice answers from a small cache, keyed by the file's mtime. The editor draws
 * the shots as ticks and snap points on the clip block and offers the silences to cut.
 */

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { Layer } from '../schema/types';
import { summarize, type ClipLayer } from '../animation/video-clip';
import { editPoints } from '../mcp/engine/video-edit-points';
import { detectSilence } from '../mcp/engine/video-silence';
import { proxyFor } from '../mcp/engine/video-proxy';
import { resolveAssetFile } from '../mcp/engine/asset-resolve';
import type { ClipRouteDeps } from './server-clip';

type Span = [number, number];
export interface Measured { shots: number[]; silences: Span[] }
/** How a file is read — injectable, so the route is testable without ffmpeg. */
export interface Readers {
  shots(file: string, from: number, to: number): Promise<number[]>;
  silences(file: string, from: number, to: number): Promise<Span[]>;
}

/** A longer part than this is not measured in one go: trim the clip first. */
export const MAX_MEASURE_MS = 600_000;
const CACHE_SIZE = 32;
const cache = new Map<string, Measured>();

const json = (status: number, body: Record<string, unknown>): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const real: Readers = {
  shots: async (file, from, to) => (await editPoints(proxyFor(file) ?? file, from, to, false)).shots,
  silences: (file, from, to) => detectSilence(file, from, to),
};

function findClip(layers: Layer[], id: string): ClipLayer | null {
  for (const l of layers) {
    if (l.id === id && l.type === 'video') return l as ClipLayer;
    const kids = (l as ClipLayer).layers;
    const hit = Array.isArray(kids) ? findClip(kids, id) : null;
    if (hit) return hit;
  }
  return null;
}

export async function measureRoute(req: Request, url: URL, deps: ClipRouteDeps & { readers?: Readers }): Promise<Response | null> {
  if (url.pathname !== '/__project_files/__clip/measure' || req.method !== 'GET') return null;
  const rel = url.searchParams.get('design') ?? '', id = url.searchParams.get('layer') ?? '';
  const abs = rel.endsWith('.design.yaml') ? deps.resolve(rel) : null;
  if (!abs || !fs.existsSync(abs)) return json(400, { ok: false, error: 'design must be a .design.yaml path inside the projects folder.' });
  let clip: ClipLayer | null = null;
  try {
    const spec = yaml.load(fs.readFileSync(abs, 'utf8')) as { layers?: Layer[]; pages?: Array<{ layers?: Layer[] }> };
    for (const scope of [spec.layers ?? [], ...(spec.pages ?? []).map(p => p.layers ?? [])]) { clip ??= findClip(scope, id); }
  } catch (e) { return json(400, { ok: false, error: `The design did not parse: ${(e as Error).message}` }); }
  if (!clip?.src) return json(404, { ok: false, error: `"${id}" is not a video layer in this design.` });
  const file = resolveAssetFile(clip.src, abs, path.dirname(path.dirname(abs)));
  if (!file) return json(404, { ok: false, error: `The footage "${clip.src}" is not in the project.` });
  const s = summarize(clip);
  const from = Math.max(0, Math.round(s.file.from));
  const to = Math.round(s.file.to ?? from);
  if (!(to > from)) return json(422, { ok: false, error: 'This clip has no length to measure yet.' });
  if (to - from > MAX_MEASURE_MS) return json(422, { ok: false, error: `The clip plays ${Math.round((to - from) / 1000)} s of its file; measuring is for ${MAX_MEASURE_MS / 1000} s or less.`, hint: 'Trim the clip first.' });
  const key = `${file}|${fs.statSync(file).mtimeMs}|${from}|${to}`;
  let hit = cache.get(key);
  if (!hit) {
    const readers = deps.readers ?? real;
    try {
      // A silent or sound-less file has no silences to find; the shots stand on their own.
      const [shots, silences] = await Promise.all([readers.shots(file, from, to), readers.silences(file, from, to).catch((): Span[] => [])]);
      hit = { shots, silences };
    } catch (e) { return json(502, { ok: false, error: `The footage could not be measured: ${(e as Error).message}` }); }
    cache.set(key, hit);
    if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  }
  return json(200, { ok: true, from, to, shots: hit.shots, silences: hit.silences });
}

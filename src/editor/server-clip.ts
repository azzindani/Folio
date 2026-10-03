/**
 * The editor's clip bridge — animation(op:video) on the design the editor has just saved.
 *
 *   POST /__project_files/__clip   {design, layer_id, page_id?, freeze? | on_beats?}  → {ok, content, result}
 *
 * Behind the /__project_files auth like the export route beside it (server-export.ts, whose MCP caller it
 * borrows). Only what needs the server is let through: a freeze frame (it ripples the whole scene), a cut
 * to the beat (it measures the music and the shots with ffmpeg) and spans cut out of a clip (it ripples too). Everything else a person does to a clip
 * happens in the browser, on the same rules (animation/clip-edit.ts). The reply carries the design file as
 * written, so the editor shows exactly what the MCP would have left.
 */

import * as fs from 'fs';
import { callLocalTool, type CallTool } from './server-export';

type Rec = Record<string, unknown>;

export interface ClipRouteDeps {
  /** A request path inside the projects dir → its absolute path, or null when it escapes. */
  resolve: (rel: string) => string | null;
  callTool?: CallTool;
}

const json = (status: number, body: Rec): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

/** What of the tool's reply the editor shows or uses. */
const KEEP = ['removed_ms', 'spans', 'ripple', 'clips', 'moved', 'kept', 'frozen_at_ms', 'hold_ms', 'file_ms', 'bpm', 'beat_ms', 'pulse', 'every', 'track', 'moved_later'];

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The tool arguments for a request the editor may make; the reason as a string when it may not. */
export function clipArgs(body: Rec, abs: string): Rec | string {
  const layer = typeof body['layer_id'] === 'string' ? body['layer_id'] : '';
  if (!layer) return 'layer_id is required.';
  const args: Rec = { op: 'video', design_path: abs, layer_id: layer };
  if (typeof body['page_id'] === 'string') args['page_id'] = body['page_id'];
  const freeze = body['freeze'], beats = body['on_beats'], cut = body['cut'];
  if (['freeze', 'on_beats', 'cut'].filter(k => body[k] !== undefined && body[k] !== null).length !== 1) return 'Send exactly one of freeze, on_beats or cut.';
  if (cut !== undefined && cut !== null) {
    if (!Array.isArray(cut) || !cut.length || cut.length > 200 || !cut.every(s => Array.isArray(s) && s.length === 2 && s.every(v => typeof v === 'number' && Number.isFinite(v)))) return 'cut must be 1–200 spans [from_ms, to_ms] on the file clock.';
    args['cut'] = cut;
  } else if (isRec(freeze)) {
    if (typeof freeze['at'] !== 'number' || typeof freeze['duration_ms'] !== 'number') return 'freeze needs {at (ms on the scene clock), duration_ms}.';
    args['freeze'] = { at: freeze['at'], duration_ms: freeze['duration_ms'] };
  } else if (beats === true) args['on_beats'] = true;
  else if (isRec(beats)) {
    const o: Rec = {};
    for (const k of ['every', 'end', 'max_shift_ms', 'within_shots']) if (beats[k] !== undefined) o[k] = beats[k];
    args['on_beats'] = o;
  } else return 'on_beats must be true or an options object.';
  return args;
}

export async function clipRoute(req: Request, url: URL, deps: ClipRouteDeps): Promise<Response | null> {
  if (url.pathname !== '/__project_files/__clip' || req.method !== 'POST') return null;
  let body: Rec;
  try { body = await req.json() as Rec; } catch { return json(400, { ok: false, error: 'Send JSON: {design, layer_id, freeze | on_beats | cut}.' }); }
  const rel = typeof body['design'] === 'string' ? body['design'] : '';
  const abs = rel.endsWith('.design.yaml') ? deps.resolve(rel) : null;
  if (!abs || !fs.existsSync(abs)) return json(400, { ok: false, error: 'design must be a .design.yaml path inside the projects folder.' });
  const args = clipArgs(body, abs);
  if (typeof args === 'string') return json(400, { ok: false, error: args });
  try {
    const r = await (deps.callTool ?? callLocalTool)('animation', args);
    if (r['success'] === false) return json(422, { ok: false, error: r['error'] ?? 'The edit was refused.', hint: r['hint'] });
    return json(200, { ok: true, content: fs.readFileSync(abs, 'utf8'), result: Object.fromEntries(KEEP.filter(k => r[k] !== undefined).map(k => [k, r[k]])) });
  } catch (e) {
    return json(502, { ok: false, error: `The engine did not answer: ${(e as Error).message}` });
  }
}

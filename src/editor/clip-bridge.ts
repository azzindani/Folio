// Asking the server's engine to edit a clip — for the edits that need what the browser does not have:
// ffmpeg (measuring the music and the footage's shots) and the ripple of a whole scene (a freeze frame
// opens time, and everything after it moves).
//
// The same code the MCP runs: the editor saves, the server runs animation(op:video) on the saved file
// (editor/server-clip.ts — the route behind the editor's export is its model), and the file comes back to
// replace the design on screen as ONE undo step. Nothing here re-implements an edit.

import type { StateManager } from './state';
import { parseDesign } from '../schema/parser';
import { serverHost } from './server-host';
import { authHeaders } from '../ui/panels/clip-assets';

/** What the editor may ask: a freeze, or a cut to the music's beats. */
export interface ClipOp { layer_id: string; freeze?: { at: number; duration_ms: number }; on_beats?: true | { every?: number; end?: boolean; max_shift_ms?: number; within_shots?: boolean } }

export interface ClipOpReply { ok: boolean; error?: string; hint?: string; result?: Record<string, unknown> }

/** Run the op on the server, and replace the design on screen with what it wrote. */
export async function runClipOp(state: StateManager, op: ClipOp, call: typeof fetch = (i, init) => fetch(i, init)): Promise<ClipOpReply> {
  const host = serverHost(), rel = host?.rel();
  if (!host || !rel) return { ok: false, error: 'This edit runs on the Folio server: save the design to the library first.' };
  // The server reads the FILE: save first, or the op misses the edits made since.
  await host.save();
  if (state.get().dirty) return { ok: false, error: 'The design could not be saved, so the server cannot see your latest edits.' };
  const { design, currentPageIndex } = state.get();
  const pageId = design?.pages?.[currentPageIndex]?.id;
  let reply: { ok?: boolean; content?: string; result?: Record<string, unknown>; error?: string; hint?: string };
  try {
    const r = await call('/__project_files/__clip', {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ design: rel, ...(pageId ? { page_id: pageId } : {}), ...op }),
    });
    reply = await r.json() as typeof reply;
    if (!r.ok && !reply.error) reply.error = `The server answered ${r.status}.`;
  } catch (e) { return { ok: false, error: `The server did not answer: ${(e as Error).message}` }; }
  if (!reply.ok || typeof reply.content !== 'string') return { ok: false, error: reply.error ?? 'The server refused the edit.', ...(reply.hint ? { hint: reply.hint } : {}) };
  let next;
  try { next = parseDesign(reply.content); } catch (e) { return { ok: false, error: `The server's reply did not parse: ${(e as Error).message}` }; }
  // The file IS this design now: one undo step back to what was on screen, and nothing left to save.
  state.set('design', next);
  state.set('dirty', false, false);
  return { ok: true, ...(reply.result ? { result: reply.result } : {}) };
}

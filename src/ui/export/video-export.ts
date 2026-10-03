/**
 * Export a design's motion as a video file — rendered on the server, saved here.
 *
 * The render is the MCP export itself (editor/server-export.ts), so a deck comes
 * out as ONE piece with its transitions, exactly as Play all shows it, and the
 * file is the same one animation(op:export) writes. This side starts the job,
 * follows it in a small progress strip, and hands the finished file to the
 * browser's own download.
 *
 * The file is NOT pulled into the page as a Blob. That route — fetch, blob,
 * object URL, click, revoke on the next line — reported "failed" for the user
 * on a 4.8 MB GIF the server had rendered fine: a revoked URL cancels a download
 * the browser has not started yet, and a video can run to tens of megabytes held
 * twice in memory. A link to the file with ?download (Content-Disposition:
 * attachment) lets the browser stream it to disk itself.
 */

import { showToast } from '../../utils/toast';
import { startExportTray } from './export-tray';

export { saveFromServer } from './save-from-server';

export type VideoFormat = 'mp4' | 'gif';

export interface VideoExportRequest {
  /** The design's path inside the projects folder, as the editor opened it. */
  design: string;
  /** pdf runs as a server job too, so a long document survives a closed tab. */
  type: VideoFormat | 'pdf';
  /** Play every page as one piece (a deck) instead of the first page alone. */
  scenes: boolean;
  /** Output size as a fraction of the canvas, 0.1–1. */
  scale?: number;
  fps?: number;
}

export interface VideoExportIO { fetch?: typeof fetch; pollMs?: number }


/**
 * Start the server render and hand it to the Exports tray. Resolves with the job
 * id, or null when the server refused. The page does not wait for the file: the
 * render is the server's, the tray follows it, and a closed tab loses nothing.
 */
export async function exportVideo(req: VideoExportRequest, io: VideoExportIO = {}): Promise<string | null> {
  const call = io.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  try {
    const started = await call('/__project_files/__export', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design: req.design, type: req.type, scenes: req.scenes, scale: req.scale, fps: req.fps }),
    });
    const job = await started.json() as { job_id?: string; error?: string; hint?: string };
    if (!started.ok || !job.job_id) throw new Error([job.error, job.hint].filter(Boolean).join(' ') || `HTTP ${started.status}`);
    showToast(`${req.type.toUpperCase()} is rendering on the server. You can close this tab; the file will be waiting here.`, 'info');
    startExportTray({ fetch: io.fetch, pollMs: io.pollMs });
    return job.job_id;
  } catch (e) {
    showToast(`Video export failed: ${(e as Error).message}`, 'error');
    return null;
  }
}

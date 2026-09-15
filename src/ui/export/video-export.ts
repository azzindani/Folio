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

export type VideoFormat = 'mp4' | 'gif';

export interface VideoExportRequest {
  /** The design's path inside the projects folder, as the editor opened it. */
  design: string;
  type: VideoFormat;
  /** Play every page as one piece (a deck) instead of the first page alone. */
  scenes: boolean;
  /** Output size as a fraction of the canvas, 0.1–1. */
  scale?: number;
  fps?: number;
}

interface StatusReply { state?: string; percent?: number; eta_ms?: number; download?: string; error?: string }

export interface VideoExportIO { fetch?: typeof fetch; pollMs?: number }

const wait = (ms: number): Promise<void> => new Promise(done => setTimeout(done, ms));

function progressStrip(label: string): { set(text: string): void; remove(): void } {
  const el = document.createElement('div');
  el.className = 'video-export-progress';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:9500;background:#141416;color:#EDEDED;' +
    'border:1px solid #2A2A2E;border-radius:6px;padding:10px 14px;font:13px system-ui,sans-serif;min-width:240px;';
  document.body.appendChild(el);
  const set = (text: string): void => { el.textContent = `${label}: ${text}`; };
  set('starting');
  return { set, remove: () => el.remove() };
}

/** What the strip says about a job still running. */
export function progressText(s: StatusReply): string {
  if (s.state === 'queued') return 'waiting for the render ahead of it';
  const eta = s.eta_ms ? ` · about ${Math.ceil(s.eta_ms / 1000)}s left` : '';
  return `rendering ${s.percent ?? 0}%${eta}`;
}

/** Hand a server file to the browser's download: an attached link, clicked, with ?download. */
export function saveFromServer(url: string, name: string): void {
  const a = document.createElement('a');
  a.href = `${url}${url.includes('?') ? '&' : '?'}download=1`;
  a.download = name;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Start the server render, follow it, save the file. Resolves with the file name, or null on failure. */
export async function exportVideo(req: VideoExportRequest, io: VideoExportIO = {}): Promise<string | null> {
  const call = io.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const strip = progressStrip(`Exporting ${req.type.toUpperCase()}${req.scenes ? ' (all pages)' : ''}`);
  try {
    const started = await call('/__project_files/__export', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ design: req.design, type: req.type, scenes: req.scenes, scale: req.scale, fps: req.fps }),
    });
    const job = await started.json() as { job_id?: string; error?: string; hint?: string };
    if (!started.ok || !job.job_id) throw new Error([job.error, job.hint].filter(Boolean).join(' ') || `HTTP ${started.status}`);

    for (;;) {
      await wait(io.pollMs ?? 1500);
      const r = await call(`/__project_files/__export/status?job_id=${encodeURIComponent(job.job_id)}`, { credentials: 'include', cache: 'no-store' });
      const s = await r.json() as StatusReply;
      if (!r.ok || s.state === 'failed') throw new Error(s.error ?? `HTTP ${r.status}`);
      if (s.state !== 'done') { strip.set(progressText(s)); continue; }
      if (!s.download) throw new Error('the render finished but the file is outside the projects folder');
      const name = decodeURIComponent(s.download.split('/').pop() ?? `export.${req.type}`);
      saveFromServer(s.download, name);
      showToast(`Exported ${name}`, 'success');
      return name;
    }
  } catch (e) {
    showToast(`Video export failed: ${(e as Error).message}`, 'error');
    return null;
  } finally {
    strip.remove();
  }
}

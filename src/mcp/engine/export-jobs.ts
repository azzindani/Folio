/**
 * Background raster exports — a GIF or video render that outlives its request.
 *
 * Found live: an 870-frame mp4 took 8m13s on a loaded host. The client gave up
 * long before, with no job to ask about and no word that the file had landed,
 * and a retry started the same render again into the same .partial file. A
 * long render now runs here, detached from the request: the call returns a
 * job_id at once, animation(op:export_status) reports progress and then the
 * full receipt, and asking again for the same output joins the running job.
 * Jobs live in memory — a server restart ends them.
 */

import { randomBytes } from 'crypto';
import type { ToolResult } from '../types';
import { errResult, okResult } from './utils';

export type JobState = 'queued' | 'running' | 'done' | 'failed';

export interface ExportJob {
  job_id: string;
  design_path: string;
  output_path: string;
  type: string;
  frames_total: number;
  frames_done: number;
  state: JobState;
  queued_at: number;
  started_at?: number;
  finished_at?: number;
  result?: ToolResult;
}

/** Above this many frames an export runs as a job unless background:false — about 5s of 30fps video. */
export const BACKGROUND_FRAMES = 150;
const KEEP_FINISHED = 20;
const OP = 'export_status';

const jobs = new Map<string, ExportJob>();
/** One render at a time: two at once only halve each other's speed on a shared host. */
let tail: Promise<void> = Promise.resolve();

const live = (j: ExportJob): boolean => j.state === 'queued' || j.state === 'running';

function prune(): void {
  const finished = [...jobs.values()].filter(j => !live(j)).sort((a, b) => (a.finished_at ?? 0) - (b.finished_at ?? 0));
  for (const j of finished.slice(0, Math.max(0, finished.length - KEEP_FINISHED))) jobs.delete(j.job_id);
}

/** Start the render for an output file, or join the one already making it. */
export function startExportJob(
  meta: Pick<ExportJob, 'design_path' | 'output_path' | 'type' | 'frames_total'>,
  run: (onFrame: (done: number) => void) => Promise<ToolResult>,
): { job: ExportJob; joined: boolean } {
  const running = [...jobs.values()].find(j => live(j) && j.output_path === meta.output_path);
  if (running) return { job: running, joined: true };
  const job: ExportJob = { ...meta, job_id: `exp_${randomBytes(5).toString('hex')}`, frames_done: 0, state: 'queued', queued_at: Date.now() };
  jobs.set(job.job_id, job);
  tail = tail.then(async () => {
    job.state = 'running';
    job.started_at = Date.now();
    try {
      job.result = await run(done => { job.frames_done = done; });
    } catch (e) {
      job.result = errResult('export_animation', `Render failed: ${(e as Error).message}`, 'Run diagnose_design to find the bad layer, then export again.');
    }
    job.state = job.result.success ? 'done' : 'failed';
    job.finished_at = Date.now();
    prune();
  });
  return { job, joined: false };
}

/** animation(op:export_status) — where a background export has got to, then its receipt. */
export function exportStatus(args: { job_id?: unknown }): ToolResult {
  const id = typeof args.job_id === 'string' ? args.job_id : '';
  const job = jobs.get(id);
  if (!job) {
    return errResult(OP, id ? `No export job "${id}".` : 'job_id is required.',
      'Jobs live in server memory and end with a restart. Check whether the file is in exports/, or run animation(op:export) again.');
  }
  const now = Date.now();
  const base = { job_id: job.job_id, state: job.state, type: job.type, design_path: job.design_path, output_path: job.output_path };
  if (job.state === 'failed') {
    return { ...errResult(OP, `The export failed: ${String(job.result?.['error'] ?? 'unknown error')}`, String(job.result?.['hint'] ?? 'Export again.')), ...base };
  }
  if (job.state === 'done') {
    return okResult(OP, { ...base, elapsed_ms: (job.finished_at ?? now) - job.queued_at, receipt: job.result });
  }
  const spent = job.started_at ? now - job.started_at : 0;
  const perFrame = job.frames_done > 0 ? spent / job.frames_done : 0;
  const eta = perFrame > 0 ? Math.round(perFrame * (job.frames_total - job.frames_done)) : undefined;
  return okResult(OP, {
    ...base, frames_done: job.frames_done, frames_total: job.frames_total,
    percent: Math.round((job.frames_done / Math.max(1, job.frames_total)) * 100),
    ...(eta !== undefined ? { eta_ms: eta } : {}),
    next_action: { tool: 'animation', params: { op: 'export_status', job_id: job.job_id }, remaining: 1,
      hint: job.state === 'queued' ? 'Waiting for the render ahead of it to finish.' : `Ask again${eta ? ` in about ${Math.ceil(eta / 1000)}s` : ' shortly'} — the receipt comes back when it is done.` },
  });
}

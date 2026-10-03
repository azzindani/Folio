/**
 * PDF and PPTX exports as server jobs.
 *
 * A 26-page vector PDF built in the browser stops the moment the tab closes or a
 * phone locks. Here the editor server asks export_design for it and records the
 * result in the export ledger, so the same Exports tray that follows a video also
 * offers the PDF. export_design is one blocking call, so progress is just
 * "running"; the file lands in the project's exports/ folder.
 *
 * The call runs detached from the request. A server restart ends it, and the
 * ledger then marks it failed (see isRunningStill) rather than leaving it spinning.
 */

import * as path from 'path';
import { randomBytes } from 'crypto';
import { addEntry, patchEntry, type LedgerEntry } from './export-ledger';

type Rec = Record<string, unknown>;

export const STILL_TYPES = new Set(['pdf', 'pptx']);

const running = new Set<string>();

/** True while this server process is still rendering that job. */
export const isRunningStill = (jobId: string): boolean => running.has(jobId);
export const isStillJob = (jobId: string): boolean => jobId.startsWith('still_');

export interface StillDeps {
  projectsDir: string;
  call: (name: string, args: Rec) => Promise<Rec>;
  /** An absolute file inside the projects dir → the URL it downloads from. */
  url: (abs: string) => string | null;
}

/** Record the job and start the render; returns at once with the ledger entry. */
export function startStill(deps: StillDeps, rel: string, abs: string, type: string): LedgerEntry {
  const entry: LedgerEntry = {
    job_id: `still_${randomBytes(5).toString('hex')}`, design: rel, type, scenes: false, queued_at: Date.now(), state: 'running',
  };
  addEntry(deps.projectsDir, entry);
  running.add(entry.job_id);
  const name = path.basename(abs).replace(/\.design\.yaml$/, '');
  const output = path.join(path.dirname(path.dirname(abs)), 'exports', `${name}.${type}`);
  void deps.call('export_design', { design_path: abs, format: type, output_path: output, scale: 2, force: true })
    .then(r => {
      const out = typeof r['output_path'] === 'string' ? r['output_path'] : null;
      const download = r['success'] !== false && out ? deps.url(out) : null;
      const warning = r['status'] === 'partial' ? 'Some pages failed to render' : undefined;
      patchEntry(deps.projectsDir, entry.job_id, download
        ? { state: 'done', percent: 100, download, bytes: r['bytes'] as number | undefined, warning, finished_at: Date.now() }
        : { state: 'failed', error: String(r['error'] ?? 'The export produced no file'), finished_at: Date.now() });
    })
    .catch((e: unknown) => {
      patchEntry(deps.projectsDir, entry.job_id, { state: 'failed', error: (e as Error).message, finished_at: Date.now() });
    })
    .finally(() => { running.delete(entry.job_id); });
  return entry;
}

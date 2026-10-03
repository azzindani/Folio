/**
 * The export ledger — what the server remembers so a closed tab loses nothing.
 *
 * A video render runs on the server whether or not anyone watches, but the
 * editor tab used to be the only thing that knew the job id: close the tab, or
 * let the phone sleep, and the finished file sat in exports/ with nobody told.
 * The server now writes every export it starts into a small JSON file beside the
 * projects, keeps it current while jobs run, and lists it to any editor that
 * opens — so a tab (or a different device) finds "ready, download" waiting.
 *
 * The render-job registry itself lives in memory and ends with a restart; a
 * ledger entry that was still running then is marked failed, not left spinning.
 */

import * as fs from 'fs';
import * as path from 'path';

export type LedgerState = 'queued' | 'running' | 'done' | 'failed';

export interface LedgerEntry {
  job_id: string;
  /** The design as the editor opened it: <project>/designs/<name>.design.yaml. */
  design: string;
  type: string;
  scenes: boolean;
  queued_at: number;
  state: LedgerState;
  percent?: number;
  eta_ms?: number;
  /** URL the finished file downloads from, under /__project_files. */
  download?: string;
  bytes?: number;
  warning?: string;
  error?: string;
  finished_at?: number;
  /** Set once an editor has handed the file to the browser. */
  delivered?: boolean;
}

const KEEP = 30;
const FILE = '.export-ledger.json';

export const isLive = (e: LedgerEntry): boolean => e.state === 'queued' || e.state === 'running';

export function readLedger(projectsDir: string): LedgerEntry[] {
  try {
    const list = JSON.parse(fs.readFileSync(path.join(projectsDir, FILE), 'utf8')) as unknown;
    return Array.isArray(list) ? list.filter((e): e is LedgerEntry => typeof (e as LedgerEntry)?.job_id === 'string') : [];
  } catch { return []; }
}

/** Atomic: a crash mid-write must not leave half a file (and lose every pending download). */
export function writeLedger(projectsDir: string, entries: LedgerEntry[]): void {
  const file = path.join(projectsDir, FILE);
  const next = `${file}.new`;
  const fd = fs.openSync(next, 'w');
  try { fs.writeSync(fd, JSON.stringify(entries.slice(0, KEEP))); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(next, file);
}

/** Newest first, so the list a tab shows reads top-down. */
export function addEntry(projectsDir: string, entry: LedgerEntry): void {
  writeLedger(projectsDir, [entry, ...readLedger(projectsDir).filter(e => e.job_id !== entry.job_id)]);
}

export function patchEntry(projectsDir: string, jobId: string, patch: Partial<LedgerEntry>): LedgerEntry | null {
  const all = readLedger(projectsDir);
  const at = all.findIndex(e => e.job_id === jobId);
  if (at < 0) return null;
  const merged = { ...all[at]!, ...patch };
  all[at] = merged;
  writeLedger(projectsDir, all);
  return merged;
}

/**
 * The Exports tray — server renders you can walk away from.
 *
 * A video renders on the server whether or not the editor is open. This tray is
 * the editor's side of that: it asks the server's ledger what is running or
 * waiting (so a tab opened an hour later, or on another device, sees it too),
 * shows progress while the page is visible, and keeps a Download button on every
 * finished file until you take it. Nothing here owns the job — closing the tab
 * loses nothing, and a phone that slept resumes the moment the page returns.
 *
 * A file that finishes while this page is watching is also handed to the
 * browser straight away. A file found finished on return is NOT auto-saved:
 * phone browsers refuse downloads that no tap asked for, so it waits behind a
 * button instead of failing silently.
 */

import { showToast } from '../../utils/toast';
import { saveFromServer } from './save-from-server';

export interface TrayJob {
  job_id: string;
  design: string;
  type: string;
  scenes: boolean;
  state: 'queued' | 'running' | 'done' | 'failed';
  percent?: number;
  eta_ms?: number;
  download?: string;
  bytes?: number;
  warning?: string;
  error?: string;
  delivered?: boolean;
}

export interface TrayIO { fetch?: typeof fetch; pollMs?: number }

const live = (j: TrayJob): boolean => j.state === 'queued' || j.state === 'running';
const waiting = (j: TrayJob): boolean => !j.delivered && (live(j) || j.state === 'done' || j.state === 'failed');

/** A short name for a job: the design's file name plus what is being made. */
export function jobLabel(j: TrayJob): string {
  const name = (j.design.split('/').pop() ?? j.design).replace(/\.design\.yaml$/, '');
  return `${name} · ${j.type.toUpperCase()}${j.scenes ? ' (all pages)' : ''}`;
}

/** The line under the label: progress, ready, or why it failed. */
export function jobStatus(j: TrayJob): string {
  if (j.state === 'queued') return 'Waiting for the render ahead of it';
  if (j.state === 'running') {
    const eta = j.eta_ms ? ` · about ${Math.ceil(j.eta_ms / 1000)}s left` : '';
    return `Rendering ${j.percent ?? 0}%${eta}`;
  }
  if (j.state === 'failed') return j.error ?? 'The render failed';
  const mb = j.bytes ? ` · ${(j.bytes / 1048576).toFixed(1)} MB` : '';
  return `${j.warning ? `Ready, but: ${j.warning}` : 'Ready'}${mb}`;
}

let root: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let known = new Map<string, TrayJob>();
let io: TrayIO = {};
let bound = false;

const call = (input: string, init?: RequestInit): Promise<Response> =>
  (io.fetch ?? fetch)(input, { credentials: 'include', cache: 'no-store', ...init });

async function fetchJobs(): Promise<TrayJob[] | null> {
  try {
    const r = await call('/__project_files/__export/jobs');
    if (!r.ok) return null;
    return ((await r.json()) as { jobs?: TrayJob[] }).jobs ?? [];
  } catch { return null; }
}

async function acknowledge(jobId: string): Promise<void> {
  try {
    await call('/__project_files/__export/ack', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ job_id: jobId }),
    });
  } catch { /* offline: the button stays until the next refresh */ }
}

function take(j: TrayJob): void {
  if (!j.download) return;
  saveFromServer(j.download, decodeURIComponent(j.download.split('/').pop() ?? `export.${j.type}`));
  void acknowledge(j.job_id).then(() => refresh());
}

function ensureRoot(): HTMLElement {
  if (root && document.body.contains(root)) return root;
  root = document.createElement('div');
  root.className = 'export-tray';
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  // Touch devices keep their controls in a bottom dock the tray must not cover, so it sits under the header there.
  const touch = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const edge = touch ? 'top:calc(56px + env(safe-area-inset-top,0px))' : 'bottom:calc(12px + env(safe-area-inset-bottom,0px))';
  root.style.cssText = `position:fixed;left:12px;right:12px;${edge};margin-left:auto;max-width:420px;z-index:9500;display:flex;flex-direction:column;gap:8px;`;
  document.body.appendChild(root);
  return root;
}

const BTN = 'border-radius:6px;min-height:44px;min-width:44px;padding:0 16px;font:600 14px system-ui,sans-serif;cursor:pointer;border:1px solid #3A3A40;';

function card(j: TrayJob): HTMLElement {
  const el = document.createElement('div');
  el.className = 'export-tray-job';
  el.dataset['job'] = j.job_id;
  el.style.cssText = 'background:#141416;color:#EDEDED;border:1px solid #2A2A2E;border-radius:8px;padding:12px 14px;' +
    'font:13px system-ui,sans-serif;display:flex;align-items:center;gap:12px;';
  const text = document.createElement('div');
  text.style.cssText = 'flex:1;min-width:0;display:flex;flex-direction:column;gap:3px;';
  const label = document.createElement('strong');
  label.style.cssText = 'font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  label.textContent = jobLabel(j);
  const line = document.createElement('span');
  line.className = 'export-tray-status';
  line.style.cssText = `color:${j.state === 'failed' ? '#FF8A78' : '#9A9AA0'};`;
  line.textContent = jobStatus(j);
  text.append(label, line);
  if (live(j)) {
    const bar = document.createElement('div');
    bar.style.cssText = 'height:3px;background:#2A2A2E;border-radius:2px;margin-top:4px;';
    const fill = document.createElement('div');
    fill.style.cssText = `height:3px;border-radius:2px;background:#E5462D;width:${j.state === 'queued' ? 0 : j.percent ?? 0}%;`;
    bar.appendChild(fill);
    text.appendChild(bar);
  }
  el.appendChild(text);
  if (j.state === 'done' && j.download) {
    const get = document.createElement('button');
    get.className = 'export-tray-download';
    get.textContent = 'Download';
    get.style.cssText = `${BTN}background:#E5462D;color:#FFFFFF;border-color:#E5462D;`;
    get.addEventListener('click', () => take(j));
    el.appendChild(get);
  }
  if (!live(j)) {
    const x = document.createElement('button');
    x.className = 'export-tray-dismiss';
    x.setAttribute('aria-label', 'Dismiss');
    x.textContent = '×';
    x.style.cssText = `${BTN}background:#26262B;color:#F2F2F2;font-size:18px;padding:0;`;
    x.addEventListener('click', () => { void acknowledge(j.job_id).then(() => refresh()); });
    el.appendChild(x);
  }
  return el;
}

function draw(jobs: TrayJob[]): void {
  const shown = jobs.filter(waiting);
  if (shown.length === 0) { root?.remove(); root = null; return; }
  const host = ensureRoot();
  host.replaceChildren(...shown.map(card));
}

/** Pull the ledger, draw the tray, save what finished while this page was watching. */
export async function refresh(): Promise<void> {
  const jobs = await fetchJobs();
  if (!jobs) return;
  for (const j of jobs) {
    const before = known.get(j.job_id);
    if (before && live(before) && j.state === 'done' && !j.delivered) {
      take(j);
      showToast(j.warning ? `${jobLabel(j)}: ${j.warning}` : `Exported ${jobLabel(j)}`, j.warning ? 'warning' : 'success');
    }
  }
  known = new Map(jobs.map(j => [j.job_id, j]));
  draw(jobs);
  schedule(jobs.some(live));
}

function schedule(active: boolean): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (active && document.visibilityState !== 'hidden') timer = setTimeout(() => { void refresh(); }, io.pollMs ?? 2000);
}

/** Start following the ledger. Safe to call twice; wakes on return to the page. */
export function startExportTray(options: TrayIO = {}): void {
  io = options;
  if (!bound) {
    bound = true;
    const wake = (): void => { if (document.visibilityState !== 'hidden') void refresh(); };
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('pageshow', wake);
    window.addEventListener('online', wake);
  }
  void refresh();
}

/** Test seam: forget everything the module held. */
export function resetExportTray(): void {
  if (timer) clearTimeout(timer);
  timer = null; root?.remove(); root = null; known = new Map(); io = {};
}

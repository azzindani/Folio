import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import { refresh, startExportTray, resetExportTray, jobStatus, jobLabel, type TrayJob } from './export-tray';
import { showToast } from '../../utils/toast';

// The user closes the tab or the phone sleeps; the file must be waiting, one tap away, on return.

const job = (over: Partial<TrayJob>): TrayJob => ({ job_id: 'exp_1', design: 'p/designs/promo.design.yaml', type: 'mp4', scenes: true, state: 'running', ...over });

/** A server whose ledger the test rewrites between refreshes; records every ack. */
function ledger(initial: TrayJob[]): { fetch: typeof fetch; set(j: TrayJob[]): void; acks: string[] } {
  let jobs = initial;
  const acks: string[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/ack')) { acks.push(JSON.parse(String(init?.body)).job_id); jobs = jobs.map(j => (j.job_id === acks.at(-1) ? { ...j, delivered: true } : j)); return { ok: true, json: async () => ({ ok: true }) } as Response; }
    return { ok: true, json: async () => ({ jobs }) } as Response;
  }) as typeof fetch;
  return { fetch: f, set: next => { jobs = next; }, acks };
}

function recordClicks(): string[] {
  const seen: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { seen.push(this.getAttribute('href') ?? ''); });
  return seen;
}

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); resetExportTray(); document.body.innerHTML = ''; });

describe('export tray', () => {
  it('shows a render started before this page opened, with its progress', async () => {
    const io = ledger([job({ state: 'running', percent: 42, eta_ms: 9100 })]);
    startExportTray({ fetch: io.fetch, pollMs: 100000 });
    await vi.waitFor(() => expect(document.querySelector('.export-tray-status')?.textContent).toBe('Rendering 42% · about 10s left'));
    expect(document.querySelector('.export-tray-job strong')?.textContent).toBe('promo · MP4 (all pages)');
  });

  it('a file found finished on return waits behind a Download button and is not saved unasked', async () => {
    const clicks = recordClicks();
    const io = ledger([job({ state: 'done', download: '/__project_files/p/exports/promo.mp4', bytes: 2097152 })]);
    startExportTray({ fetch: io.fetch, pollMs: 100000 });
    await vi.waitFor(() => expect(document.querySelector('.export-tray-download')).not.toBeNull());
    expect(clicks).toHaveLength(0);
    expect(document.querySelector('.export-tray-status')?.textContent).toBe('Ready · 2.0 MB');
    (document.querySelector('.export-tray-download') as HTMLButtonElement).click();
    expect(clicks).toEqual(['/__project_files/p/exports/promo.mp4?download=1']);
    await vi.waitFor(() => expect(io.acks).toEqual(['exp_1']));
    await vi.waitFor(() => expect(document.querySelector('.export-tray')).toBeNull());
  });

  it('a file that finishes while the page is watching is saved at once', async () => {
    const clicks = recordClicks();
    const io = ledger([job({ state: 'running', percent: 90 })]);
    startExportTray({ fetch: io.fetch, pollMs: 100000 });
    await vi.waitFor(() => expect(document.querySelector('.export-tray-job')).not.toBeNull());
    io.set([job({ state: 'done', download: '/__project_files/p/exports/promo.mp4' })]);
    await refresh();
    expect(clicks).toEqual(['/__project_files/p/exports/promo.mp4?download=1']);
    expect(showToast).toHaveBeenCalledWith('Exported promo · MP4 (all pages)', 'success');
  });

  it('shows a failure with its reason and lets it be dismissed', async () => {
    const io = ledger([job({ state: 'failed', error: 'The server restarted before this render finished. Export it again.' })]);
    startExportTray({ fetch: io.fetch, pollMs: 100000 });
    await vi.waitFor(() => expect(document.querySelector('.export-tray-status')?.textContent).toContain('restarted'));
    (document.querySelector('.export-tray-dismiss') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(io.acks).toEqual(['exp_1']));
  });

  it('words each state, and draws nothing when there is nothing to collect', async () => {
    expect(jobStatus(job({ state: 'queued' }))).toBe('Waiting for the render ahead of it');
    expect(jobStatus(job({ state: 'done', warning: 'written WITHOUT its sound' }))).toBe('Ready, but: written WITHOUT its sound');
    expect(jobLabel(job({ scenes: false, type: 'gif' }))).toBe('promo · GIF');
    startExportTray({ fetch: ledger([job({ state: 'done', delivered: true })]).fetch, pollMs: 100000 });
    await new Promise(r => setTimeout(r, 20));
    expect(document.querySelector('.export-tray')).toBeNull();
  });
});

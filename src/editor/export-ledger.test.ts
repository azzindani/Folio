// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportRoute, type CallTool } from './server-export';
import { readLedger, addEntry } from './export-ledger';

// The user's ask: leave or close the tab, the export keeps going, and the file is
// waiting to download when they come back — above all on a phone.

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

const resolve = (rel: string): string | null => (rel.includes('..') ? null : path.join(dir, decodeURIComponent(rel)));
const deps = (callTool: CallTool): Parameters<typeof exportRoute>[2] => ({ projectsDir: dir, resolve, callTool });
const post = (p: string, body: unknown): [Request, URL] => {
  const url = new URL(`http://editor${p}`);
  return [new Request(url, { method: 'POST', body: JSON.stringify(body) }), url];
};
const get = (p: string): [Request, URL] => { const url = new URL(`http://editor${p}`); return [new Request(url), url]; };

const startJob = async (call: CallTool): Promise<void> => {
  await exportRoute(...post('/__project_files/__export', { design: 'p/designs/d.design.yaml', type: 'mp4', scenes: true }), deps(call));
};

describe('export ledger', () => {
  it('writes the job down when the render starts', async () => {
    await startJob(async () => ({ success: true, job_id: 'exp_1', state: 'queued', frames: 90 }));
    expect(readLedger(dir)).toMatchObject([{ job_id: 'exp_1', design: 'p/designs/d.design.yaml', type: 'mp4', scenes: true, state: 'queued' }]);
  });

  it('a tab that opens later is told the file is ready, with its download', async () => {
    await startJob(async () => ({ success: true, job_id: 'exp_1', state: 'queued' }));
    const done: CallTool = async () => ({ success: true, state: 'done', output_path: path.join(dir, 'p/exports/d.mp4'), receipt: { bytes: 4096 } });
    const res = await exportRoute(...get('/__project_files/__export/jobs'), deps(done));
    const { jobs } = await res!.json() as { jobs: Array<Record<string, unknown>> };
    expect(jobs[0]).toMatchObject({ job_id: 'exp_1', state: 'done', download: '/__project_files/p/exports/d.mp4', bytes: 4096 });
    expect(jobs[0]!['delivered']).toBeUndefined();
  });

  it('survives a restart: the file already on disk stays downloadable, a lost render is failed not spinning', async () => {
    await startJob(async () => ({ success: true, job_id: 'exp_1', state: 'running' }));
    const forgot: CallTool = async () => ({ success: false, error: 'No export job "exp_1".' });
    const { jobs } = await (await exportRoute(...get('/__project_files/__export/jobs'), deps(forgot)))!.json() as { jobs: Array<Record<string, unknown>> };
    expect(jobs[0]).toMatchObject({ state: 'failed' });
    expect(String(jobs[0]!['error'])).toContain('restarted');
  });

  it('does not ask the render server about jobs that already finished', async () => {
    await startJob(async () => ({ success: true, job_id: 'exp_1', state: 'queued' }));
    const done: CallTool = async () => ({ success: true, state: 'done', output_path: path.join(dir, 'p/exports/d.mp4'), receipt: {} });
    await exportRoute(...get('/__project_files/__export/jobs'), deps(done));
    const spy = vi.fn<CallTool>(async () => ({ success: true }));
    await exportRoute(...get('/__project_files/__export/jobs'), deps(spy));
    expect(spy).not.toHaveBeenCalled();
  });

  it('marks a file delivered once the browser has it, and 404s an unknown job', async () => {
    await startJob(async () => ({ success: true, job_id: 'exp_1', state: 'queued' }));
    const ok = await exportRoute(...post('/__project_files/__export/ack', { job_id: 'exp_1' }), deps(async () => ({})));
    expect(ok?.status).toBe(200);
    expect(readLedger(dir)[0]!.delivered).toBe(true);
    const miss = await exportRoute(...post('/__project_files/__export/ack', { job_id: 'nope' }), deps(async () => ({})));
    expect(miss?.status).toBe(404);
  });
});

describe('PDF as a server job', () => {
  const design = 'p/designs/d.design.yaml';
  const start = (call: CallTool): Promise<Response | null> => exportRoute(...post('/__project_files/__export', { design, type: 'pdf' }), deps(call));

  it('runs export_design detached, into the project exports folder, and records the file', async () => {
    const call = vi.fn<CallTool>(async () => ({ success: true, output_path: path.join(dir, 'p/exports/d.pdf'), bytes: 9000, status: 'ok' }));
    const res = await start(call);
    expect(res?.status).toBe(202);
    const { job_id } = await res!.json() as { job_id: string };
    expect(job_id).toMatch(/^still_/);
    await vi.waitFor(() => expect(readLedger(dir)[0]).toMatchObject({ state: 'done', download: '/__project_files/p/exports/d.pdf', bytes: 9000 }));
    expect(call).toHaveBeenCalledWith('export_design', expect.objectContaining({ format: 'pdf', output_path: path.join(dir, 'p/exports/d.pdf') }));
  });

  it('records a failure with its reason, and flags a partial PDF', async () => {
    await start(async () => ({ success: false, error: 'font could not be embedded' }));
    await vi.waitFor(() => expect(readLedger(dir)[0]).toMatchObject({ state: 'failed', error: 'font could not be embedded' }));
    await start(async () => ({ success: true, output_path: path.join(dir, 'p/exports/d.pdf'), status: 'partial' }));
    await vi.waitFor(() => expect(readLedger(dir)[0]).toMatchObject({ state: 'done', warning: 'Some pages failed to render' }));
  });

  it('a PDF the server restarted under is failed, not left rendering', async () => {
    addEntry(dir, { job_id: 'still_dead', design, type: 'pdf', scenes: false, queued_at: 1, state: 'running' });
    const { jobs } = await (await exportRoute(...get('/__project_files/__export/jobs'), deps(async () => ({ success: true }))))!.json() as { jobs: Array<Record<string, unknown>> };
    expect(jobs.find(j => j['job_id'] === 'still_dead')).toMatchObject({ state: 'failed' });
  });
});

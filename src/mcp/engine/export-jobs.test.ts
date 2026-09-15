import { describe, it, expect } from 'vitest';
import { startExportJob, exportStatus } from './export-jobs';
import { okResult, errResult } from './utils';

const flush = async (times = 3): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise<void>(r => { setImmediate(r); });
};
function gate(): { promise: Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const promise = new Promise<void>(r => { open = r; });
  return { promise, open };
}
const meta = (output_path: string): { design_path: string; output_path: string; type: string; frames_total: number } =>
  ({ design_path: '/p/designs/d.design.yaml', output_path, type: 'mp4', frames_total: 10 });

describe('background export jobs', () => {
  it('reports progress while it renders, then hands back the receipt', async () => {
    const g = gate();
    const { job, joined } = startExportJob(meta('/out/a.mp4'), async onFrame => {
      onFrame(4);
      await g.promise;
      return okResult('export_animation', { output_path: '/out/a.mp4', bytes: 99 });
    });
    expect(joined).toBe(false);
    await flush();
    const mid = exportStatus({ job_id: job.job_id });
    expect(mid).toMatchObject({ success: true, state: 'running', frames_done: 4, frames_total: 10, percent: 40 });
    expect((mid['next_action'] as { params: unknown }).params).toEqual({ op: 'export_status', job_id: job.job_id });
    g.open();
    await flush();
    const done = exportStatus({ job_id: job.job_id });
    expect(done).toMatchObject({ success: true, state: 'done', output_path: '/out/a.mp4' });
    expect((done['receipt'] as Record<string, unknown>)['bytes']).toBe(99);
  });

  it('joins the render already making the same file, and queues a different file behind it', async () => {
    const g = gate();
    let otherStarted = false;
    const first = startExportJob(meta('/out/b.mp4'), async () => { await g.promise; return okResult('export_animation', {}); });
    const again = startExportJob(meta('/out/b.mp4'), async () => okResult('export_animation', {}));
    expect(again).toMatchObject({ joined: true, job: { job_id: first.job.job_id } });
    const other = startExportJob(meta('/out/c.gif'), async () => { otherStarted = true; return okResult('export_animation', {}); });
    await flush();
    expect(exportStatus({ job_id: other.job.job_id })['state']).toBe('queued');
    expect(otherStarted).toBe(false);
    g.open();
    await flush(6);
    expect(otherStarted).toBe(true);
    expect(exportStatus({ job_id: other.job.job_id })['state']).toBe('done');
  });

  it('a refused or crashed render reports failed with its reason', async () => {
    const refused = startExportJob(meta('/out/d.mp4'), async () => errResult('export_animation', 'ffmpeg exploded', 'check the encoder'));
    const crashed = startExportJob(meta('/out/e.mp4'), async () => { throw new Error('resvg gave up'); });
    await flush(6);
    expect(exportStatus({ job_id: refused.job.job_id })).toMatchObject({ success: false, state: 'failed', hint: 'check the encoder' });
    expect(String(exportStatus({ job_id: crashed.job.job_id })['error'])).toContain('resvg gave up');
  });

  it('an unknown job says why it may be gone', () => {
    const r = exportStatus({ job_id: 'exp_nope' });
    expect(r.success).toBe(false);
    expect(String(r['hint'])).toContain('restart');
  });
});

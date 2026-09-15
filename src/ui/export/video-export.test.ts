import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../export/exporter', () => ({ downloadBlob: vi.fn() }));
vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import { exportVideo, progressText } from './video-export';
import { downloadBlob } from '../../export/exporter';
import { showToast } from '../../utils/toast';

type Reply = { status: number; body?: unknown };
const response = ({ status, body }: Reply): Response => ({
  ok: status >= 200 && status < 300, status,
  json: async () => body, blob: async () => new Blob(['mp4']),
} as unknown as Response);

/** A fetch that answers each call with the next scripted reply and remembers what it was asked. */
function scripted(replies: Reply[]): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response(replies.shift() ?? { status: 500, body: { error: 'unexpected call' } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

beforeEach(() => { vi.clearAllMocks(); document.body.innerHTML = ''; });

describe('exportVideo — the editor side of a server render', () => {
  it('follows the job to the file and saves it under its own name', async () => {
    const io = scripted([
      { status: 202, body: { job_id: 'exp_1', state: 'queued', frames: 957 } },
      { status: 200, body: { state: 'running', percent: 40 } },
      { status: 200, body: { state: 'done', percent: 100, download: '/__project_files/p/exports/folio-%E2%80%94-product-promo.mp4' } },
      { status: 200 },
    ]);
    const name = await exportVideo({ design: 'p/designs/promo.design.yaml', type: 'mp4', scenes: true }, { fetch: io.fetch, pollMs: 0 });
    expect(name).toBe('folio-—-product-promo.mp4');
    expect(JSON.parse(String(io.calls[0].init?.body))).toEqual({ design: 'p/designs/promo.design.yaml', type: 'mp4', scenes: true });
    expect(io.calls[1].url).toBe('/__project_files/__export/status?job_id=exp_1');
    expect(io.calls[3].url).toBe('/__project_files/p/exports/folio-%E2%80%94-product-promo.mp4');
    expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'folio-—-product-promo.mp4');
    expect(document.querySelector('.video-export-progress')).toBeNull();
  });

  it('says why a refused export failed and saves nothing', async () => {
    const io = scripted([{ status: 422, body: { error: 'scenes:true plays pages in order, and this design has none.', hint: 'Add pages.' } }]);
    expect(await exportVideo({ design: 'p/d.design.yaml', type: 'gif', scenes: true }, { fetch: io.fetch, pollMs: 0 })).toBeNull();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('this design has none'), 'error');
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(document.querySelector('.video-export-progress')).toBeNull();
  });

  it('stops when the render fails part way', async () => {
    const io = scripted([
      { status: 202, body: { job_id: 'exp_2' } },
      { status: 409, body: { state: 'failed', error: 'Render failed: out of memory' } },
    ]);
    expect(await exportVideo({ design: 'p/d.design.yaml', type: 'mp4', scenes: false }, { fetch: io.fetch, pollMs: 0 })).toBeNull();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('out of memory'), 'error');
  });

  it('tells a queued job from a running one', () => {
    expect(progressText({ state: 'queued' })).toBe('waiting for the render ahead of it');
    expect(progressText({ state: 'running', percent: 42, eta_ms: 9100 })).toBe('rendering 42% · about 10s left');
  });
});

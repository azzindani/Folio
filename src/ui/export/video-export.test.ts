import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import { exportVideo, progressText, saveFromServer } from './video-export';
import { showToast } from '../../utils/toast';

type Reply = { status: number; body?: unknown };
const response = ({ status, body }: Reply): Response => ({ ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response);

/** A fetch that answers each call with the next scripted reply and remembers what it was asked. */
function scripted(replies: Reply[]): { fetch: typeof fetch; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response(replies.shift() ?? { status: 500, body: { error: 'unexpected call' } });
  }) as typeof fetch;
  return { fetch: f, calls };
}

/** Every link the page clicks — recorded, never navigated (jsdom has no downloads). */
function recordClicks(): Array<{ href: string; download: string; attached: boolean }> {
  const seen: Array<{ href: string; download: string; attached: boolean }> = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    seen.push({ href: this.getAttribute('href') ?? '', download: this.download, attached: this.isConnected });
  });
  return seen;
}

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); document.body.innerHTML = ''; });

describe('exportVideo — the editor side of a server render', () => {
  // Found live: a 4.8 MB GIF rendered fine on the server and "failed to save" in the browser,
  // when the file was pulled into a Blob and its object URL revoked straight after the click.
  it('hands the finished file to the browser as a download link, never pulling it into the page', async () => {
    const clicks = recordClicks();
    const file = '/__project_files/p/exports/folio-%E2%80%94-product-promo-960x540-20fps.gif';
    const io = scripted([
      { status: 202, body: { job_id: 'exp_1', state: 'queued', frames: 638 } },
      { status: 200, body: { state: 'running', percent: 40 } },
      { status: 200, body: { state: 'done', percent: 100, download: file } },
    ]);
    const name = await exportVideo({ design: 'p/designs/promo.design.yaml', type: 'gif', scenes: true, scale: 0.5, fps: 20 }, { fetch: io.fetch, pollMs: 0 });
    expect(name).toBe('folio-—-product-promo-960x540-20fps.gif');
    expect(JSON.parse(String(io.calls[0].init?.body))).toEqual({ design: 'p/designs/promo.design.yaml', type: 'gif', scenes: true, scale: 0.5, fps: 20 });
    expect(io.calls.map(c => c.url)).not.toContain(file);
    expect(clicks).toEqual([{ href: `${file}?download=1`, download: 'folio-—-product-promo-960x540-20fps.gif', attached: true }]);
    expect(document.querySelector('a, .video-export-progress')).toBeNull();
  });

  it('says why a refused export failed and saves nothing', async () => {
    const clicks = recordClicks();
    const io = scripted([{ status: 422, body: { error: 'scenes:true plays pages in order, and this design has none.', hint: 'Add pages.' } }]);
    expect(await exportVideo({ design: 'p/d.design.yaml', type: 'gif', scenes: true }, { fetch: io.fetch, pollMs: 0 })).toBeNull();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('this design has none'), 'error');
    expect(clicks).toHaveLength(0);
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

  it('saves a file written with a warning, and shows the warning instead of "Exported"', async () => {
    const clicks = recordClicks();
    const io = scripted([
      { status: 202, body: { job_id: 'exp_3' } },
      { status: 200, body: { state: 'done', download: '/__project_files/p/exports/d.mp4', warning: 'The video was written WITHOUT its sound' } },
    ]);
    expect(await exportVideo({ design: 'p/d.design.yaml', type: 'mp4', scenes: true }, { fetch: io.fetch, pollMs: 0 })).toBe('d.mp4');
    expect(clicks).toHaveLength(1);
    expect(showToast).toHaveBeenCalledWith('d.mp4: The video was written WITHOUT its sound', 'warning');
    expect(showToast).not.toHaveBeenCalledWith(expect.stringContaining('Exported'), 'success');
  });

  it('tells a queued job from a running one, and keeps a query string on the link', () => {
    expect(progressText({ state: 'queued' })).toBe('waiting for the render ahead of it');
    expect(progressText({ state: 'running', percent: 42, eta_ms: 9100 })).toBe('rendering 42% · about 10s left');
    const clicks = recordClicks();
    saveFromServer('/__project_files/p/exports/x.mp4?v=2', 'x.mp4');
    expect(clicks[0]?.href).toBe('/__project_files/p/exports/x.mp4?v=2&download=1');
  });
});

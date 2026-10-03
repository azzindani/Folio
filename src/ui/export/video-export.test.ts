import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../utils/toast', () => ({ showToast: vi.fn() }));

import { exportVideo, saveFromServer } from './video-export';
import { resetExportTray } from './export-tray';
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

beforeEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); resetExportTray(); document.body.innerHTML = ''; });

describe('exportVideo — the editor side of a server render', () => {
  // The user's ask: leave or close the tab and the export must not stop. So starting is all this
  // page does; the server owns the render and the tray (export-tray.ts) follows the ledger.
  it('starts the render, tells the user they can leave, and does not wait for the file', async () => {
    const clicks = recordClicks();
    const io = scripted([
      { status: 202, body: { job_id: 'exp_1', state: 'queued', frames: 638 } },
      { status: 200, body: { jobs: [] } },
    ]);
    const id = await exportVideo({ design: 'p/designs/promo.design.yaml', type: 'gif', scenes: true, scale: 0.5, fps: 20 }, { fetch: io.fetch, pollMs: 0 });
    expect(id).toBe('exp_1');
    expect(JSON.parse(String(io.calls[0].init?.body))).toEqual({ design: 'p/designs/promo.design.yaml', type: 'gif', scenes: true, scale: 0.5, fps: 20 });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('close this tab'), 'info');
    expect(clicks).toHaveLength(0);
  });

  it('says why a refused export failed and starts no tray', async () => {
    const io = scripted([{ status: 422, body: { error: 'scenes:true plays pages in order, and this design has none.', hint: 'Add pages.' } }]);
    expect(await exportVideo({ design: 'p/d.design.yaml', type: 'gif', scenes: true }, { fetch: io.fetch, pollMs: 0 })).toBeNull();
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('this design has none'), 'error');
    expect(io.calls).toHaveLength(1);
  });

  it('keeps a query string on the download link', () => {
    const clicks = recordClicks();
    saveFromServer('/__project_files/p/exports/x.mp4?v=2', 'x.mp4');
    expect(clicks[0]?.href).toBe('/__project_files/p/exports/x.mp4?v=2&download=1');
  });
});

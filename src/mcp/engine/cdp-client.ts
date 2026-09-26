/**
 * A minimal Chrome DevTools Protocol client over the runtime's own WebSocket
 * (phase 3, S7) — what script-capture.ts drives headless Chromium with.
 *
 * Playwright was tried first. Its pipe transport sometimes never read a reply
 * inside the busy server (an export hung at a chunk boundary, 2 runs in 4),
 * and its WebSocket client cannot complete the handshake under Bun. The few
 * calls a capture needs — open a page, size it, set its document, evaluate,
 * screenshot — are a dozen lines of protocol; every call answers or fails.
 */

interface Pending { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }

export class Cdp {
  private next = 0;
  private waiting = new Map<number, Pending>();
  private closed = '';

  private constructor(private ws: WebSocket, private stepMs: number) {
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message?: string } };
      const p = msg.id === undefined ? undefined : this.waiting.get(msg.id);
      if (!p || msg.id === undefined) return;
      this.waiting.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(msg.error.message ?? 'CDP error'));
      else p.resolve(msg.result);
    });
    ws.addEventListener('close', () => {
      this.closed = 'the browser connection closed';
      for (const p of this.waiting.values()) { clearTimeout(p.timer); p.reject(new Error(this.closed)); }
      this.waiting.clear();
    });
  }

  /** Connect to a browser's DevTools WebSocket. */
  static connect(url: string, stepMs: number): Promise<Cdp> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const timer = setTimeout(() => { try { ws.close(); } catch { /* never opened */ } reject(new Error('the DevTools connection did not open')); }, stepMs);
      ws.addEventListener('open', () => { clearTimeout(timer); resolve(new Cdp(ws, stepMs)); });
      ws.addEventListener('error', () => { clearTimeout(timer); reject(new Error('the DevTools connection failed')); });
    });
  }

  /** One protocol call; `what` names it when it does not answer in time. */
  send<T>(method: string, params: Record<string, unknown> = {}, sessionId?: string, what = method): Promise<T> {
    if (this.closed) return Promise.reject(new Error(this.closed));
    const id = ++this.next;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiting.delete(id);
        reject(new Error(`script capture: ${what} did not answer in ${this.stepMs / 1000} s`));
      }, this.stepMs);
      this.waiting.set(id, { resolve: v => resolve(v as T), reject, timer });
      this.ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void { try { this.ws.close(); } catch { /* already closed */ } }
}

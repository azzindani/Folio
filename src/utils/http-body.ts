// Bounded HTTP request-body reader.
//
// The Folio servers run inside a memory-capped container (1 GiB by default).
// A naive body reader that buffers every chunk lets a single large POST grow
// the heap without limit — enough to trip the OOM killer. readBodyCapped
// aborts the moment the accumulated size crosses `limit`, so the worst case is
// bounded by the cap rather than by what the client chooses to send.
import type { IncomingMessage } from 'http';

/** Rejected by readBodyCapped when the request body exceeds the byte cap. */
export class PayloadTooLargeError extends Error {
  constructor(public readonly limit: number) {
    super(`Request body exceeds ${limit} bytes`);
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Read an HTTP request body into a UTF-8 string, aborting with
 * PayloadTooLargeError once more than `limit` bytes have arrived. After the
 * abort, further chunks are dropped (not retained), so peak heap is bounded by
 * `limit` regardless of how much the client sends. The socket is left intact
 * so the caller can still send a clean 413 response.
 */
export function readBodyCapped(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (c: Buffer) => {
      if (aborted) return; // over the cap — drop, don't accumulate
      size += c.length;
      if (size > limit) {
        aborted = true;
        reject(new PayloadTooLargeError(limit));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!aborted) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', (e) => { if (!aborted) reject(e); });
  });
}

/**
 * The resvg child process: rasterises the SVGs framed on stdin, one at a time,
 * and answers each on stdout. It exists so that a native abort inside resvg ends
 * THIS process and not the server — see resvg-isolate.ts for the protocol and why.
 *
 *   request  = u32le length + JSON {svg, opts, want}
 *   reply    = u32le length + JSON {ok, width, height, error?, png, pixels} + png bytes + pixel bytes
 */

import { Resvg, type ResvgRenderOptions } from '@resvg/resvg-js';

type Want = 'png' | 'pixels' | 'both';

const EMPTY = Buffer.alloc(0);
let pending: Buffer = EMPTY;
let queue: Promise<void> = Promise.resolve();

/** A reply is written before the next render starts, so a crash never loses an answer already given. */
function send(header: Record<string, unknown>, png: Buffer, pixels: Buffer): Promise<void> {
  const head = Buffer.from(JSON.stringify({ ...header, png: png.length, pixels: pixels.length }));
  const len = Buffer.alloc(4);
  len.writeUInt32LE(head.length, 0);
  return new Promise(resolve => { process.stdout.write(Buffer.concat([len, head, png, pixels]), () => resolve()); });
}

async function handle(body: Buffer): Promise<void> {
  try {
    const req = JSON.parse(body.toString('utf8')) as { svg: string; opts?: ResvgRenderOptions; want?: Want };
    const img = new Resvg(req.svg, req.opts ?? {}).render();
    const png = req.want === 'pixels' ? EMPTY : Buffer.from(img.asPng());
    const pixels = req.want === 'pixels' || req.want === 'both' ? Buffer.from(img.pixels) : EMPTY;
    await send({ ok: true, width: img.width, height: img.height }, png, pixels);
  } catch (e) {
    await send({ ok: false, error: (e as Error).message }, EMPTY, EMPTY);
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
  while (pending.length >= 4) {
    const n = pending.readUInt32LE(0);
    if (pending.length < 4 + n) break;
    const body = Buffer.from(pending.subarray(4, 4 + n));
    pending = pending.subarray(4 + n);
    queue = queue.then(() => handle(body));
  }
});

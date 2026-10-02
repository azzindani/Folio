// Footage and sound served the way a <video> element asks for them: in byte
// ranges. The file route read the whole file per request, with no Range support,
// so seeking a clip re-fetched it and a 200 MB clip was a 200 MB buffer. A range
// is answered with at most CHUNK bytes; the element asks for the next one.

import * as fs from 'fs';

/** Most bytes one range reply carries — the element asks again for the rest. */
const CHUNK = 8 * 1024 * 1024;

export function isRangedMedia(mime: string): boolean {
  return mime.startsWith('video/') || mime.startsWith('audio/');
}

/** The byte span a Range header asks of a file `size` long, capped at CHUNK; null when unsatisfiable or absent. */
export function rangeOf(header: string | null, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (!m[1] && !m[2])) return null;
  let start: number, end: number;
  if (!m[1]) { start = Math.max(0, size - Number(m[2])); end = size - 1; } else { start = Number(m[1]); end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
  if (start >= size || end < start) return null;
  return { start, end: Math.min(end, start + CHUNK - 1) };
}

/** A media file answered whole or in the range asked for (206), with Accept-Ranges either way. */
export function mediaResponse(file: string, rangeHeader: string | null, headers: Record<string, string>): Response {
  const size = fs.statSync(file).size;
  const all = { ...headers, 'Accept-Ranges': 'bytes' };
  if (rangeHeader === null) return new Response(fs.readFileSync(file), { status: 200, headers: { ...all, 'Content-Length': String(size) } });
  const r = rangeOf(rangeHeader, size);
  if (!r) return new Response(null, { status: 416, headers: { ...all, 'Content-Range': `bytes */${size}` } });
  const len = r.end - r.start + 1;
  const buf = Buffer.allocUnsafe(len);
  const fd = fs.openSync(file, 'r');
  try { fs.readSync(fd, buf, 0, len, r.start); } finally { fs.closeSync(fd); }
  return new Response(buf, { status: 206, headers: { ...all, 'Content-Range': `bytes ${r.start}-${r.end}/${size}`, 'Content-Length': String(len) } });
}

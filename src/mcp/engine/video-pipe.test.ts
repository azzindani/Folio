import { describe, it, expect } from 'vitest';
import { FramePipe } from './video-pipe';

// FramePipe appends `-y <output>`; a shell stands in for ffmpeg and writes to $2.
const writer = (script: string): FramePipe => new FramePipe('sh', ['-c', script, 'sh'], () => undefined);

describe.skipIf(process.platform === 'win32')('FramePipe', () => {
  it('reads exact byte counts across writes, then a short tail, then null', async () => {
    const p = writer('head -c 1000 /dev/zero > "$2"');
    try {
      expect((await p.read(300))?.length).toBe(300);
      expect((await p.read(300))?.length).toBe(300);
      expect((await p.read(300))?.length).toBe(300);
      expect((await p.read(300))?.length).toBe(100);
      expect(await p.read(300)).toBeNull();
      expect(await p.exited).toBe(0);
    } finally { p.close(); }
  });

  it('lets go of its stderr listener once the writer exits — Bun 1.1.38 keeps that stream reachable', async () => {
    const p = writer('echo hi >&2; head -c 10 /dev/zero > "$2"');
    try {
      while (await p.read(4)) { /* drain */ }
      await p.exited;
      expect(p.proc.stderr?.listenerCount('data')).toBe(0);
    } finally { p.close(); }
  });

  it('a writer that dies before opening its output reads as the end, not a hang', async () => {
    const p = writer('exit 3');
    try {
      expect(await p.readSome(64)).toBeNull();
      expect(await p.exited).toBe(3);
    } finally { p.close(); }
  }, 10_000);

  it('a reader that stops reading leaves the writer blocked, not buffered into memory', async () => {
    const p = writer('head -c 400000000 /dev/zero > "$2"; echo done >&2');
    try {
      await p.read(1000);
      const before = process.memoryUsage().rss;
      await new Promise(r => setTimeout(r, 500));
      expect(process.memoryUsage().rss - before).toBeLessThan(50_000_000);
      expect(p.proc.exitCode).toBeNull();
    } finally { p.close(); }
  });
});

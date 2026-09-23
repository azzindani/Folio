import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type * as http from 'http';
import { openEventStream, targetDesign, mtimeOf } from './editor-stream';

const fakeRes = (): { res: http.ServerResponse; writes: string[] } => {
  const writes: string[] = [];
  const res = { writableEnded: false, writeHead: vi.fn(), write: (c: string) => { writes.push(c); return true; } };
  return { res: res as unknown as http.ServerResponse, writes };
};

afterEach(() => { vi.useRealTimers(); });

describe('openEventStream', () => {
  // Live: the runtime held the lone "connected" write — and the headers — until
  // a second write, so the editor's EventSource never opened.
  it('follows the opening with a second write on the next tick, then a heartbeat', () => {
    vi.useFakeTimers();
    const req = new EventEmitter() as unknown as http.IncomingMessage;
    const { res, writes } = fakeRes();
    openEventStream(req, res, 'event: connected\ndata: {}\n\n', 1000);
    expect(writes).toEqual(['event: connected\ndata: {}\n\n']);
    vi.advanceTimersByTime(0);
    expect(writes[1]).toBe(': open\n\n');
    vi.advanceTimersByTime(2000);
    expect(writes.filter(w => w === ': ping\n\n')).toHaveLength(2);
    (req as unknown as EventEmitter).emit('close');
    vi.advanceTimersByTime(5000);
    expect(writes.filter(w => w === ': ping\n\n')).toHaveLength(2);
  });
});

describe('targetDesign + mtimeOf', () => {
  it('resolves the design a call targets the way the engine does', () => {
    const want = path.resolve('/p/x/designs/a.design.yaml');   // a drive letter on Windows
    expect(targetDesign({ design_path: '/p/x/designs/a.design.yaml' })).toBe(want);
    expect(targetDesign({ design_path: 'designs/a.design.yaml', project_path: '/p/x' })).toBe(want);
    expect(targetDesign({ project_path: '/p/x' })).toBeNull();
    expect(targetDesign({ design_path: '/p/x/exports/a.png' })).toBeNull();
  });

  it('reads a file\'s mtime, and null for a missing one', () => {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'es-')), 'a.design.yaml');
    expect(mtimeOf(f)).toBeNull();
    expect(mtimeOf(null)).toBeNull();
    fs.writeFileSync(f, 'x');
    expect(typeof mtimeOf(f)).toBe('number');
  });
});

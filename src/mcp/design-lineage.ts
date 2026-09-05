// Folio MCP — append-only lineage.
//
// The review's finding, verbatim: a receipt held 2 entries after ~20 calls on
// the same file, so "the agent cannot trust receipt as an audit log today". The
// damage is not the missing rows — it is that nothing SAID they were missing.
// A log that silently covers some operations is worse than no log, because it
// is believed.
//
// So coverage here is STRUCTURAL, not per-call-site. Every design write goes
// through writeYAML; writeYAML records. No tool can forget to log, because no
// tool does the logging. The scope is therefore exactly "every write to a
// .design.yaml", which is a sentence the read op can state and defend, rather
// than a list of ops someone has to keep up to date.
//
// One record per (tool call, design): a call that writes the same file twice
// still describes ONE change, so the first before-hash and the last after-hash
// are what get recorded. Hashes make it checkable — an entry whose `before`
// does not match the previous entry's `after` means something edited the file
// outside the tool surface, and that is worth being able to prove.
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

/** One entry in a design's history. Append-only; never rewritten. */
export interface LineageRecord {
  /** 1-based position in this design's history. */
  seq: number;
  ts: string;
  /** Tool that made the change. */
  op: string;
  /** sha256 of the canonical arguments — identical calls hash identically. */
  args_hash: string;
  /** Small, readable digest of the arguments (big values are described, not stored). */
  args: Record<string, unknown>;
  /** State before the change; absent when the design was created by this op. */
  before?: { hash: string; bytes: number };
  after: { hash: string; bytes: number };
  /** Wall-clock duration of the whole tool call. */
  ms: number;
  /** How many times this call wrote the file (>1 means passes ran after the first write). */
  writes: number;
}

interface PendingWrite {
  beforeHash?: string;
  beforeBytes?: number;
  afterHash: string;
  afterBytes: number;
  writes: number;
}

interface OpScope {
  op: string;
  args: Record<string, unknown>;
  started: number;
  pending: Map<string, PendingWrite>;
}

// AsyncLocalStorage, not a module-level variable: the HTTP server can have two
// tool calls in flight (the asset ops await the network), and a shared "current
// op" would attribute one call's writes to the other.
const store = new AsyncLocalStorage<OpScope>();

const sha = (s: string): string => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Stable JSON — key order must not change a hash. */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(',')}}`;
}

/** A digest small enough to store on every call: scalars kept, bulk described.
 *  Storing `layers_shorthand` in full would make the log bigger than the design. */
function digestArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined) continue;
    if (v === null || typeof v === 'boolean' || typeof v === 'number') { out[k] = v; continue; }
    if (typeof v === 'string') { out[k] = v.length <= 120 ? v : `${v.slice(0, 117)}…`; continue; }
    if (Array.isArray(v)) { out[k] = `<array:${v.length}>`; continue; }
    out[k] = `<object:${Object.keys(v as Record<string, unknown>).length} keys>`;
  }
  return out;
}

/** Where a design's history lives — beside its snapshots, same lifecycle. */
export function lineagePath(designPath: string): string {
  const dir = path.join(path.dirname(designPath), '.mcp_versions');
  return path.join(dir, `${path.basename(designPath, '.yaml')}.lineage.jsonl`);
}

// ── Recording ───────────────────────────────────────────────

/** Run a tool call inside a lineage scope. Writes made during it are attributed
 *  to this op and flushed when it finishes — including when it throws, because
 *  a failed call that still wrote is exactly what an audit log is for. */
export function withOpScope<T>(op: string, args: Record<string, unknown>, fn: () => T): T {
  const scope: OpScope = { op, args, started: Date.now(), pending: new Map() };
  const done = (): void => { try { flush(scope); } catch { /* logging must never break a tool */ } };
  return store.run(scope, () => {
    let result: T;
    try {
      result = fn();
    } catch (err) {
      done();
      throw err;
    }
    // Async tools return a promise; flush when it settles, not when it starts.
    if (result && typeof (result as unknown as { then?: unknown }).then === 'function') {
      return (result as unknown as Promise<unknown>).then(
        v => { done(); return v; },
        e => { done(); throw e; },
      ) as unknown as T;
    }
    done();
    return result;
  });
}

/** Called by writeYAML for every design write. Cheap and never throws. */
export function noteDesignWrite(filePath: string, nextContent: string): void {
  const scope = store.getStore();
  if (!scope) return;                               // a write outside a tool call
  if (!filePath.endsWith('.design.yaml')) return;   // designs only — the thing with a history
  try {
    const existing = scope.pending.get(filePath);
    const afterHash = sha(nextContent);
    const afterBytes = Buffer.byteLength(nextContent);
    if (existing) {
      // Same call writing again: keep the ORIGINAL before, take the LATEST after.
      existing.afterHash = afterHash;
      existing.afterBytes = afterBytes;
      existing.writes++;
      return;
    }
    let beforeHash: string | undefined;
    let beforeBytes: number | undefined;
    try {
      const prev = fs.readFileSync(filePath, 'utf-8');
      beforeHash = sha(prev);
      beforeBytes = Buffer.byteLength(prev);
    } catch { /* the file is being created by this op — no before-state */ }
    scope.pending.set(filePath, { beforeHash, beforeBytes, afterHash, afterBytes, writes: 1 });
  } catch { /* never let the log break the write it is describing */ }
}

/** Append one record per touched design. */
function flush(scope: OpScope): void {
  if (scope.pending.size === 0) return;
  const ms = Date.now() - scope.started;
  const argsHash = sha(canonical(scope.args));
  const args = digestArgs(scope.args);
  for (const [designPath, w] of scope.pending) {
    // A write that changed nothing is not history.
    if (w.beforeHash && w.beforeHash === w.afterHash) continue;
    const lPath = lineagePath(designPath);
    let seq = 1;
    try {
      seq = countLines(lPath) + 1;
      fs.mkdirSync(path.dirname(lPath), { recursive: true });
      const rec: LineageRecord = {
        seq, ts: new Date().toISOString(), op: scope.op, args_hash: argsHash, args,
        ...(w.beforeHash ? { before: { hash: w.beforeHash, bytes: w.beforeBytes ?? 0 } } : {}),
        after: { hash: w.afterHash, bytes: w.afterBytes },
        ms, writes: w.writes,
      };
      fs.appendFileSync(lPath, `${JSON.stringify(rec)}\n`, 'utf-8');
    } catch { /* a full disk must not fail the design write */ }
  }
}

function countLines(p: string): number {
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    return raw.split('\n').filter(l => l.trim()).length;
  } catch { return 0; }
}

// ── Reading ─────────────────────────────────────────────────

/** A design's history, oldest first. Tolerates a corrupt line rather than
 *  losing the whole log to one bad append. */
export function readLineage(designPath: string): { records: LineageRecord[]; skipped: number } {
  const lPath = lineagePath(designPath);
  let raw: string;
  try { raw = fs.readFileSync(lPath, 'utf-8'); } catch { return { records: [], skipped: 0 }; }
  const records: LineageRecord[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line) as LineageRecord); } catch { skipped++; }
  }
  return { records, skipped };
}

/** Breaks in the hash chain: a record whose `before` does not match the previous
 *  record's `after` means the file changed outside the tool surface (hand-edited,
 *  restored from a snapshot, synced). Worth surfacing — it is the difference
 *  between "the log is complete" and "the log is complete AND intact". */
export function chainGaps(records: LineageRecord[]): { seq: number; expected: string; found: string }[] {
  const gaps: { seq: number; expected: string; found: string }[] = [];
  for (let i = 1; i < records.length; i++) {
    const prev = records[i - 1], cur = records[i];
    if (cur.before && cur.before.hash !== prev.after.hash) {
      gaps.push({ seq: cur.seq, expected: prev.after.hash, found: cur.before.hash });
    }
  }
  return gaps;
}

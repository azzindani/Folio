// Folio MCP — restore, the missing half of the history.
//
// Every mutating tool already calls snapshot() before it writes, so a design
// has up to 20 previous states sitting in .mcp_versions/. Nothing in the tool
// surface could read one back. That left the agent able to PROVE a change went
// wrong — lineage records the before/after hashes — and unable to take it back,
// which is the thing that makes an unattended loop unsafe: heal re-lays out a
// page, tokens rewrites a palette, patch_spec re-renders a group, and the only
// recovery was rebuilding by hand.
//
// The addressing is by CONTENT, never by filename or position. A snapshot is
// "the state seq 7 ended at" if and only if its bytes hash to what seq 7
// recorded as its `after` — the same hash function lineage writes with. So a
// restore is checkable rather than hopeful: the reply can say which recorded
// state was reproduced, and a pruned or missing one fails loudly instead of
// quietly restoring a neighbour.
import * as fs from 'fs';
import * as path from 'path';

import { contentHash, type LineageRecord } from './design-lineage';

/** A set of bytes we could put back, and where it came from. */
export interface SnapshotEntry {
  path: string;
  hash: string;
  bytes: number;
  mtime: number;
  /** 'current' for the live file, otherwise the .bak filename. */
  label: string;
}

/** One recorded state, and whether the bytes for it still exist on disk. */
export interface RestorePoint {
  seq: number;
  op: string;
  ts: string;
  hash: string;
  bytes: number;
  available: boolean;
  /** True when this is the state the design is in right now. */
  current: boolean;
}

export function snapshotDir(designPath: string): string {
  return path.join(path.dirname(designPath), '.mcp_versions');
}

/** The .bak files belonging to this design, newest first. Matches the naming
 *  snapshot() writes: `<stem>_<iso-ts>[_n].bak`, stem = name minus `.yaml`. */
export function snapshotFiles(designPath: string): string[] {
  const dir = snapshotDir(designPath);
  const stem = path.basename(designPath, path.extname(designPath));
  try {
    return fs.readdirSync(dir)
      .filter(n => n.startsWith(`${stem}_`) && n.endsWith('.bak'))
      .map(n => path.join(dir, n))
      .sort((a, b) => statMs(b) - statMs(a));
  } catch { return []; }
}

function statMs(p: string): number {
  try { return fs.statSync(p).mtimeMs; } catch { return 0; }
}

/** Everything this design could be restored TO, keyed by content hash.
 *
 *  Two snapshots of an unchanged file collapse to one entry, which is right —
 *  they are the same state, and the newest surviving copy is the one to read. */
export function snapshotIndex(designPath: string): Map<string, SnapshotEntry> {
  const index = new Map<string, SnapshotEntry>();
  const add = (p: string, label: string): void => {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const hash = contentHash(raw);
      const existing = index.get(hash);
      const mtime = statMs(p);
      if (!existing || mtime > existing.mtime) {
        index.set(hash, { path: p, hash, bytes: Buffer.byteLength(raw), mtime, label });
      }
    } catch { /* an unreadable snapshot is simply not a restore point */ }
  };
  add(designPath, 'current');
  for (const f of snapshotFiles(designPath)) add(f, path.basename(f));
  return index;
}

/** The history, annotated with what is actually recoverable.
 *
 *  Lineage is unbounded and snapshots are capped (FOLIO_SNAPSHOT_KEEP, 20), so
 *  old entries stop being restorable long before they stop being readable. The
 *  agent needs to see which is which BEFORE it plans a rollback, not after. */
export function restorePoints(records: LineageRecord[], index: Map<string, SnapshotEntry>): RestorePoint[] {
  const currentHash = [...index.values()].find(e => e.label === 'current')?.hash;
  return records.map(r => ({
    seq: r.seq,
    op: r.op,
    ts: r.ts,
    hash: r.after.hash,
    bytes: r.after.bytes,
    available: index.has(r.after.hash),
    current: r.after.hash === currentHash,
  }));
}

export interface TargetOk { ok: true; point: RestorePoint; entry: SnapshotEntry }
export interface TargetErr { ok: false; message: string; hint: string }

/** Turn `to` — a lineage seq, or a raw content hash — into bytes we can write.
 *
 *  Every failure names what IS restorable, because "seq 3 is gone" is only
 *  actionable next to "4, 5 and 6 are still here". */
export function resolveRestoreTarget(
  records: LineageRecord[], index: Map<string, SnapshotEntry>, to: number | string,
): TargetOk | TargetErr {
  const points = restorePoints(records, index);
  const live = points.filter(p => p.available).map(p => p.seq);
  const listing = live.length ? `Restorable right now: ${live.join(', ')}.` : 'No recorded state is still on disk.';

  let point: RestorePoint | undefined;
  if (typeof to === 'number' || /^\d+$/.test(String(to))) {
    const seq = Number(to);
    point = points.find(p => p.seq === seq);
    if (!point) {
      return { ok: false, message: `This design has no change #${seq} — its history runs 1..${records.length}.`, hint: `${listing} Read them with manage_design {op:"lineage"}.` };
    }
  } else {
    const hash = String(to).trim().toLowerCase();
    point = points.find(p => p.hash === hash);
    if (!point) {
      const orphan = index.get(hash);
      if (orphan) {
        // A snapshot the log never saw — a pre-lineage design, or a state the
        // editor wrote. Still real bytes, so still restorable.
        return { ok: true, entry: orphan, point: { seq: 0, op: 'unrecorded', ts: new Date(orphan.mtime).toISOString(), hash, bytes: orphan.bytes, available: true, current: orphan.label === 'current' } };
      }
      return { ok: false, message: `No recorded state hashes to "${hash}".`, hint: listing };
    }
  }

  const entry = index.get(point.hash);
  if (!entry) {
    return {
      ok: false,
      message: `Change #${point.seq} (${point.op}) is in the history but its content is gone — snapshots are capped at ${keepCap()} per design, so states older than that are pruned while their records stay.`,
      hint: `${listing} The history still tells you WHAT changed at #${point.seq}; only the bytes to put back are missing.`,
    };
  }
  return { ok: true, point, entry };
}

export function keepCap(): number {
  const n = parseInt(process.env['FOLIO_SNAPSHOT_KEEP'] ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 20;
}

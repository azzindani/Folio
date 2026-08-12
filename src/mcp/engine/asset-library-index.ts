// Shared asset library — the content index.
//
// The library is a plain file tree (see asset-library.ts). This file is the
// sidecar that makes it a LIBRARY rather than a folder: a sha256 → entry map so
// the same bytes are never stored twice, plus the source refs that produced
// them so `asset_fetch` can answer "already have it" without a download at all.
//
// The tree stays the truth. Everything here is regenerable by rescanning, so a
// lost or corrupt index costs a rescan, never a file.
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import type { AssetEntry } from './assets';

/** A library asset: a project AssetEntry plus what makes it deduplicable. */
export interface LibraryEntry extends AssetEntry {
  /** sha256 of the stored bytes — the dedupe key. */
  sha256: string;
  /** Every ref/url observed to yield these bytes (wikimedia:…, font:…, https://…). */
  sources?: string[];
}

interface IndexFile {
  version: number;
  updated: string;
  assets: LibraryEntry[];
}

const INDEX_VERSION = 1;
const INDEX_NAME = 'index.json';

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Normalise a ref/url for source lookup — case and trailing slash are noise. */
export function sourceKey(ref: string): string {
  return String(ref ?? '').trim().replace(/\/+$/, '').toLowerCase();
}

function indexPath(root: string): string {
  return path.join(root, INDEX_NAME);
}

function isEntry(v: unknown): v is LibraryEntry {
  if (!v || typeof v !== 'object') return false;
  const e = v as Partial<LibraryEntry>;
  return typeof e.path === 'string' && typeof e.sha256 === 'string' && typeof e.kind === 'string';
}

/** Read the index. A missing/corrupt file is not an error — it reads as empty. */
export function readLibraryIndex(root: string): LibraryEntry[] {
  try {
    const raw = fs.readFileSync(indexPath(root), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    const rows = (parsed as Partial<IndexFile>)?.assets;
    return Array.isArray(rows) ? rows.filter(isEntry) : [];
  } catch {
    return [];
  }
}

/** Replace the whole index. Written via a temp file so a crash mid-write
 *  leaves the previous index intact rather than a truncated one. */
export function writeLibraryIndex(root: string, assets: LibraryEntry[]): void {
  const body: IndexFile = {
    version: INDEX_VERSION,
    updated: new Date().toISOString().split('T')[0] ?? '',
    assets: [...assets].sort((a, b) => a.path.localeCompare(b.path)),
  };
  fs.mkdirSync(root, { recursive: true });
  const tmp = `${indexPath(root)}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`);
  fs.renameSync(tmp, indexPath(root));
}

/**
 * Upsert one entry, keyed on path. Source refs accumulate rather than replace:
 * the same file legitimately arrives from several refs (an Iconify icon at two
 * sizes, a Commons file via two titles), and each is worth short-circuiting.
 */
export function upsertLibraryEntry(root: string, entry: LibraryEntry, source?: string): LibraryEntry {
  const rows = readLibraryIndex(root);
  const prior = rows.find(r => r.path === entry.path);
  const sources = new Set([...(prior?.sources ?? []), ...(entry.sources ?? [])]);
  if (source) sources.add(sourceKey(source));
  const merged: LibraryEntry = { ...entry, ...(sources.size ? { sources: [...sources] } : {}) };
  writeLibraryIndex(root, [...rows.filter(r => r.path !== entry.path), merged]);
  return merged;
}

export function removeLibraryEntry(root: string, libPath: string): void {
  const rows = readLibraryIndex(root);
  if (rows.some(r => r.path === libPath)) writeLibraryIndex(root, rows.filter(r => r.path !== libPath));
}

/** Entry holding exactly these bytes, if the library already has them. */
export function findByHash(root: string, hash: string): LibraryEntry | undefined {
  return readLibraryIndex(root).find(r => r.sha256 === hash);
}

/**
 * Entry previously fetched from this ref/url.
 *
 * This is the lookup that avoids the network entirely, so it is deliberately
 * exact — a ref that merely LOOKS similar is a different asset, and guessing
 * would serve the wrong file silently.
 */
export function findBySource(root: string, ref: string): LibraryEntry | undefined {
  const key = sourceKey(ref);
  if (!key) return undefined;
  return readLibraryIndex(root).find(r => (r.sources ?? []).includes(key));
}

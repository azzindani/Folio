import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { withOpScope, readLineage, chainGaps, contentHash } from './design-lineage';
import { snapshotIndex, snapshotFiles, restorePoints, keepCap } from './design-restore';
import { restoreDesign, designLineage } from './engine-spec-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { patchDesign } from './engine-edit-tools';
import { designTokens } from './engine-spec-tools';
import type { ShorthandLayer } from './shorthand-helpers';

type Rec = Record<string, unknown>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-restore-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'rs');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const SECTIONS = (id: string, title = 'Air Cargo') => ({
  id, type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF5C8A',
  title, blocks: [{ kind: 'text', text: 'Tonnage rose 8.4%.' }],
} as unknown as ShorthandLayer);

function build(name: string): string {
  if (!fs.existsSync(projectDir)) withOpScope('create_project', {}, () => createProject({ name: 'rs', canvas: '1080x1350' }));
  const d = withOpScope('create_design', { name }, () =>
    createDesign({ project_path: projectDir, name, type: 'poster', width: 1080, height: 1350 })) as unknown as Rec;
  return d['path'] as string;
}

/** A design with a real history: create → add layers → recolour. */
function withHistory(tag: string): string {
  const p = build(`${tag}-${Math.random().toString(36).slice(2, 7)}`);
  withOpScope('add_layers', {}, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
  withOpScope('tokens', {}, () => designTokens({ design_path: p, set: { accent: '#0EA5E9' } }));
  return p;
}

const read = (p: string): string => fs.readFileSync(p, 'utf-8');

describe('restore — addressing is by content, not by position', () => {
  it('puts back the EXACT bytes the target change recorded', () => {
    const p = withHistory('a');
    const recs = readLineage(p).records;
    const target = recs[1];                       // the state after add_layers
    expect(contentHash(read(p))).not.toBe(target.after.hash);

    const r = withOpScope('restore', {}, () => restoreDesign({ design_path: p, to: 2 })) as unknown as Rec;
    expect(r['restored']).toBe(true);
    expect(r['verified']).toBe(true);
    expect(contentHash(read(p))).toBe(target.after.hash);
  });

  it('refuses a state whose snapshot has been pruned, and names what survives', () => {
    const p = withHistory('b');
    for (const f of snapshotFiles(p)) fs.rmSync(f, { force: true });   // as the retention cap does
    const r = restoreDesign({ design_path: p, to: 2 }) as unknown as Rec;
    expect(r['success']).toBe(false);
    const text = JSON.stringify(r);
    expect(text).toMatch(/content is gone/);
    expect(text).toMatch(new RegExp(`capped at ${keepCap()}`));
    expect(text).toMatch(/Restorable right now: 3/);   // the live file is still a state
  });

  it('a snapshot that matches no record is not offered as one', () => {
    const p = withHistory('c');
    const bak = snapshotFiles(p)[0];
    fs.appendFileSync(bak, '\n# not any recorded state\n', 'utf-8');
    const points = restorePoints(readLineage(p).records, snapshotIndex(p));
    // The tampered file no longer hashes to the state it used to hold, so that
    // seq goes unavailable rather than restoring the wrong bytes.
    expect(points.some(pt => !pt.available)).toBe(true);
  });

  it('accepts a content hash as well as a seq', () => {
    const p = withHistory('d');
    const target = readLineage(p).records[1];
    const r = withOpScope('restore', {}, () => restoreDesign({ design_path: p, to: target.after.hash })) as unknown as Rec;
    expect(r['restored']).toBe(true);
    expect(contentHash(read(p))).toBe(target.after.hash);
  });

  it('errors with the real range when the seq does not exist', () => {
    const p = withHistory('e');
    const r = restoreDesign({ design_path: p, to: 99 }) as unknown as Rec;
    expect(r['success']).toBe(false);
    expect(JSON.stringify(r)).toMatch(/history runs 1\.\.3/);
  });
});

describe('restore — the rollback is itself history', () => {
  it('appends a record instead of rewriting the past, and keeps the chain intact', () => {
    const p = withHistory('f');
    const before = readLineage(p).records.length;
    withOpScope('restore', { to: 2 }, () => restoreDesign({ design_path: p, to: 2 }));

    const after = readLineage(p).records;
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1].op).toBe('restore');
    expect(after[1].after.hash).toBe(after[after.length - 1].after.hash);  // same state, new record
    expect(chainGaps(after)).toHaveLength(0);
  });

  it('is itself undoable — restore, then restore back', () => {
    const p = withHistory('g');
    const latest = contentHash(read(p));
    withOpScope('restore', {}, () => restoreDesign({ design_path: p, to: 2 }));
    expect(contentHash(read(p))).not.toBe(latest);

    const back = withOpScope('restore', {}, () => restoreDesign({ design_path: p, to: 3 })) as unknown as Rec;
    expect(back['restored']).toBe(true);
    expect(contentHash(read(p))).toBe(latest);
  });

  it('reports which later changes it undoes', () => {
    const p = withHistory('h');
    const r = withOpScope('restore', {}, () => restoreDesign({ design_path: p, to: 2 })) as unknown as Rec;
    expect(r['undone']).toEqual(['#3 tokens']);
  });
});

describe('restore — refuses to do nothing quietly', () => {
  it('says so when the design is already in that state, and does not write', () => {
    const p = withHistory('i');
    const seq = readLineage(p).records.length;
    const n = readLineage(p).records.length;
    const r = restoreDesign({ design_path: p, to: seq }) as unknown as Rec;
    expect(r['restored']).toBe(false);
    expect(r['unchanged']).toBe(true);
    expect(readLineage(p).records.length).toBe(n);
  });

  it('dry_run describes the change without making it', () => {
    const p = withHistory('j');
    const before = read(p);
    const r = restoreDesign({ design_path: p, to: 2, dry_run: true }) as unknown as Rec;
    expect(r['dry_run']).toBe(true);
    expect(r['would_undo']).toEqual(['#3 tokens']);
    expect((r['delta'] as Rec)['layers']).toMatch(/→/);
    expect(read(p)).toBe(before);
  });

  it('lists the restore points when no target is given', () => {
    const p = withHistory('k');
    const r = restoreDesign({ design_path: p }) as unknown as Rec;
    expect((r['restore_points'] as unknown[]).length).toBe(3);
    expect(r['available']).toContain(2);
    expect(String(r['note'])).toMatch(/Pass to:<seq>/);
  });

  it('says plainly that a design with no history has nothing to go back to', () => {
    const p = build(`l-${Math.random().toString(36).slice(2, 7)}`);
    fs.rmSync(path.join(path.dirname(p), '.mcp_versions', `${path.basename(p, '.yaml')}.lineage.jsonl`), { force: true });
    const r = restoreDesign({ design_path: p, to: 1 }) as unknown as Rec;
    expect(r['success']).toBe(false);
    expect(JSON.stringify(r)).toMatch(/no recorded history/);
  });
});

describe('lineage — shows what is recoverable, not just what happened', () => {
  it('flags each record restorable and lists the seqs', () => {
    const p = withHistory('m');
    const r = designLineage({ design_path: p }) as unknown as Rec;
    const rows = r['records'] as Rec[];
    expect(rows.every(x => 'restorable' in x)).toBe(true);
    expect((r['restorable'] as Rec)['seqs']).toContain(2);
    expect(String((r['restorable'] as Rec)['how'])).toMatch(/manage_design \{op:"restore"/);
  });

  it('says why when nothing can be rolled back', () => {
    const p = withHistory('n');
    for (const f of snapshotFiles(p)) fs.rmSync(f, { force: true });
    const r = designLineage({ design_path: p }) as unknown as Rec;
    expect((r['restorable'] as Rec)['seqs']).toEqual([]);
    expect(String((r['restorable'] as Rec)['how'])).toMatch(/capped at/);
  });
});

describe('restore — recovers a design a later tool broke', () => {
  it('undoes a bad patch and gets the working design back', () => {
    const p = withHistory('o');
    const good = read(p);
    const goodSeq = readLineage(p).records.length;
    withOpScope('patch_design', {}, () => patchDesign({ design_path: p, selectors: [{ path: 'meta.name', value: 'oops' }] }));
    expect(read(p)).not.toBe(good);

    const r = withOpScope('restore', {}, () => restoreDesign({ design_path: p, to: goodSeq })) as unknown as Rec;
    expect(r['verified']).toBe(true);
    expect(read(p)).toBe(good);
  });
});

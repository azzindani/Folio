import { describe, it, expect, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { withOpScope, readLineage, lineagePath, chainGaps, type LineageRecord } from './design-lineage';
import { designLineage } from './engine-spec-tools';
import { createProject, createDesign } from './engine-project-tools';
import { addLayers } from './engine-layer-tools';
import { patchDesign } from './engine-edit-tools';
import { designTokens } from './engine-spec-tools';
import type { ShorthandLayer } from './shorthand-helpers';

type Rec = Record<string, unknown>;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-lineage-'));
process.env['FOLIO_PROJECTS_DIR'] = dir;
const projectDir = path.join(dir, 'ln');

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const SECTIONS = (id: string) => ({
  id, type: 'sections', z: 0, pos: [0, 0, 1080, 1350], bg: '#0A0A0A', accent: '#FF5C8A',
  title: 'Air Cargo', blocks: [{ kind: 'text', text: 'Tonnage rose 8.4%.' }],
} as unknown as ShorthandLayer);

/** Make a design, returning its path — each step inside its own op scope, the
 *  way the MCP request handler wraps a real tool call. */
function build(name: string): string {
  if (!fs.existsSync(projectDir)) withOpScope('create_project', { name: 'ln' }, () => createProject({ name: 'ln', canvas: '1080x1350' }));
  const d = withOpScope('create_design', { project_path: 'ln', name }, () =>
    createDesign({ project_path: projectDir, name, type: 'poster', width: 1080, height: 1350 })) as unknown as Rec;
  return d['path'] as string;
}

describe('lineage — coverage is structural, not per-call-site', () => {
  it('records a write from ANY tool, without that tool knowing about lineage', () => {
    const p = build(`a-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    withOpScope('tokens', { design_path: p, set: { accent: '#0EA5E9' } }, () => designTokens({ design_path: p, set: { accent: '#0EA5E9' } }));

    const { records } = readLineage(p);
    expect(records.map(r => r.op)).toEqual(['create_design', 'add_layers', 'tokens']);
    expect(records[0].seq).toBe(1);
    expect(records[2].seq).toBe(3);
  });

  it('a write outside any tool call is not attributed to one', () => {
    const p = build(`b-${Math.random().toString(36).slice(2, 7)}`);
    const before = readLineage(p).records.length;
    addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] });   // no scope
    expect(readLineage(p).records.length).toBe(before);
  });

  it('carries the before/after hashes and the byte sizes', () => {
    const p = build(`c-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    const [, second] = readLineage(p).records;
    expect(second.before?.hash).toBeTruthy();
    expect(second.after.hash).not.toBe(second.before?.hash);
    expect(second.after.bytes).toBeGreaterThan(second.before!.bytes);
    expect(typeof second.ms).toBe('number');
  });

  it('the creating record has no before-state', () => {
    const p = build(`d-${Math.random().toString(36).slice(2, 7)}`);
    expect(readLineage(p).records[0].before).toBeUndefined();
  });

  it('is ONE record per call even when the call writes more than once', () => {
    const p = build(`e-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    const after = readLineage(p).records.filter(r => r.op === 'add_layers');
    expect(after).toHaveLength(1);
    expect(after[0].writes).toBeGreaterThanOrEqual(1);
  });

  it('a call that changed nothing is not history', () => {
    const p = build(`f-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    const before = readLineage(p).records.length;
    // A no-op token set writes nothing.
    withOpScope('tokens', { design_path: p }, () => designTokens({ design_path: p, set: { accent: '#FF5C8A' } }));
    expect(readLineage(p).records.length).toBe(before);
  });

  it('stores a digest of the arguments, not the arguments', () => {
    const p = build(`g-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p, layers_shorthand: [SECTIONS('s1'), SECTIONS('s2')] }, () =>
      addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    const rec = readLineage(p).records.find(r => r.op === 'add_layers')!;
    expect(rec.args['layers_shorthand']).toBe('<array:2>');
    expect(rec.args_hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('records even when the tool throws — a failed call that wrote is the point', () => {
    const p = build(`h-${Math.random().toString(36).slice(2, 7)}`);
    const before = readLineage(p).records.length;
    expect(() => withOpScope('boom', { design_path: p }, () => {
      addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] });
      throw new Error('exploded after writing');
    })).toThrow(/exploded/);
    expect(readLineage(p).records.length).toBe(before + 1);
  });
});

describe('lineage — the chain proves what the log cannot see', () => {
  it('is intact across normal tool writes', () => {
    const p = build(`i-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    withOpScope('patch_design', { design_path: p }, () => patchDesign({ design_path: p, selectors: [{ path: 'meta.name', value: 'renamed' }] }));
    expect(chainGaps(readLineage(p).records)).toHaveLength(0);
  });

  it('reports a break when the file was edited outside the tool surface', () => {
    const p = build(`j-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    fs.appendFileSync(p, '\n# edited by hand\n', 'utf-8');       // outside every tool
    withOpScope('patch_design', { design_path: p }, () => patchDesign({ design_path: p, selectors: [{ path: 'meta.name', value: 'after-hand-edit' }] }));

    const gaps = chainGaps(readLineage(p).records);
    expect(gaps.length).toBe(1);
    const r = designLineage({ design_path: p }) as unknown as Rec;
    expect((r['chain_breaks'] as unknown[]).length).toBe(1);
    expect(String(r['chain_note'])).toMatch(/outside the tool surface/);
  });
});

describe('lineage — the read op states its scope', () => {
  it('always says what it does and does not cover', () => {
    const p = build(`k-${Math.random().toString(36).slice(2, 7)}`);
    const r = designLineage({ design_path: p }) as unknown as Rec;
    expect(String(r['scope'])).toMatch(/Every write to this .design.yaml/);
    expect(String(r['scope'])).toMatch(/NOT entries/);
  });

  it('says so plainly when a design predates lineage', () => {
    const p = build(`l-${Math.random().toString(36).slice(2, 7)}`);
    fs.rmSync(lineagePath(p), { force: true });
    const r = designLineage({ design_path: p }) as unknown as Rec;
    expect(r['count']).toBe(0);
    expect(String(r['note'])).toMatch(/created before it shipped/);
  });

  it('counts by op and honours limit', () => {
    const p = build(`m-${Math.random().toString(36).slice(2, 7)}`);
    for (let i = 0; i < 3; i++) {
      withOpScope('patch_design', { design_path: p, i }, () => patchDesign({ design_path: p, selectors: [{ path: 'meta.name', value: `n${i}` }] }));
    }
    const r = designLineage({ design_path: p, limit: 2 }) as unknown as Rec;
    expect(r['showing']).toBe(2);
    expect((r['by_op'] as Rec)['patch_design']).toBe(3);
    expect(String(r['chain'])).toMatch(/intact/);
  });

  it('survives a corrupt line instead of losing the whole log', () => {
    const p = build(`n-${Math.random().toString(36).slice(2, 7)}`);
    withOpScope('add_layers', { design_path: p }, () => addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] }));
    fs.appendFileSync(lineagePath(p), 'not json at all\n', 'utf-8');
    const { records, skipped } = readLineage(p);
    expect(records.length).toBeGreaterThan(0);
    expect(skipped).toBe(1);
  });
});

describe('lineage — concurrency', () => {
  it('attributes each write to its own call when two are in flight', async () => {
    const a = build(`x-${Math.random().toString(36).slice(2, 7)}`);
    const b = build(`y-${Math.random().toString(36).slice(2, 7)}`);
    const slow = (p: string, op: string): Promise<void> => withOpScope(op, { design_path: p }, async () => {
      await new Promise(r => setTimeout(r, 5));
      addLayers({ design_path: p, layers_shorthand: [SECTIONS('s1')] });
    });
    await Promise.all([slow(a, 'op_a'), slow(b, 'op_b')]);
    expect(readLineage(a).records.some((r: LineageRecord) => r.op === 'op_a')).toBe(true);
    expect(readLineage(a).records.some((r: LineageRecord) => r.op === 'op_b')).toBe(false);
    expect(readLineage(b).records.some((r: LineageRecord) => r.op === 'op_b')).toBe(true);
  });
});

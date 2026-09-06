import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { serializeYAML } from '../schema/parser';
import { diagnoseDesign } from './engine-export-tools';
import { normalizeGroupChildren } from './engine-finalize-geom';
import { renderFailureFindings } from './engine/diagnose-render';
import { missingArgs } from './required-args';
import { knownOp, TOOL_OPS } from './tool-ops';
import { findDeep } from './engine/layer-lookup';
import type { DesignSpec, Layer } from '../schema/types';

// Pass 24 asked what the engine SAYS to do when it refuses, and followed the
// advice literally. Most of it is true — the tool list is exact, all 68 ops a
// hint names are real, and "use inspect to find layer IDs, group children are
// listed with a parent field" holds. The exception was a group authored with
// `children:` instead of the schema's `layers:`, which nothing read.

const kid = (): Layer => ({
  id: 'kid', type: 'text', x: 50, y: 50, width: 400, height: 60,
  content: { type: 'text', value: 'hi' }, style: { font_size: 32 },
} as unknown as Layer);

const aliasedGroup = (): Layer => ({
  id: 'grp', type: 'group', x: 40, y: 40, width: 500, height: 200, z: 1, children: [kid()],
} as unknown as Layer);

const spec = (layers: Layer[]): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'x', name: 'x', type: 'poster' },
  document: { width: 600, height: 400, unit: 'px', dpi: 96 }, layers,
} as unknown as DesignSpec);

describe('a group authored with children: instead of layers:', () => {
  it('folds the alias onto the canonical key', () => {
    const ls = [aliasedGroup()];
    expect(normalizeGroupChildren(ls)).toBe(1);
    const o = ls[0] as unknown as Record<string, unknown>;
    expect(Array.isArray(o['layers'])).toBe(true);
    expect((o['layers'] as Layer[]).map(l => l.id)).toEqual(['kid']);
    expect('children' in o).toBe(false);
  });

  it('makes the child reachable — findDeep descends `layers` only', () => {
    const before = [aliasedGroup()];
    expect(findDeep(before, 'kid'), 'unreachable before the fold').toBeNull();
    normalizeGroupChildren(before);
    expect(findDeep(before, 'kid')?.layer.id).toBe('kid');
  });

  it('recurses, so a nested alias folds too', () => {
    const inner = { id: 'in', type: 'group', x: 0, y: 0, width: 10, height: 10, children: [kid()] };
    const outer = [{ id: 'out', type: 'group', x: 0, y: 0, width: 20, height: 20, layers: [inner] }] as unknown as Layer[];
    expect(normalizeGroupChildren(outer)).toBe(1);
    expect(findDeep(outer, 'kid')?.layer.id).toBe('kid');
  });

  it('keeps both when both are populated, rather than dropping either', () => {
    const both = [{ id: 'g', type: 'group', x: 0, y: 0, width: 10, height: 10,
      layers: [{ ...kid(), id: 'a' }], children: [{ ...kid(), id: 'b' }] }] as unknown as Layer[];
    normalizeGroupChildren(both);
    const o = both[0] as unknown as Record<string, unknown>;
    expect((o['layers'] as Layer[]).map(l => l.id)).toEqual(['a', 'b']);
  });

  it('leaves a group that already uses the canonical key alone', () => {
    const ok = [{ id: 'g', type: 'group', x: 0, y: 0, width: 10, height: 10, layers: [kid()] }] as unknown as Layer[];
    expect(normalizeGroupChildren(ok)).toBe(0);
  });

  it('ignores `children` on a layer type that does not nest', () => {
    const rect = [{ id: 'r', type: 'rect', x: 0, y: 0, width: 10, height: 10, children: [kid()] }] as unknown as Layer[];
    expect(normalizeGroupChildren(rect)).toBe(0);
  });
});

describe('diagnose asks the renderer whether every layer draws', () => {
  // The gap this closes: every other check reasons about the SPEC and can pass
  // while a layer throws on the way to the canvas. Live, diagnose_design said
  // "No problems — 0 errors, 0 warnings" about this exact design, which renders
  // the group as an empty dashed ⚠ box.
  it('reports the group that renders as a placeholder', () => {
    const found = renderFailureFindings(spec([aliasedGroup()]));
    expect(found.length).toBe(1);
    expect(found[0]?.severity).toBe('error');
    expect(found[0]?.code).toBe('layer_render_failed');
    expect(found[0]?.layer_id).toBe('grp');
    expect(found[0]?.message).toMatch(/no `layers`/);
    expect(found[0]?.fix).toMatch(/not `children:`/);
  });

  it('says nothing once the alias is folded', () => {
    const ls = [aliasedGroup()];
    normalizeGroupChildren(ls);
    expect(renderFailureFindings(spec(ls))).toEqual([]);
  });

  it('says nothing about a design that renders cleanly', () => {
    const clean = [{ id: 'bg', type: 'rect', x: 0, y: 0, width: 600, height: 400, fill: '#fff', z: 0 }] as unknown as Layer[];
    expect(renderFailureFindings(spec(clean))).toEqual([]);
  });

  it('and diagnose_design actually CALLS it', () => {
    // The door. Live, the capability to notice this did not exist at all; a
    // version of the fix that stops at the helper would leave diagnose_design
    // reporting "No problems" exactly as before.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-diag-'));
    try {
      const dPath = path.join(dir, 'x.design.yaml');
      fs.writeFileSync(dPath, serializeYAML(spec([
        { id: 'bg', type: 'rect', x: 0, y: 0, width: 600, height: 400, fill: '#FFFFFF', z: 0 } as unknown as Layer,
        aliasedGroup(),
      ])));
      const r = diagnoseDesign({ design_path: dPath }) as unknown as {
        ok: boolean; findings?: Array<{ code: string; severity: string }>;
      };
      expect(r.ok, 'diagnose still blesses a design whose group does not render').toBe(false);
      expect((r.findings ?? []).some(f => f.code === 'layer_render_failed' && f.severity === 'error')).toBe(true);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('an unknown op is answered by the multiplexer, not the arg guard', () => {
  // Before: `edit_layer {op:"bogus"}` came back "needs `design_path`" — advice
  // for a call that fails again, because the next reply is "Unknown op" anyway.
  it('defers so the tool can list its real ops', () => {
    expect(missingArgs('edit_layer', { op: 'definitely_not_an_op' })).toBeNull();
  });

  it('still names a missing argument for an op that IS real', () => {
    const r = missingArgs('edit_layer', { op: 'update' });
    expect(r?.success).toBe(false);
    expect(JSON.stringify(r)).toMatch(/design_path/);
  });

  it('still guards a tool that does not multiplex', () => {
    expect(missingArgs('add_layers', {})).not.toBeNull();
  });

  it('every op the table names is dispatched, and a made-up one is not', () => {
    for (const [tool, ops] of Object.entries(TOOL_OPS)) {
      for (const op of ops) expect(knownOp(tool, op), `${tool}.${op}`).toBe(true);
    }
    expect(knownOp('manage_design', 'not_an_op')).toBe(false);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { ALL_HANDLERS } from './handlers';
import { PER_OP } from './required-args';

// Found by calling every tool and every op with the arguments left out. The
// reply used to be a runtime crash — 'The "path" property must be of type
// string, got undefined', "undefined is not an object (evaluating
// 'idOrFile.replace')", "Task not found: undefined" — none of which names the
// argument that is missing. A conforming client validates `required` for us,
// which is why it went unnoticed; the HTTP surface takes JSON-RPC from anything.
const call = (tool: string, a: Record<string, unknown> = {}): Record<string, unknown> =>
  ALL_HANDLERS[tool]?.(a) as Record<string, unknown>;

const cases: [string, Record<string, unknown>, string][] = [
  // single-purpose tools — requirement comes from their own inputSchema
  ['seal_design', {}, 'design_path'],
  ['render_preview', {}, 'design_path'],
  ['diagnose_design', {}, 'design_path'],
  ['export_design', {}, 'design_path'],
  ['append_page', {}, 'design_path'],
  ['patch_design', {}, 'design_path'],
  ['create_project', {}, 'name'],
  ['create_design', {}, 'project_path'],
  ['enrich_brief', {}, 'prompt'],
  // multiplexed tools — requirement comes from the per-op table
  ['templates', { op: 'slots' }, 'template_path'],
  ['templates', { op: 'components' }, 'project_path'],
  ['report', { op: 'generate' }, 'project_path'],
  ['presentation', { op: 'create' }, 'project_path'],
  ['themes', { op: 'apply' }, 'project_path'],
  ['tasks', { op: 'resume' }, 'task_path'],
  ['edit_layer', { op: 'add' }, 'design_path'],
  ['edit_layer', { op: 'split_text' }, 'design_path'],
  ['animation', { op: 'track' }, 'design_path'],
  // Found later, by sweeping every op of all eight multiplexers rather than a
  // hand-picked sample: manage_design was missing from the table wholesale, and
  // two `list` ops were assumed to be argument-free menus. They are not.
  ['themes', { op: 'list' }, 'project_path'],
  ['tasks', { op: 'list' }, 'project_path'],
  ['manage_design', { op: 'list' }, 'project_path'],
  ['manage_design', { op: 'inspect' }, 'design_path'],
  ['manage_design', { op: 'rename' }, 'new_name'],
  ['manage_design', { op: 'duplicate' }, 'new_name'],
  ['manage_design', { op: 'move' }, 'target_project'],
  ['manage_design', { op: 'delete' }, 'design_path'],
  ['manage_design', { op: 'resume' }, 'design_path'],
  ['manage_design', { op: 'get_spec' }, 'design_path'],
  ['manage_design', { op: 'resize' }, 'design_path'],
  ['manage_design', { op: 'tokens' }, 'design_path'],
  ['manage_design', { op: 'lineage' }, 'design_path'],
  ['manage_design', { op: 'restore' }, 'design_path'],
  ['manage_design', { op: 'style_history' }, 'project_path'],
];

describe('a tool enforces the arguments it promises', () => {
  for (const [tool, args, arg] of cases) {
    const label = args['op'] ? `${tool} {op:"${String(args['op'])}"}` : tool;
    it(`${label} names ${arg}`, () => {
      const r = call(tool, args);
      expect(r['success']).toBe(false);
      expect(String(r['error'])).toContain(arg);
      expect(String(r['hint'])).toContain(arg);
      // Never a runtime crash leaking V8/Node internals.
      expect(String(r['error'])).not.toMatch(/is not an object|must be of type string|paths\[0\]|undefined$/);
    });
  }

  it('lets ops that legitimately need nothing through', () => {
    // A menu and a catalogue: no arguments, and they must still answer.
    expect((call('animation', { op: 'presets' }))['success']).toBe(true);
    expect((call('templates', { op: 'list', limit: 1 }))['success']).toBe(true);
    expect((call('get_engine_guide', {}))['success']).toBe(true);
  });

  it('reports a missing op as a bad op, not a missing argument', () => {
    const r = call('templates', {});
    expect(String(r['error'])).toContain('Unknown op');
  });
});

// The list above is a sample, and a sample is how manage_design stayed missing
// through a dozen sweeps: nobody wrote the case, so nobody saw the crash. This
// closes that door — every op a multiplexer advertises must have had its
// requirements DECIDED, either as a row in PER_OP or as a deliberate exemption
// named here with a reason. Adding an op and forgetting fails the suite.
const EXEMPT: Record<string, string[]> = {
  // no-argument scans and menus
  manage_design: ['browse', 'gallery', 'icon_search'],
  themes: ['packs'],
  templates: ['list'],
  presentation: ['remote'],
  animation: ['presets'],
  tasks: [],
  report: [],
  edit_layer: [],
};
// The asset ops hand-check their own arguments and name the missing one; three
// of them publish an either/or requirement (`data` OR `source_path`) that a
// plain conjunction cannot express without rejecting valid calls.
const HAND_CHECKED = /^asset_/;

describe('every advertised op has had its requirements decided', () => {
  const src = readFileSync('src/mcp/dispatch.ts', 'utf8');
  // Each multiplexer ends in badOp('<tool>', a['op'], [ ...every op... ]).
  const found = [...src.matchAll(/badOp\('(\w+)',\s*a\['op'\],\s*\n?\s*\[([^\]]*)\]/g)];

  it('finds all eight multiplexers in dispatch.ts', () => {
    expect(found.map(m => m[1]).sort()).toEqual([
      'animation', 'edit_layer', 'manage_design', 'presentation',
      'report', 'tasks', 'templates', 'themes',
    ]);
  });

  for (const m of found) {
    const tool = m[1] ?? '';
    const ops = [...(m[2] ?? '').matchAll(/'([\w]+)'/g)].map(x => x[1] ?? '');
    it(`${tool} — all ${ops.length} ops`, () => {
      const undecided = ops.filter(op =>
        !HAND_CHECKED.test(op) &&
        PER_OP[tool]?.[op] === undefined &&
        !(EXEMPT[tool] ?? []).includes(op));
      expect(undecided).toEqual([]);
    });
  }

  it('does not claim requirements for ops that no longer exist', () => {
    const stale: string[] = [];
    for (const m of found) {
      const tool = m[1] ?? '';
      const ops = new Set([...(m[2] ?? '').matchAll(/'([\w]+)'/g)].map(x => x[1] ?? ''));
      for (const op of Object.keys(PER_OP[tool] ?? {})) if (!ops.has(op)) stale.push(`${tool}.${op}`);
    }
    expect(stale).toEqual([]);
  });
});

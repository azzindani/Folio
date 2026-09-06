import { describe, it, expect } from 'vitest';
import { ALL_HANDLERS } from './handlers';

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

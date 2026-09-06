import { describe, it, expect } from 'vitest';
import { dispatchTemplates, dispatchReport, dispatchPresentation } from './dispatch';

// A missing argument used to reach the handler and crash inside whatever
// touched it first, and the crash became the reply — "undefined is not an
// object (evaluating 'idOrFile.replace')", 'The "paths[0]" property must be of
// type string', and a half-built path with `undefined` in it. Sixteen of the
// nineteen ops across these three tools answered that way. Found by calling
// every op on three tools that six earlier sweeps never touched.
const cases: [string, (a: Record<string, unknown>) => unknown, string, string][] = [
  ['templates', dispatchTemplates, 'slots', 'template_path'],
  ['templates', dispatchTemplates, 'inject', 'template_path'],
  ['templates', dispatchTemplates, 'export', 'design_path'],
  ['templates', dispatchTemplates, 'components', 'project_path'],
  ['templates', dispatchTemplates, 'batch', 'project_path'],
  ['templates', dispatchTemplates, 'save_component', 'design_path'],
  ['report', dispatchReport, 'generate', 'project_path'],
  ['report', dispatchReport, 'customize', 'design_path'],
  ['report', dispatchReport, 'bind_data', 'design_path'],
  ['report', dispatchReport, 'validate', 'design_path'],
  ['report', dispatchReport, 'export', 'design_path'],
  ['report', dispatchReport, 'formula', 'design_path'],
  ['report', dispatchReport, 'debug', 'formula'],
  ['presentation', dispatchPresentation, 'create', 'project_path'],
  ['presentation', dispatchPresentation, 'customize', 'design_path'],
  ['presentation', dispatchPresentation, 'export', 'design_path'],
  ['presentation', dispatchPresentation, 'collab', 'design_path'],
];

describe('a missing argument is named, not crashed on', () => {
  for (const [tool, fn, op, arg] of cases) {
    it(`${tool} {op:"${op}"} names ${arg}`, () => {
      const r = fn({ op }) as { success?: boolean; error?: string; hint?: string };
      expect(r.success).toBe(false);
      expect(String(r.error)).toContain(arg);
      // The reply must not be a runtime crash leaking V8/Node internals.
      expect(String(r.error)).not.toMatch(/undefined is not an object|must be of type string|paths\[0\]/);
      expect(String(r.hint)).toContain(arg);
    });
  }

  it('lets a well-formed call through to the handler', () => {
    // `list` has no required args and must still work.
    const r = dispatchTemplates({ op: 'list', limit: 1 }) as { success?: boolean };
    expect(r.success).toBe(true);
  });
});

import * as path from 'path';
import * as os from 'os';

/**
 * Normalize project-path-ish tool arguments so a design always lands somewhere
 * the editor can actually serve (FOLIO_PROJECTS_DIR). The editor only mounts
 * that single root at /__project_files/*, so a design created anywhere else
 * yields an editor link that opens to an empty canvas.
 *
 * Three rewrites, all no-ops when FOLIO_PROJECTS_DIR is unset (local dev), so
 * absolute paths pass through untouched there:
 *
 *   1. Bare name ("my-project")                   → <projects>/my-project
 *   2. Misguessed "/…/projects/<x>" absolute path → <projects>/<x>
 *   3. Absolute path under HOME but outside        → <projects>/<rel-from-home>
 *      <projects> (e.g. /home/folio/AIPosterProject — an LLM using HOME as the
 *      base instead of the projects dir). Only fires when <projects> is itself
 *      nested under HOME (the deployed container topology); a projects dir on a
 *      separate root is left alone so custom layouts aren't surprised.
 *
 * Applied to project_path, path AND design_path so create_design and the
 * add_layers / seal_design / export_design calls that thread the same paths
 * afterwards all agree on one editor-loadable location.
 */
export function normalizeProjectPaths(args: Record<string, unknown>): Record<string, unknown> {
  const baseEnv = process.env['FOLIO_PROJECTS_DIR'];
  if (!baseEnv) return args;
  const projects = path.resolve(baseEnv);
  const home = os.homedir();
  const under = (root: string, p: string): boolean => p === root || p.startsWith(root + path.sep);
  const projectsUnderHome = under(home, projects);

  const rebaseAbsolute = (v: string): string => {
    // (2) "/var/folio/projects/<x>", "/srv/.../projects/<x>" → <projects>/<x>
    const m = v.match(/[/\\]projects[/\\]([^/\\]+(?:[/\\][^/\\]+)*)$/);
    if (m && m[1] && !under(projects, v)) return path.join(projects, m[1]);
    // (3) under HOME but outside <projects> (deployed topology only)
    if (projectsUnderHome && under(home, v) && !under(projects, v)) {
      return path.join(projects, path.relative(home, v));
    }
    return v;
  };

  const out: Record<string, unknown> = { ...args };
  for (const f of ['project_path', 'path', 'design_path']) {
    const v = out[f];
    if (typeof v !== 'string' || v.length === 0) continue;
    if (path.isAbsolute(v)) {
      out[f] = rebaseAbsolute(v);
    } else if (f !== 'design_path' && !v.startsWith('~/')) {
      // Bare project name → <projects>/<name>. A relative design_path
      // ("designs/foo.design.yaml") is left for the engine to resolve against
      // project_path.
      out[f] = path.join(projects, v);
    }
  }
  return out;
}

// Design Library — a cross-project catalog of EVERYTHING stored under
// FOLIO_PROJECTS_DIR. Folio's per-project tools (list_designs) only ever see one
// project; this is the file-manager view over the whole collection: every project,
// every design, with the metadata you'd want in a browser (name, type, canvas,
// pages, last-modified) and an optional open-in-editor link per design.
//
// Reads are CHEAP: a design .yaml can be huge (a full layer tree), but the meta +
// document blocks sit at the TOP, so we parse only the header (everything before
// the first top-level layers:/pages:/… key) instead of the whole file.
//
// Pure-ish: filesystem reads only, no writes. Backs both the browse_library MCP
// tool and the exported gallery (see library-gallery.ts).

import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';
import type { ToolResult } from '../types';
import { okResult, errResult, buildContext, pOk } from './utils';
import { buildEditorLink } from './editor-link';

export interface LibraryDesign {
  name: string;
  type: string;
  design_path: string;
  width?: number;
  height?: number;
  pages?: number;
  modified: string;       // ISO8601
  open_url?: string;      // editor link (only when include_links)
}

export interface LibraryProject {
  name: string;
  project_path: string;
  modified: string;       // ISO8601 — newest of project.yaml / its designs
  design_count: number;
  designs: LibraryDesign[];
  designs_truncated?: boolean;
}

const DESIGN_SUFFIX = '.design.yaml';

/** Cheap meta read — parse only the YAML header, never the layer tree. */
export function readDesignHeader(file: string): { name?: string; type?: string; width?: number; height?: number; pages?: number } {
  let raw: string;
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return {}; }
  const cut = raw.search(/\n(?:layers|pages|report|presentation|animations|scripts|state):/);
  const head = cut > 0 ? raw.slice(0, cut) : raw;
  let doc: { meta?: Record<string, unknown>; document?: Record<string, unknown> } = {};
  try { doc = (yaml.load(head) as typeof doc) ?? {}; } catch { doc = {}; }
  const meta = doc.meta ?? {}, document = doc.document ?? {};
  let pages: number | undefined;
  const pIdx = raw.indexOf('\npages:');
  if (pIdx >= 0) { const n = (raw.slice(pIdx).match(/\n {2}- /g) || []).length; if (n > 0) pages = n; }
  return {
    name: typeof meta['name'] === 'string' ? meta['name'] : undefined,
    type: typeof meta['type'] === 'string' ? meta['type'] : undefined,
    width: typeof document['width'] === 'number' ? document['width'] : undefined,
    height: typeof document['height'] === 'number' ? document['height'] : undefined,
    pages,
  };
}

/** Scan one project dir → its designs (cheap headers + mtimes). */
function scanProject(root: string, name: string, includeLinks: boolean): LibraryProject | null {
  const projDir = path.join(root, name);
  const designsDir = path.join(projDir, 'designs');
  const hasYaml = fs.existsSync(path.join(projDir, 'project.yaml'));
  let files: string[] = [];
  try { files = fs.readdirSync(designsDir).filter(f => f.endsWith(DESIGN_SUFFIX)); } catch { /* no designs dir */ }
  if (!hasYaml && files.length === 0) return null;

  let newest = 0;
  const designs: LibraryDesign[] = [];
  for (const f of files) {
    const fp = path.join(designsDir, f);
    let mtime = 0;
    try { mtime = fs.statSync(fp).mtimeMs; } catch { /* gone mid-scan */ continue; }
    newest = Math.max(newest, mtime);
    const h = readDesignHeader(fp);
    designs.push({
      name: h.name ?? f.replace(DESIGN_SUFFIX, ''),
      type: h.type ?? 'poster',
      design_path: fp,
      width: h.width, height: h.height, pages: h.pages,
      modified: new Date(mtime).toISOString(),
      ...(includeLinks ? { open_url: buildEditorLink(fp).open_url } : {}),
    });
  }
  // Project mtime: newest of its designs, else the project.yaml itself.
  if (newest === 0) { try { newest = fs.statSync(path.join(projDir, 'project.yaml')).mtimeMs; } catch { /* ignore */ } }
  designs.sort((a, b) => b.modified.localeCompare(a.modified));
  return { name, project_path: projDir, modified: new Date(newest).toISOString(), design_count: designs.length, designs };
}

/** Build the whole-collection catalog (no result envelope) — reused by the gallery. */
export function collectLibrary(opts: { search?: string; type?: string; project?: string; sort?: string; includeLinks?: boolean } = {}): { projects: LibraryProject[]; totalProjects: number; totalDesigns: number } {
  const root = process.env['FOLIO_PROJECTS_DIR'];
  if (!root || !fs.existsSync(root)) return { projects: [], totalProjects: 0, totalDesigns: 0 };
  const dirs = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.'));
  const search = opts.search?.toLowerCase().trim();
  const typeF = opts.type?.toLowerCase().trim();
  const projF = opts.project?.toLowerCase().trim();

  let projects: LibraryProject[] = [];
  for (const d of dirs) {
    if (projF && !d.name.toLowerCase().includes(projF)) continue;
    const p = scanProject(root, d.name, !!opts.includeLinks);
    if (p) projects.push(p);
  }
  const totalProjects = projects.length;
  const totalDesigns = projects.reduce((s, p) => s + p.design_count, 0);

  // Filter designs by search/type; drop projects left with none.
  if (search || typeF) {
    projects = projects.map(p => {
      const designs = p.designs.filter(ds =>
        (!typeF || ds.type.toLowerCase() === typeF) &&
        (!search || ds.name.toLowerCase().includes(search) || p.name.toLowerCase().includes(search)));
      return { ...p, designs, design_count: designs.length };
    }).filter(p => p.design_count > 0);
  }

  const sort = opts.sort ?? 'modified';
  projects.sort((a, b) =>
    sort === 'name' ? a.name.localeCompare(b.name) :
    sort === 'designs' ? b.design_count - a.design_count :
    b.modified.localeCompare(a.modified));
  return { projects, totalProjects, totalDesigns };
}

export function browseLibrary(args: { search?: string; type?: string; project?: string; sort?: 'modified' | 'name' | 'designs'; limit?: number; designs_per_project?: number; include_links?: boolean }): ToolResult {
  const op = 'browse_library';
  const root = process.env['FOLIO_PROJECTS_DIR'];
  if (!root || !fs.existsSync(root)) return errResult(op, 'No projects directory found', 'FOLIO_PROJECTS_DIR is not set, or the path does not exist.');

  const { projects, totalProjects, totalDesigns } = collectLibrary({ search: args.search, type: args.type, project: args.project, sort: args.sort, includeLinks: args.include_links });
  const limit = Math.max(1, Math.min(args.limit ?? 40, 200));
  const dpp = Math.max(1, Math.min(args.designs_per_project ?? 8, 40));

  const shown = projects.slice(0, limit).map(p => ({
    ...p,
    designs_truncated: p.designs.length > dpp ? true : undefined,
    designs: p.designs.slice(0, dpp),
  }));
  const matched = (args.search || args.type) ? projects.reduce((s, p) => s + p.design_count, 0) : totalDesigns;

  const progress = [pOk(`Catalogued ${totalProjects} project(s) · ${totalDesigns} design(s)`, (args.search || args.type || args.project) ? `${projects.length} project(s) match the filter` : '')];
  const context = buildContext(op, `Library: ${totalProjects} project(s), ${totalDesigns} design(s)${(args.search || args.type) ? `; ${matched} match` : ''}`);
  return okResult(op, {
    library: shown,
    total_projects: totalProjects,
    total_designs: totalDesigns,
    matched_designs: matched,
    projects_shown: shown.length,
    projects_truncated: projects.length > limit,
    progress, context,
  });
}

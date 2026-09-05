import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { builtinTemplatesDir, loadBuiltinIndex, resolveBuiltinTemplate, listBuiltinTemplates, installRoots } from './builtin-templates';
import { listTemplates, listTemplateSlots, injectTemplate } from '../engine';

// Point the resolver at the real shipped catalog assets (source tree).
const PUBLIC_BUILTIN = path.resolve('public/templates/builtin');
const INDEX = path.resolve('src/templates/catalog-index.json');
const haveAssets = fs.existsSync(PUBLIC_BUILTIN) && fs.existsSync(INDEX);

let projectsDir: string;

beforeAll(() => {
  process.env['FOLIO_BUILTIN_TEMPLATES_DIR'] = PUBLIC_BUILTIN;
  process.env['FOLIO_BUILTIN_INDEX'] = INDEX;
  projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-builtin-out-'));
  process.env['FOLIO_PROJECTS_DIR'] = projectsDir;
});

afterAll(() => {
  fs.rmSync(projectsDir, { recursive: true, force: true });
});

describe('catalog lookup is anchored to the install, not to process.cwd()', () => {
  // The live server answered "0 templates" forever because both the asset dir
  // and the index were probed relative to cwd. A server started from anywhere
  // but the install root found neither, and list_templates became a dead op.
  it('resolves the install root from the module path, whatever the cwd', () => {
    const here = process.cwd();
    try {
      process.chdir(os.tmpdir());
      const roots = installRoots();
      expect(roots.some(r => fs.existsSync(path.join(r, 'package.json')) && r !== os.tmpdir())).toBe(true);
    } finally {
      process.chdir(here);
    }
  });
});

describe.runIf(haveAssets)('built-in template catalog → MCP bridge', () => {
  it('locates the asset dir + index', () => {
    expect(builtinTemplatesDir()).toBe(PUBLIC_BUILTIN);
    expect(loadBuiltinIndex().length).toBeGreaterThan(100);
  });

  it('resolves a catalog id, a filename, and the builtin: prefix to a real file', () => {
    const byId = resolveBuiltinTemplate('tmpl-1099-form');
    expect(byId).toBeTruthy();
    expect(fs.existsSync(byId!)).toBe(true);
    expect(resolveBuiltinTemplate('builtin:tmpl-1099-form')).toBe(byId);
    expect(resolveBuiltinTemplate('297-1099-form.template.yaml')).toBe(byId);
  });

  it('returns null for unknown ids and for real filesystem paths', () => {
    expect(resolveBuiltinTemplate('tmpl-does-not-exist')).toBeNull();
    expect(resolveBuiltinTemplate('/home/user/my.template.yaml')).toBeNull();
    expect(resolveBuiltinTemplate('designs/foo.design.yaml')).toBeNull();
  });

  it('list_templates filters by search and tag', () => {
    const all = listBuiltinTemplates({});
    expect(all.total).toBeGreaterThan(100);
    const tax = listBuiltinTemplates({ tag: 'tax' });
    expect(tax.total).toBeGreaterThan(0);
    expect(tax.templates.every(t => t.tags.includes('tax'))).toBe(true);
    const search = listBuiltinTemplates({ search: '1099' });
    expect(search.templates.some(t => t.id === 'tmpl-1099-form')).toBe(true);
  });

  it('list_templates tool returns a usable next_action id', () => {
    const r = listTemplates({ search: '1099' }) as Record<string, unknown>;
    expect(r.success).toBe(true);
    const na = r.next_action as { params: { template_path: string } };
    expect(typeof na.params.template_path).toBe('string');
    expect((na.params.template_path).startsWith('tmpl-')).toBe(true);
  });

  it('list_template_slots accepts a catalog id', () => {
    const r = listTemplateSlots({ template_path: 'tmpl-1099-form' }) as Record<string, unknown>;
    expect(r.success).toBe(true);
    expect((r.count as number)).toBeGreaterThanOrEqual(0);
  });

  it('inject_template injects a catalog id and writes the design under the projects dir', () => {
    const r = injectTemplate({ template_path: 'tmpl-1099-form', slots: {} }) as Record<string, unknown>;
    expect(r.success).toBe(true);
    const out = r.design_path as string;
    expect(fs.existsSync(out)).toBe(true);
    // Read-only built-in source: the design lands in the projects dir, never
    // beside the asset.
    expect(path.resolve(out).startsWith(path.resolve(projectsDir))).toBe(true);
  });
});

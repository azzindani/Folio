import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TIER1_TOOLS } from './tier1/registry';
import { TIER2_TOOLS } from './tier2/registry';
import { TIER3_TOOLS } from './tier3/registry';
import { ALL_HANDLERS } from './handlers';
import { remapToolRefs } from './tool-remap';
import { createProject } from './engine';
import type { ToolResult, NextAction } from './types';

const EXPECTED = [
  'get_engine_guide', 'enrich_brief', 'create_project', 'manage_design', 'themes', 'tasks',
  'create_design', 'add_layers', 'edit_layer', 'append_page', 'patch_design', 'seal_design', 'extract_reference',
  'render_preview', 'diagnose_design', 'export_design', 'open_in_editor', 'templates', 'report', 'presentation', 'animation',
];

describe('consolidated 21-tool surface', () => {
  const names = [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS].map(t => t.name);

  it('exposes exactly 21 tools matching the expected set', () => {
    expect(names.length).toBe(21);
    expect(new Set(names)).toEqual(new Set(EXPECTED));
  });

  it('every registered tool has a handler and vice-versa', () => {
    const handlers = Object.keys(ALL_HANDLERS);
    expect(handlers.length).toBe(21);
    expect(names.filter(n => !handlers.includes(n))).toEqual([]);
    expect(handlers.filter(h => !names.includes(h))).toEqual([]);
  });

  it('multiplexed tools declare an op enum + require op', () => {
    for (const n of ['manage_design', 'themes', 'tasks', 'edit_layer', 'templates', 'report', 'presentation', 'animation']) {
      const t = [...TIER1_TOOLS, ...TIER2_TOOLS, ...TIER3_TOOLS].find(x => x.name === n)!;
      const op = (t.inputSchema.properties as Record<string, { enum?: string[] }>)['op'];
      expect(op?.enum?.length, `${n} op enum`).toBeGreaterThan(1);
      expect((t.inputSchema.required as string[]).includes('op'), `${n} requires op`).toBe(true);
    }
  });
});

describe('op dispatch', () => {
  let projectsDir: string;
  let projectPath: string;
  beforeAll(() => {
    projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-consolidated-'));
    process.env['FOLIO_PROJECTS_DIR'] = projectsDir;
    const r = createProject({ name: 'consol-test', canvas: '1080x1080' }) as Record<string, unknown>;
    projectPath = r['path'] as string; // absolute path (unit test bypasses http-layer path normalization)
  });
  afterAll(() => fs.rmSync(projectsDir, { recursive: true, force: true }));

  // A handler may answer synchronously or with a promise (the asset finder
  // reaches the network), so every call site awaits — including these.
  const call = (tool: string, args: Record<string, unknown>): Promise<ToolResult> =>
    Promise.resolve(ALL_HANDLERS[tool](args));

  it('themes op:list routes to the themes engine fn', async () => {
    const r = await call('themes', { op: 'list', project_path: projectPath });
    expect(r.success).toBe(true);
  });

  it('manage_design asset ops route end-to-end (add → list → delete)', async () => {
    const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const add = await call('manage_design', { op: 'asset_add', project_path: projectPath, name: 'dot.png', data: PNG, alt: 'dot' }) as ToolResult & { asset: { path: string } };
    expect(add.success).toBe(true);
    expect(add.asset.path).toBe('assets/images/dot.png');
    const list = await call('manage_design', { op: 'asset_list', project_path: projectPath }) as ToolResult & { assets: { path: string }[] };
    expect(list.success).toBe(true);
    expect(list.assets.map(a => a.path)).toContain('assets/images/dot.png');
    const del = await call('manage_design', { op: 'asset_delete', project_path: projectPath, asset_path: 'assets/images/dot.png' });
    expect(del.success).toBe(true);
  });

  it('an unknown op returns a helpful error listing valid ops', async () => {
    const r = await call('edit_layer', { op: 'frobnicate', design_path: 'x' });
    expect(r.success).toBe(false);
    expect(r.error).toContain('Unknown op');
    expect(r.hint).toContain('add');
  });

  it('a missing op is reported, not silently run', async () => {
    const r = await call('templates', {});
    expect(r.success).toBe(false);
    expect(r.error).toContain('(missing)');
  });
});

describe('forward-hint remap', () => {
  it('rewrites an old next_action tool name to {tool, op}', () => {
    const res = { success: true, progress: [], token_estimate: 0,
      next_action: { tool: 'inject_template', params: { template_path: 'x' }, remaining: 1 } } as ToolResult & { next_action: NextAction };
    remapToolRefs(res);
    expect(res.next_action.tool).toBe('templates');
    expect(res.next_action.params['op']).toBe('inject');
    expect(res.next_action.params['template_path']).toBe('x');
  });

  it('rewrites suggested_next entries + their tier', () => {
    const res: ToolResult = { success: true, progress: [], token_estimate: 0,
      handover: { workflow_step: 'PROJECT', workflow_next: 'THEME', carry_forward: {},
        suggested_next: [{ tool: 'apply_theme', tier: 1, reason: 'r', params: { theme_id: 'x' } }] } };
    remapToolRefs(res);
    expect(res.handover!.suggested_next[0].tool).toBe('themes');
    expect(res.handover!.suggested_next[0].params!['op']).toBe('apply');
  });

  it('leaves kept tool names untouched', () => {
    const res = { success: true, progress: [], token_estimate: 0,
      next_action: { tool: 'seal_design', params: {}, remaining: 1 } } as ToolResult & { next_action: NextAction };
    remapToolRefs(res);
    expect(res.next_action.tool).toBe('seal_design');
  });
});

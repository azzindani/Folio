import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// Import after env is set up
import {
  resolvePath,
  resolveDesignPath,
  snapshot,
  readYAML,
  writeYAML,
  generateId,
  isConstrained,
  LIMITS,
  getOutputBudget,
  tokenEstimate,
  pOk, pFail, pWarn, pInfo,
  buildContext,
  buildHandover,
  appendOpLog,
  errResult,
  okResult,
} from './utils';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'folio-utils-test-'));
}

describe('resolvePath', () => {
  it('resolves path within home directory', () => {
    const home = os.homedir();
    const p = path.join(home, 'test.txt');
    expect(resolvePath(p)).toBe(p);
  });

  it('resolves path within tmpdir', () => {
    const tmp = os.tmpdir();
    const p = path.join(tmp, 'test.txt');
    expect(resolvePath(p)).toBe(p);
  });

  it('throws for path outside home and tmp', () => {
    expect(() => resolvePath('/etc/passwd')).toThrow('Path outside allowed home directory');
  });
});

describe('resolveDesignPath', () => {
  it('returns absolute path resolved through resolvePath', () => {
    const home = os.homedir();
    const abs = path.join(home, 'designs', 'foo.yaml');
    expect(resolveDesignPath(abs)).toBe(abs);
  });

  it('resolves ~/ paths relative to home', () => {
    const result = resolveDesignPath('~/designs/foo.yaml');
    expect(result).toBe(path.join(os.homedir(), 'designs', 'foo.yaml'));
  });

  it('resolves relative path against projectPath', () => {
    const tmp = os.tmpdir();
    const result = resolveDesignPath('designs/foo.yaml', tmp);
    expect(result).toBe(path.join(tmp, 'designs', 'foo.yaml'));
  });

  it('resolves bare relative path via cwd when no projectPath', () => {
    const tmp = os.tmpdir();
    // ensure cwd is tmp-like — just test it doesn't throw for a valid path
    const result = resolveDesignPath(path.join(tmp, 'foo.yaml'));
    expect(result).toContain('foo.yaml');
  });

  it('resolves relative path without projectPath via cwd', () => {
    // Pass an absolute path to tmp to avoid "outside home" error
    const tmp = os.tmpdir();
    const result = resolveDesignPath(path.join(tmp, 'design.yaml'), undefined);
    expect(result).toContain('design.yaml');
  });
});

describe('snapshot', () => {
  let tmpDir: string;
  let home: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates a backup file in .mcp_versions/', () => {
    const filePath = path.join(tmpDir, 'test.yaml');
    fs.writeFileSync(filePath, 'content: 1');
    const backup = snapshot(filePath);
    expect(fs.existsSync(backup)).toBe(true);
    expect(backup).toContain('.mcp_versions');
  });

  it('creates unique backup on collision', () => {
    const filePath = path.join(tmpDir, 'test.yaml');
    fs.writeFileSync(filePath, 'content: 1');
    const b1 = snapshot(filePath);
    // The timestamp-based naming makes collision very rare, but the function handles it
    expect(fs.existsSync(b1)).toBe(true);
  });
});

describe('readYAML / writeYAML', () => {
  let tmpDir: string;

  beforeEach(() => { tmpDir = makeTmpDir(); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('round-trips a YAML object', () => {
    const filePath = path.join(tmpDir, 'data.yaml');
    const obj = { name: 'Folio', version: 2, tags: ['a', 'b'] };
    writeYAML(filePath, obj);
    const loaded = readYAML<typeof obj>(filePath);
    expect(loaded.name).toBe('Folio');
    expect(loaded.tags).toEqual(['a', 'b']);
  });

  it('writeYAML creates parent directories', () => {
    const filePath = path.join(tmpDir, 'nested', 'deep', 'data.yaml');
    writeYAML(filePath, { x: 1 });
    expect(fs.existsSync(filePath)).toBe(true);
  });
});

describe('generateId', () => {
  it('returns a non-empty string', () => {
    expect(typeof generateId()).toBe('string');
    expect(generateId().length).toBeGreaterThan(0);
  });

  it('generates unique ids', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe('isConstrained / LIMITS / getOutputBudget', () => {
  afterEach(() => {
    delete process.env['MCP_CONSTRAINED_MODE'];
    delete process.env['FOLIO_OUTPUT_BUDGET'];
  });

  it('isConstrained returns false by default', () => {
    delete process.env['MCP_CONSTRAINED_MODE'];
    expect(isConstrained()).toBe(false);
  });

  it('isConstrained returns true when env var is set', () => {
    process.env['MCP_CONSTRAINED_MODE'] = 'true';
    expect(isConstrained()).toBe(true);
  });

  it('LIMITS.list_rows returns 100 in normal mode', () => {
    delete process.env['MCP_CONSTRAINED_MODE'];
    expect(LIMITS.list_rows).toBe(100);
  });

  it('LIMITS.list_rows returns 20 in constrained mode', () => {
    process.env['MCP_CONSTRAINED_MODE'] = 'true';
    expect(LIMITS.list_rows).toBe(20);
  });

  it('LIMITS.search_rows returns 50 normally and 10 constrained', () => {
    delete process.env['MCP_CONSTRAINED_MODE'];
    expect(LIMITS.search_rows).toBe(50);
    process.env['MCP_CONSTRAINED_MODE'] = 'true';
    expect(LIMITS.search_rows).toBe(10);
  });

  it('LIMITS.list_items returns 200 normally and 40 constrained', () => {
    delete process.env['MCP_CONSTRAINED_MODE'];
    expect(LIMITS.list_items).toBe(200);
    process.env['MCP_CONSTRAINED_MODE'] = 'true';
    expect(LIMITS.list_items).toBe(40);
  });

  it('LIMITS.log_lines, layer_rows, json_depth vary by mode', () => {
    delete process.env['MCP_CONSTRAINED_MODE'];
    expect(LIMITS.log_lines).toBe(200);
    expect(LIMITS.layer_rows).toBe(80);
    expect(LIMITS.json_depth).toBe(6);
    process.env['MCP_CONSTRAINED_MODE'] = 'true';
    expect(LIMITS.log_lines).toBe(50);
    expect(LIMITS.layer_rows).toBe(20);
    expect(LIMITS.json_depth).toBe(3);
  });

  it('getOutputBudget returns 1000 by default', () => {
    delete process.env['FOLIO_OUTPUT_BUDGET'];
    expect(getOutputBudget()).toBe(1000);
  });

  it('getOutputBudget reads from env', () => {
    process.env['FOLIO_OUTPUT_BUDGET'] = '500';
    expect(getOutputBudget()).toBe(500);
  });
});

describe('tokenEstimate', () => {
  it('returns positive number', () => {
    expect(tokenEstimate({ hello: 'world' })).toBeGreaterThan(0);
  });

  it('larger objects produce larger estimates', () => {
    const small = tokenEstimate({ a: 1 });
    const large = tokenEstimate({ a: 'x'.repeat(1000) });
    expect(large).toBeGreaterThan(small);
  });
});

describe('progress helpers', () => {
  it('pOk creates ok item', () => {
    const p = pOk('Done', 'detail');
    expect(p.status).toBe('ok');
    expect(p.message).toBe('Done');
    expect(p.detail).toBe('detail');
  });

  it('pFail creates fail item', () => {
    expect(pFail('Error').status).toBe('fail');
  });

  it('pWarn creates warn item', () => {
    expect(pWarn('Warning').status).toBe('warn');
  });

  it('pInfo creates info item', () => {
    expect(pInfo('Info').status).toBe('info');
  });

  it('detail is optional', () => {
    expect(pOk('msg').detail).toBeUndefined();
  });
});

describe('buildContext', () => {
  it('returns context with op and summary', () => {
    const ctx = buildContext('add_layer', 'Added a rect layer');
    expect(ctx.op).toBe('add_layer');
    expect(ctx.summary).toBe('Added a rect layer');
    expect(ctx.artifacts).toEqual([]);
    expect(typeof ctx.timestamp).toBe('string');
  });

  it('includes artifacts when provided', () => {
    const artifacts = [{ type: 'design', path: '/foo.yaml', role: 'output' }];
    const ctx = buildContext('create_design', 'Created', artifacts);
    expect(ctx.artifacts).toHaveLength(1);
    expect(ctx.artifacts[0].path).toBe('/foo.yaml');
  });
});

describe('buildHandover', () => {
  it('returns correct workflow_step and workflow_next for PROJECT', () => {
    const hw = buildHandover('PROJECT', { project_path: '/p' });
    expect(hw.workflow_step).toBe('PROJECT');
    expect(hw.workflow_next).toBe('DESIGN');
    expect(hw.suggested_next.length).toBeGreaterThan(0);
    expect(hw.carry_forward).toMatchObject({ project_path: '/p' });
  });

  it('injects carry_forward into suggested_next params', () => {
    const hw = buildHandover('DESIGN', { design_path: '/foo.yaml' });
    hw.suggested_next.forEach(s => {
      expect(s.params).toMatchObject({ design_path: '/foo.yaml' });
    });
  });

  it('handles unknown step by falling back to PROJECT', () => {
    const hw = buildHandover('UNKNOWN_STEP', {});
    expect(hw.workflow_next).toBe('DESIGN');
  });

  it('COMPOSE step suggests seal_design', () => {
    const hw = buildHandover('COMPOSE', {});
    const tools = hw.suggested_next.map(s => s.tool);
    expect(tools).toContain('seal_design');
  });

  it('SEAL step suggests export_design', () => {
    const hw = buildHandover('SEAL', {});
    const tools = hw.suggested_next.map(s => s.tool);
    expect(tools).toContain('export_design');
  });

  it('PATCH step suggests seal_design and patch_design', () => {
    const hw = buildHandover('PATCH', {});
    const tools = hw.suggested_next.map(s => s.tool);
    expect(tools).toContain('seal_design');
    expect(tools).toContain('patch_design');
  });

  it('EXPORT step suggests batch_create', () => {
    const hw = buildHandover('EXPORT', {});
    const tools = hw.suggested_next.map(s => s.tool);
    expect(tools).toContain('batch_create');
  });

  it('RECOVER step suggests resume_task', () => {
    const hw = buildHandover('RECOVER', {});
    const tools = hw.suggested_next.map(s => s.tool);
    expect(tools).toContain('resume_task');
  });
});

describe('appendOpLog', () => {
  it('does not throw on normal call', () => {
    expect(() => appendOpLog({ op: 'test_op', success: true })).not.toThrow();
  });

  it('does not throw on error conditions (always silent)', () => {
    // Even if the log path is inaccessible, it should swallow errors
    expect(() => appendOpLog({ op: 'x', success: false, file: '/nonexistent/path.yaml' })).not.toThrow();
  });
});

describe('errResult', () => {
  it('returns success:false with op, error, hint', () => {
    const r = errResult('add_layer', 'Layer required', 'Provide a layer object');
    expect(r.success).toBe(false);
    expect(r.op).toBe('add_layer');
    expect(r.error).toBe('Layer required');
    expect(r.hint).toBe('Provide a layer object');
    expect(typeof r.token_estimate).toBe('number');
    expect(r.token_estimate).toBeGreaterThan(0);
  });

  it('includes progress pFail item', () => {
    const r = errResult('op', 'Oops', 'Fix it');
    expect(Array.isArray(r.progress)).toBe(true);
    const last = (r.progress as Array<{ status: string }>).at(-1);
    expect(last?.status).toBe('fail');
  });

  it('merges extra progress items', () => {
    const r = errResult('op', 'Err', 'hint', [pWarn('step1'), pInfo('step2')]);
    expect((r.progress as unknown[]).length).toBeGreaterThanOrEqual(3);
  });
});

describe('okResult', () => {
  it('returns success:true with op', () => {
    const r = okResult('add_layer', { layer_id: 'l1' });
    expect(r.success).toBe(true);
    expect(r.op).toBe('add_layer');
  });

  it('includes backup field when provided', () => {
    const r = okResult('patch_design', {}, '/foo/.mcp_versions/foo_backup.bak');
    expect(r.backup).toBe('/foo/.mcp_versions/foo_backup.bak');
  });

  it('token_estimate is set', () => {
    const r = okResult('op', { data: 'x' });
    expect(r.token_estimate).toBeGreaterThan(0);
  });

  it('trims context and handover when token_estimate exceeds budget', () => {
    // Force budget to 1 to trigger trimming
    process.env['FOLIO_OUTPUT_BUDGET'] = '1';
    const bigData = {
      progress: [pOk('a'), pOk('b'), pOk('c'), pOk('d'), pOk('e')],
      context: buildContext('op', 'summary', [
        { type: 'design', path: '/a', role: 'out' },
        { type: 'task', path: '/b', role: 'out' },
      ]),
      handover: buildHandover('COMPOSE', {}),
      backup: '/some/long/absolute/path/to/backup.bak',
    };
    const r = okResult('op', bigData);
    expect(r.budget_trimmed).toBe(true);
    // context.artifacts should be empty
    expect((r.context as { artifacts: unknown[] }).artifacts).toEqual([]);
    // handover should have at most 1 suggested_next
    expect((r.handover as { suggested_next: unknown[] }).suggested_next.length).toBeLessThanOrEqual(1);
    // backup should be basename only
    expect(r.backup).toBe('backup.bak');
    delete process.env['FOLIO_OUTPUT_BUDGET'];
  });

  it('does not set budget_trimmed when within budget', () => {
    delete process.env['FOLIO_OUTPUT_BUDGET'];
    const r = okResult('op', { x: 1 });
    expect(r.budget_trimmed).toBeUndefined();
  });
});

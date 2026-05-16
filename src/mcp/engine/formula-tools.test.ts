import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setFormulaContext, debugFormula, createPresentation } from '../engine';

let tmpDir: string;
beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-formula-mcp-')); });
afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

function makeDesign(): string {
  const r = createPresentation({
    project_path: tmpDir,
    name: 'Test Deck',
    pages: [{ label: 'S1' }],
  });
  return r['design_path'] as string;
}

describe('setFormulaContext', () => {
  it('creates a .formula.json next to the design', () => {
    const dPath = makeDesign();
    const r = setFormulaContext({ design_path: dPath, state: { active: true }, data: { count: 42 } });
    expect(r.success).toBe(true);
    const ctxPath = dPath.replace('.design.yaml', '.formula.json');
    expect(fs.existsSync(ctxPath)).toBe(true);
  });

  it('persists state and data keys', () => {
    const dPath = makeDesign();
    setFormulaContext({ design_path: dPath, state: { x: 10, y: 20 }, data: { rows: [] } });
    const ctxPath = dPath.replace('.design.yaml', '.formula.json');
    const loaded = JSON.parse(fs.readFileSync(ctxPath, 'utf-8')) as { state: Record<string, unknown>; data: Record<string, unknown> };
    expect(loaded.state['x']).toBe(10);
    expect(loaded.data['rows']).toEqual([]);
  });

  it('returns context_path and keys in result', () => {
    const dPath = makeDesign();
    const r = setFormulaContext({ design_path: dPath, state: { v: 1 } });
    expect(r['context_path']).toBeTruthy();
    expect((r['keys'] as { state: string[] }).state).toContain('v');
  });

  it('handles empty state and data', () => {
    const dPath = makeDesign();
    const r = setFormulaContext({ design_path: dPath });
    expect(r.success).toBe(true);
    expect((r['keys'] as { state: string[] }).state).toHaveLength(0);
  });

  it('fails when design does not exist', () => {
    const r = setFormulaContext({ design_path: path.join(tmpDir, 'missing.design.yaml') });
    expect(r.success).toBe(false);
  });

  it('overwrites existing context on re-call', () => {
    const dPath = makeDesign();
    setFormulaContext({ design_path: dPath, state: { x: 1 } });
    setFormulaContext({ design_path: dPath, state: { x: 99 } });
    const ctxPath = dPath.replace('.design.yaml', '.formula.json');
    const loaded = JSON.parse(fs.readFileSync(ctxPath, 'utf-8')) as { state: { x: number } };
    expect(loaded.state.x).toBe(99);
  });
});

describe('debugFormula', () => {
  it('evaluates a simple formula', () => {
    const r = debugFormula({ formula: '=1+2' });
    expect(r.success).toBe(true);
    expect(r['result']).toBe(3);
    expect(r['type']).toBe('number');
  });

  it('evaluates with inline state', () => {
    const r = debugFormula({ formula: '=state.x * 2', state: { x: 10 } });
    expect(r['result']).toBe(20);
  });

  it('evaluates with inline data', () => {
    const r = debugFormula({ formula: '=data.total', data: { total: 999 } });
    expect(r['result']).toBe(999);
  });

  it('fails when formula does not start with =', () => {
    const r = debugFormula({ formula: 'no-equals' });
    expect(r.success).toBe(false);
  });

  it('returns raw formula string on eval error', () => {
    const r = debugFormula({ formula: '=((broken' });
    expect(r.success).toBe(true);
    expect(r['result']).toBe('=((broken');
    expect(r['type']).toBe('string');
  });

  it('loads context from .formula.json if design_path provided', () => {
    const dPath = makeDesign();
    setFormulaContext({ design_path: dPath, state: { score: 42 } });
    const r = debugFormula({ formula: '=state.score', design_path: dPath });
    expect(r['result']).toBe(42);
  });

  it('inline state overrides loaded context', () => {
    const dPath = makeDesign();
    setFormulaContext({ design_path: dPath, state: { v: 10 } });
    const r = debugFormula({ formula: '=state.v', state: { v: 999 }, design_path: dPath });
    expect(r['result']).toBe(999);
  });

  it('returns formula string in result', () => {
    const r = debugFormula({ formula: '=state.x', state: { x: 5 } });
    expect(r['formula']).toBe('=state.x');
  });
});

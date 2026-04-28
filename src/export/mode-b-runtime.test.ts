import { describe, it, expect } from 'vitest';
import {
  evaluateExpression,
  buildInitialState,
  generateModeBRuntime,
} from './mode-b-runtime';
import type { StateDef } from '../schema/types';

describe('buildInitialState', () => {
  it('returns defaults from StateDef map', () => {
    const defs: Record<string, StateDef> = {
      step:    { type: 'number', default: 0 },
      name:    { type: 'string', default: 'Alice' },
      visible: { type: 'boolean', default: true },
    };
    const state = buildInitialState(defs);
    expect(state['step']).toBe(0);
    expect(state['name']).toBe('Alice');
    expect(state['visible']).toBe(true);
  });

  it('falls back to type zero-value when default is missing', () => {
    const defs: Record<string, StateDef> = {
      n: { type: 'number', default: undefined as unknown as number },
      b: { type: 'boolean', default: undefined as unknown as boolean },
      s: { type: 'string', default: undefined as unknown as string },
    };
    const state = buildInitialState(defs);
    expect(state['n']).toBe(0);
    expect(state['b']).toBe(false);
    expect(state['s']).toBe('');
  });

  it('handles empty defs', () => {
    expect(buildInitialState({})).toEqual({});
  });
});

describe('evaluateExpression', () => {
  it('evaluates simple arithmetic', () => {
    expect(evaluateExpression('1 + 2', {})).toBe(3);
  });

  it('reads from state', () => {
    expect(evaluateExpression('state.step + 1', { step: 4 })).toBe(5);
  });

  it('reads from data', () => {
    expect(evaluateExpression('data.total', {}, { total: 42 })).toBe(42);
  });

  it('returns expr string on error', () => {
    const result = evaluateExpression('undefined_fn()', {});
    expect(result).toBe('undefined_fn()');
  });

  it('evaluates template literal', () => {
    const result = evaluateExpression('`Step ${state.step}`', { step: 3 });
    expect(result).toBe('Step 3');
  });
});

describe('generateModeBRuntime', () => {
  it('returns a non-empty JS string', () => {
    const js = generateModeBRuntime({ state: {}, scripts: [] });
    expect(typeof js).toBe('string');
    expect(js.length).toBeGreaterThan(0);
  });

  it('injects initial state JSON', () => {
    const js = generateModeBRuntime({
      state: { step: { type: 'number', default: 7 } },
      scripts: [],
    });
    expect(js).toContain('"step":7');
  });

  it('exposes window.FolioState with set/get/reset/getAll', () => {
    const js = generateModeBRuntime({ state: {}, scripts: [] });
    expect(js).toContain('FolioState');
    expect(js).toContain('set:function');
    expect(js).toContain('get:function');
    expect(js).toContain('reset:function');
    expect(js).toContain('getAll:function');
  });

  it('wires script triggers', () => {
    const js = generateModeBRuntime({
      state: {},
      scripts: [{ id: 'on_next', language: 'javascript', trigger: 'next_btn', code: 'state.set("step",1)' }],
    });
    expect(js).toContain('next_btn');
    expect(js).toContain('on_next');
  });

  it('injects provided dataJson', () => {
    const js = generateModeBRuntime({ state: {}, scripts: [], dataJson: '{"total":99}' });
    expect(js).toContain('"total":99');
  });

  it('patches [data-expr] elements on setState', () => {
    const js = generateModeBRuntime({ state: {}, scripts: [] });
    expect(js).toContain('data-expr');
  });
});

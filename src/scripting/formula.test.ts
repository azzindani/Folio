import { describe, it, expect } from 'vitest';
import {
  isFormula,
  evaluateFormula,
  resolveLayerFormulas,
  resolveAllFormulas,
  buildPagesContext,
} from './formula';

describe('isFormula', () => {
  it('returns true for = prefix', () => {
    expect(isFormula('=1+1')).toBe(true);
  });
  it('returns false for plain string', () => {
    expect(isFormula('hello')).toBe(false);
  });
  it('returns false for non-string', () => {
    expect(isFormula(42)).toBe(false);
    expect(isFormula(null)).toBe(false);
  });
});

describe('evaluateFormula', () => {
  it('evaluates basic arithmetic', () => {
    expect(evaluateFormula('=1+2')).toBe(3);
  });

  it('accesses state context', () => {
    expect(evaluateFormula('=state.count * 2', { state: { count: 5 } })).toBe(10);
  });

  it('accesses data context', () => {
    expect(evaluateFormula('=data.rows.length', { data: { rows: [1, 2, 3] } })).toBe(3);
  });

  it('accesses pages context', () => {
    const pages = [{ id: 'p1', index: 0, active: true }, { id: 'p2', index: 1, active: false }];
    expect(evaluateFormula('=pages.length', { pages })).toBe(2);
  });

  it('uses utils.clamp', () => {
    expect(evaluateFormula('=utils.clamp(state.v, 0, 100)', { state: { v: 150 } })).toBe(100);
  });

  it('uses utils.lerp', () => {
    expect(evaluateFormula('=utils.lerp(0, 100, 0.5)')).toBe(50);
  });

  it('uses utils.round', () => {
    expect(evaluateFormula('=utils.round(3.14159, 2)')).toBe(3.14);
  });

  it('uses utils.percent', () => {
    expect(evaluateFormula('=utils.percent(25, 100)')).toBe(25);
  });

  it('uses utils.px', () => {
    expect(evaluateFormula('=utils.px(42.7)')).toBe('43px');
  });

  it('uses utils.rgba', () => {
    expect(evaluateFormula('=utils.rgba(255, 0, 128, 0.5)')).toBe('rgba(255,0,128,0.5)');
  });

  it('uses utils.if truthy', () => {
    expect(evaluateFormula('=utils.if(true, "yes", "no")')).toBe('yes');
  });

  it('uses utils.if falsy', () => {
    expect(evaluateFormula('=utils.if(false, "yes", "no")')).toBe('no');
  });

  it('uses utils.coerce to number', () => {
    expect(evaluateFormula('=utils.coerce("42", "number")')).toBe(42);
  });

  it('blocks window access — returns raw formula on error', () => {
    const result = evaluateFormula('=window.location');
    expect(result).toBe('=window.location');
  });

  it('blocks document access — returns raw formula on error', () => {
    const result = evaluateFormula('=document.cookie');
    expect(result).toBe('=document.cookie');
  });

  it('blocks eval — returns raw formula on error', () => {
    const result = evaluateFormula('=eval("1+1")');
    expect(result).toBe('=eval("1+1")');
  });

  it('returns raw formula string on syntax error', () => {
    const result = evaluateFormula('=((broken');
    expect(result).toBe('=((broken');
  });

  it('handles empty context gracefully', () => {
    expect(evaluateFormula('=state.x ?? 0')).toBe(0);
  });

  it('evaluates ternary expression', () => {
    expect(evaluateFormula("=state.active ? '#6c5ce7' : '#636e72'", { state: { active: true } })).toBe('#6c5ce7');
  });
});

describe('resolveLayerFormulas', () => {
  it('returns layer unchanged when no formulas key', () => {
    const layer = { id: 'l1', type: 'text', fill: '#fff' };
    expect(resolveLayerFormulas(layer, {})).toEqual(layer);
  });

  it('evaluates formula properties and merges into layer', () => {
    const layer = { id: 'l1', type: 'rect', fill: '#000', formulas: { fill: "=state.active ? 'red' : 'blue'" } };
    const result = resolveLayerFormulas(layer, { state: { active: false } });
    expect(result['fill']).toBe('blue');
  });

  it('passes non-formula values through unchanged', () => {
    const layer = { id: 'l1', formulas: { label: 'static text' } };
    const result = resolveLayerFormulas(layer, {});
    expect(result['label']).toBe('static text');
  });
});

describe('resolveAllFormulas', () => {
  it('resolves formulas across a flat layer list', () => {
    const layers = [
      { id: 'a', type: 'rect', formulas: { opacity: '=state.v' } },
      { id: 'b', type: 'text' },
    ];
    const result = resolveAllFormulas(layers, { state: { v: 0.5 } });
    expect(result[0]['opacity']).toBe(0.5);
    expect(result[1]['id']).toBe('b');
  });

  it('recursively resolves nested group layers', () => {
    const layers = [
      {
        id: 'g1', type: 'group',
        layers: [{ id: 'c1', type: 'rect', formulas: { fill: "='#f00'" } }],
      },
    ];
    const result = resolveAllFormulas(layers, {});
    const nested = (result[0]['layers'] as Record<string, unknown>[])[0];
    expect(nested['fill']).toBe('#f00');
  });

  it('does not mutate original layers', () => {
    const layers: Record<string, unknown>[] = [{ id: 'l1', formulas: { x: '=10+5' } }];
    resolveAllFormulas(layers, {});
    expect(layers[0]['x']).toBeUndefined();
  });
});

describe('buildPagesContext', () => {
  it('builds pages context with correct active flag', () => {
    const pages = [{ id: 'p1', label: 'Slide 1' }, { id: 'p2', label: 'Slide 2' }];
    const ctx = buildPagesContext(pages, 1);
    expect(ctx).toEqual([
      { id: 'p1', index: 0, active: false },
      { id: 'p2', index: 1, active: true },
    ]);
  });

  it('returns empty array for empty pages', () => {
    expect(buildPagesContext([], 0)).toEqual([]);
  });
});

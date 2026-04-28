import { describe, it, expect } from 'vitest';
import { coerceOp, dualKey, asString, asNumber } from './coerce';

describe('coerceOp', () => {
  it('returns raw unchanged when op is already a non-empty string', () => {
    const raw = { op: 'add_layer', layer: { type: 'rect' } };
    expect(coerceOp(raw)).toBe(raw);
  });

  it('infers append_page from page_id key', () => {
    const result = coerceOp({ page_id: 'p1', label: 'Page 1', layers: [] });
    expect(result['op']).toBe('append_page');
  });

  it('infers patch_design from selectors key', () => {
    const result = coerceOp({ selectors: ['#layer1'] });
    expect(result['op']).toBe('patch_design');
  });

  it('infers update_layer from layer_id + props keys', () => {
    const result = coerceOp({ layer_id: 'l1', props: { fill: 'red' } });
    expect(result['op']).toBe('update_layer');
  });

  it('infers update_layer from layer key alone (update_layer sig matches layer before add_layer)', () => {
    // update_layer sig = {layer, layer_id, props} — 'layer' key matches it first
    const result = coerceOp({ layer: { type: 'text', content: 'hi' } });
    expect(result['op']).toBe('update_layer');
  });

  it('infers update_layer from layer_id alone (update_layer signature has higher priority)', () => {
    // update_layer sig = {layer, layer_id, props} — layer_id matches it first
    const result = coerceOp({ layer_id: 'abc' });
    expect(result['op']).toBe('update_layer');
  });

  it('infers batch_create from slots_array + template_id', () => {
    const result = coerceOp({ slots_array: [], template_id: 'tmpl1' });
    expect(result['op']).toBe('batch_create');
  });

  it('infers save_as_component from layer_ids + component_name', () => {
    const result = coerceOp({ layer_ids: ['l1'], component_name: 'MyBtn' });
    expect(result['op']).toBe('save_as_component');
  });

  it('infers inject_template from slots key', () => {
    const result = coerceOp({ slots: { title: 'Hello' } });
    expect(result['op']).toBe('inject_template');
  });

  it('returns empty string op when no signature matches', () => {
    const result = coerceOp({ unknown_key: 'value' });
    expect(result['op']).toBe('');
  });

  it('merges nested op object with top-level params', () => {
    const raw = { op: { layer_id: 'l1', props: { fill: 'blue' } }, design_path: '/foo' };
    const result = coerceOp(raw);
    expect(result['op']).toBe('update_layer');
    expect(result['layer_id']).toBe('l1');
    expect(result['props']).toEqual({ fill: 'blue' });
    // design_path should be carried forward
    expect(result['design_path']).toBe('/foo');
  });

  it('nested op object does not override its own keys with top-level', () => {
    // design_path is in both nested op and top level — nested takes precedence
    const raw = { op: { layer_id: 'l1', design_path: 'inner' }, design_path: 'outer' };
    const result = coerceOp(raw);
    expect(result['design_path']).toBe('inner');
  });

  it('handles null op (treats as no-op string)', () => {
    const result = coerceOp({ op: null as unknown as string, selectors: [] });
    expect(result['op']).toBe('patch_design');
  });

  it('handles op as empty string (falsy), infers from params', () => {
    const result = coerceOp({ op: '', layer_id: 'x' });
    // layer_id matches update_layer signature (higher priority than remove_layer)
    expect(result['op']).toBe('update_layer');
  });
});

describe('dualKey', () => {
  it('returns value from primary key', () => {
    expect(dualKey<string>({ primary: 'hello', fallback: 'world' }, 'primary', 'fallback')).toBe('hello');
  });

  it('returns value from fallback when primary is absent', () => {
    expect(dualKey<string>({ fallback: 'world' }, 'primary', 'fallback')).toBe('world');
  });

  it('returns undefined when neither key exists', () => {
    expect(dualKey<string>({}, 'primary', 'fallback')).toBeUndefined();
  });

  it('falls through to fallback when primary is null (nullish coalescing)', () => {
    // ?? treats null as nullish, so fallback is used
    expect(dualKey<string>({ primary: null, fallback: 'fb' } as Record<string, unknown>, 'primary', 'fallback')).toBe('fb');
  });
});

describe('asString', () => {
  it('returns string value', () => {
    expect(asString({ name: 'Alice' }, 'name')).toBe('Alice');
  });

  it('returns fallback for missing key', () => {
    expect(asString({}, 'name', 'default')).toBe('default');
  });

  it('returns empty string default when no fallback provided', () => {
    expect(asString({}, 'name')).toBe('');
  });

  it('returns fallback for non-string value', () => {
    expect(asString({ count: 42 }, 'count', 'fallback')).toBe('fallback');
  });

  it('returns fallback for null value', () => {
    expect(asString({ x: null }, 'x', 'fb')).toBe('fb');
  });
});

describe('asNumber', () => {
  it('returns number value directly', () => {
    expect(asNumber({ n: 42 }, 'n', 0)).toBe(42);
  });

  it('coerces numeric string to number', () => {
    expect(asNumber({ n: '3.14' }, 'n', 0)).toBe(3.14);
  });

  it('returns fallback for non-numeric string', () => {
    expect(asNumber({ n: 'abc' }, 'n', 99)).toBe(99);
  });

  it('returns fallback for missing key', () => {
    expect(asNumber({}, 'n', 7)).toBe(7);
  });

  it('returns fallback for null', () => {
    expect(asNumber({ n: null }, 'n', 5)).toBe(5);
  });

  it('returns fallback for boolean', () => {
    expect(asNumber({ n: true }, 'n', 3)).toBe(3);
  });

  it('handles zero correctly', () => {
    expect(asNumber({ n: 0 }, 'n', 99)).toBe(0);
  });

  it('coerces string "0" to 0', () => {
    expect(asNumber({ n: '0' }, 'n', 99)).toBe(0);
  });
});

import { describe, it, expect } from 'vitest';
import { toMCPResult } from './types';

describe('toMCPResult', () => {
  it('wraps successful result in content array', () => {
    const result = toMCPResult({ success: true, op: 'add_layer', progress: [], token_estimate: 50 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBe(false);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.success).toBe(true);
  });

  it('sets isError:true when success is false', () => {
    const result = toMCPResult({ success: false, op: 'op', error: 'fail', hint: 'fix', progress: [], token_estimate: 10 });
    expect(result.isError).toBe(true);
  });

  it('serializes all fields in text', () => {
    const result = toMCPResult({ success: true, op: 'list_designs', designs: ['a', 'b'], progress: [], token_estimate: 20 });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.designs).toEqual(['a', 'b']);
  });
});

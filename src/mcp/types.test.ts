import { describe, it, expect } from 'vitest';
import { toMCPResult } from './types';

describe('toMCPResult', () => {
  it('wraps successful result in content array', () => {
    const result = toMCPResult({ success: true, op: 'add_layer', progress: [], token_estimate: 50 });
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');
    expect(result.isError).toBe(false);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.success).toBe(true);
  });

  it('sets isError:true when success is false', () => {
    const result = toMCPResult({ success: false, op: 'op', error: 'fail', hint: 'fix', progress: [], token_estimate: 10 });
    expect(result.isError).toBe(true);
  });

  it('serializes all fields in text', () => {
    const result = toMCPResult({ success: true, op: 'list_designs', designs: ['a', 'b'], progress: [], token_estimate: 20 });
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed.designs).toEqual(['a', 'b']);
  });

  it('appends image attachments after the text block', () => {
    const result = toMCPResult({
      success: true,
      op: 'export_design',
      progress: [],
      token_estimate: 10,
      _attachments: [
        { type: 'image', data: 'PHN2Zy8+', mimeType: 'image/svg+xml' },
      ],
    });
    expect(result.content).toHaveLength(2);
    expect(result.content[0].type).toBe('text');
    expect(result.content[1]).toEqual({ type: 'image', data: 'PHN2Zy8+', mimeType: 'image/svg+xml' });
  });

  it('appends resource attachments and strips _attachments from JSON', () => {
    const result = toMCPResult({
      success: true,
      op: 'open_in_editor',
      progress: [],
      token_estimate: 5,
      url: 'http://localhost:4173/?file=foo',
      _attachments: [
        { type: 'resource', resource: { uri: 'http://localhost:4173/?file=foo', mimeType: 'text/html', text: 'Open' } },
      ],
    });
    expect(result.content).toHaveLength(2);
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    expect(parsed._attachments).toBeUndefined();
    expect(parsed.url).toBe('http://localhost:4173/?file=foo');
    expect(result.content[1]).toMatchObject({ type: 'resource' });
  });
});

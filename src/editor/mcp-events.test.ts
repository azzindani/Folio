// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { parseMCPParams } from './mcp-events';

describe('parseMCPParams', () => {
  it('extracts mcpUrl, designPath and page', () => {
    const out = parseMCPParams('?mcp_url=http%3A%2F%2Flocalhost%3A3333&file=%2Ftmp%2Ffoo.design.yaml&page=2');
    expect(out.mcpUrl).toBe('http://localhost:3333');
    expect(out.designPath).toBe('/tmp/foo.design.yaml');
    expect(out.page).toBe(2);
  });

  it('returns empty object when nothing relevant is set', () => {
    expect(parseMCPParams('')).toEqual({});
    expect(parseMCPParams('?foo=bar')).toEqual({});
  });

  it('rejects non-numeric pages', () => {
    expect(parseMCPParams('?page=abc').page).toBeUndefined();
  });
});

import { describe, it, expect } from 'vitest';
import { handleMCP } from './http-server';
import { META, LATEST_PROTOCOL_VERSION, MCP_ERROR } from './protocol';
import type { MCPRequest } from './types';

// Wire-contract tests for the dual-era MCP endpoint. The point of these is the
// era boundary: a legacy response must keep the exact shape it had before
// 2026-07-28 support landed, because every client talking to Folio today is on
// that path. Anything modern is additive and must not leak into it.

const req = (method: string, params?: Record<string, unknown>): MCPRequest =>
  ({ jsonrpc: '2.0', id: 1, method, ...(params ? { params } : {}) });

const resultOf = async (r: MCPRequest, modern = false): Promise<Record<string, unknown>> => {
  const { response } = await handleMCP(r, modern);
  return (response.result ?? {}) as Record<string, unknown>;
};

describe('legacy era', () => {
  it('echoes the revision the client asked for', async () => {
    const r = await resultOf(req('initialize', { protocolVersion: '2025-06-18' }));
    expect(r['protocolVersion']).toBe('2025-06-18');
    expect(r['capabilities']).toEqual({ tools: {} });
    expect(r['serverInfo']).toMatchObject({ name: 'folio-mcp-http' });
  });

  it('falls back to the newest handshake revision for anything it cannot serve', async () => {
    expect((await resultOf(req('initialize', { protocolVersion: '1999-01-01' })))['protocolVersion'])
      .toBe('2025-11-25');
    // A modern version named in a handshake is still a handshake.
    expect((await resultOf(req('initialize', { protocolVersion: LATEST_PROTOCOL_VERSION })))['protocolVersion'])
      .toBe('2025-11-25');
    expect((await resultOf(req('initialize')))['protocolVersion']).toBe('2025-11-25');
  });

  it('returns a bare tools list — no modern fields leak in', async () => {
    const r = await resultOf(req('tools/list'));
    expect(Array.isArray(r['tools'])).toBe(true);
    expect((r['tools'] as unknown[]).length).toBeGreaterThan(0);
    expect(r).not.toHaveProperty('resultType');
    expect(r).not.toHaveProperty('ttlMs');
    expect(r).not.toHaveProperty('cacheScope');
    expect(r).not.toHaveProperty('_meta');
  });

  it('returns tool results in the unstamped shape', async () => {
    const r = await resultOf(req('tools/call', { name: 'no_such_tool', arguments: {} }));
    expect(r['isError']).toBe(true);
    expect(Array.isArray(r['content'])).toBe(true);
    expect(r).not.toHaveProperty('resultType');
  });
});

describe('modern era', () => {
  it('stamps tool results with resultType and server identity', async () => {
    const r = await resultOf(req('tools/call', { name: 'no_such_tool', arguments: {} }), true);
    expect(r['resultType']).toBe('complete');
    expect(r['isError']).toBe(true);
    const meta = r['_meta'] as Record<string, unknown>;
    expect(meta[META.serverInfo]).toMatchObject({ name: 'folio-mcp-http' });
  });

  it('makes the tools list cacheable', async () => {
    const r = await resultOf(req('tools/list'), true);
    expect(r['resultType']).toBe('complete');
    expect(r['ttlMs']).toBeGreaterThan(0);
    // Authenticated endpoint — a shared cache must not hold this.
    expect(r['cacheScope']).toBe('private');
    expect(Array.isArray(r['tools'])).toBe(true);
  });

  it('serves the same tool list in both eras', async () => {
    const legacy = (await resultOf(req('tools/list')))['tools'] as { name: string }[];
    const modern = (await resultOf(req('tools/list'), true))['tools'] as { name: string }[];
    expect(modern.map(t => t.name)).toEqual(legacy.map(t => t.name));
  });
});

describe('server/discover', () => {
  it('advertises supported versions, capabilities and identity', async () => {
    const r = await resultOf(req('server/discover'), true);
    const versions = r['supportedVersions'] as string[];
    expect(versions[0]).toBe(LATEST_PROTOCOL_VERSION);
    expect(versions).toContain('2025-11-25');
    expect(r['capabilities']).toEqual({ tools: {} });
    expect(r['resultType']).toBe('complete');
    expect(typeof r['instructions']).toBe('string');
    const meta = r['_meta'] as Record<string, unknown>;
    expect(meta[META.serverInfo]).toMatchObject({ name: 'folio-mcp-http' });
  });

  // Servers MUST implement it, and a dual-era client may probe with it before
  // it knows which era we are — so it cannot be gated on the modern path.
  it('answers in the legacy era too', async () => {
    const { response } = await handleMCP(req('server/discover'), false);
    expect(response.error).toBeUndefined();
    expect((response.result as Record<string, unknown>)['supportedVersions']).toBeDefined();
  });
});

describe('unknown methods', () => {
  it('reports method-not-found with the JSON-RPC code', async () => {
    const { response } = await handleMCP(req('resources/subscribe'), true);
    expect(response.error?.code).toBe(MCP_ERROR.MethodNotFound);
    expect(response.error?.code).toBe(-32601);
  });
});

import { describe, it, expect } from 'vitest';
import {
  readHeader, decodeHeaderValue, isSupportedVersion, isModernVersion,
  requestedVersion, isModernRequest, validateModernHeaders,
  unsupportedVersionError, headerMismatchError, completeResult, withCacheHints,
  discoverResult, META, MCP_ERROR, FOLIO_ERROR, LATEST_PROTOCOL_VERSION,
} from './protocol';

const ID = { name: 'folio-mcp-http', version: '0.1.2' };
const modernMeta = { [META.protocolVersion]: LATEST_PROTOCOL_VERSION };

/** Header bag minus one header — for the "required header is missing" cases. */
const without = (bag: Record<string, string>, drop: string): Record<string, string> =>
  Object.fromEntries(Object.entries(bag).filter(([k]) => k !== drop));

describe('header access', () => {
  it('matches header names case-insensitively', () => {
    expect(readHeader({ 'mcp-method': 'tools/call' }, 'Mcp-Method')).toBe('tools/call');
    expect(readHeader({ 'MCP-Protocol-Version': '2026-07-28' }, 'mcp-protocol-version')).toBe('2026-07-28');
  });
  it('is empty for an absent header', () => {
    expect(readHeader({}, 'Mcp-Name')).toBe('');
  });
  it('decodes the base64 sentinel and passes plain values through', () => {
    const encoded = `=?base64?${Buffer.from('Hello, 世界', 'utf-8').toString('base64')}?=`;
    expect(decodeHeaderValue(encoded)).toBe('Hello, 世界');
    expect(decodeHeaderValue('get_weather')).toBe('get_weather');
    // Markers are case-sensitive — an almost-sentinel is a literal value.
    expect(decodeHeaderValue('=?BASE64?abc?=')).toBe('=?BASE64?abc?=');
  });
});

describe('version resolution', () => {
  it('knows which revisions we serve', () => {
    expect(isSupportedVersion('2026-07-28')).toBe(true);
    expect(isSupportedVersion('2024-11-05')).toBe(true);
    expect(isSupportedVersion('1900-01-01')).toBe(false);
  });
  it('treats revisions as dates, so ordering is chronological', () => {
    expect(isModernVersion('2026-07-28')).toBe(true);
    expect(isModernVersion('2027-01-01')).toBe(true);
    expect(isModernVersion('2025-11-25')).toBe(false);
  });
  it('prefers the version in _meta over the header', () => {
    const h = { 'mcp-protocol-version': '2025-11-25' };
    expect(requestedVersion(h, { _meta: modernMeta })).toBe(LATEST_PROTOCOL_VERSION);
    expect(requestedVersion(h, {})).toBe('2025-11-25');
    expect(requestedVersion({}, {})).toBe('');
  });
});

describe('era selection', () => {
  it('serves a modern request modern', () => {
    expect(isModernRequest({ 'mcp-protocol-version': '2026-07-28' }, 'tools/list', {})).toBe(true);
    expect(isModernRequest({}, 'tools/call', { _meta: modernMeta })).toBe(true);
  });

  // The regression that would break every client already talking to us: an
  // initialize handshake selects legacy no matter what version it names.
  it('never treats a handshake as modern', () => {
    expect(isModernRequest({ 'mcp-protocol-version': '2026-07-28' }, 'initialize', {})).toBe(false);
    expect(isModernRequest({}, 'notifications/initialized', {})).toBe(false);
  });
  it('leaves older and version-less clients on the legacy path', () => {
    expect(isModernRequest({ 'mcp-protocol-version': '2025-11-25' }, 'tools/list', {})).toBe(false);
    expect(isModernRequest({}, 'tools/list', {})).toBe(false);
    expect(isModernRequest({}, 'tools/list', undefined)).toBe(false);
  });
});

describe('modern header validation', () => {
  const ok = {
    'mcp-protocol-version': LATEST_PROTOCOL_VERSION,
    'mcp-method': 'tools/call',
    'mcp-name': 'create_design',
  };
  const body = { name: 'create_design', arguments: {}, _meta: modernMeta };

  it('accepts headers that mirror the body', () => {
    expect(validateModernHeaders(ok, 'tools/call', body)).toBeNull();
  });
  it('accepts a base64-encoded Mcp-Name', () => {
    const enc = `=?base64?${Buffer.from('create_design', 'utf-8').toString('base64')}?=`;
    expect(validateModernHeaders({ ...ok, 'mcp-name': enc }, 'tools/call', body)).toBeNull();
  });
  it('requires the protocol version header', () => {
    expect(validateModernHeaders(without(ok, 'mcp-protocol-version'), 'tools/call', body))
      .toMatch(/MCP-Protocol-Version/);
  });
  it('rejects a header that disagrees with the body', () => {
    expect(validateModernHeaders({ ...ok, 'mcp-protocol-version': '2025-11-25' }, 'tools/call', body))
      .toMatch(/does not match body value/);
    expect(validateModernHeaders({ ...ok, 'mcp-method': 'tools/list' }, 'tools/call', body))
      .toMatch(/Mcp-Method/);
    expect(validateModernHeaders({ ...ok, 'mcp-name': 'other_tool' }, 'tools/call', body))
      .toMatch(/Mcp-Name/);
  });
  it('requires Mcp-Name only for the methods that mirror a name', () => {
    const noName = without(ok, 'mcp-name');
    expect(validateModernHeaders({ ...noName, 'mcp-method': 'tools/list' }, 'tools/list', { _meta: modernMeta })).toBeNull();
    expect(validateModernHeaders(noName, 'tools/call', body)).toMatch(/Mcp-Name header is required/);
  });
  it('mirrors params.uri for resources/read', () => {
    const h = { ...ok, 'mcp-method': 'resources/read', 'mcp-name': 'file:///a.yaml' };
    expect(validateModernHeaders(h, 'resources/read', { uri: 'file:///a.yaml', _meta: modernMeta })).toBeNull();
    expect(validateModernHeaders(h, 'resources/read', { uri: 'file:///b.yaml', _meta: modernMeta }))
      .toMatch(/does not match/);
  });
});

describe('errors', () => {
  it('lists supported versions so the client can fall forward', () => {
    const e = unsupportedVersionError('1900-01-01');
    expect(e.code).toBe(MCP_ERROR.UnsupportedProtocolVersion);
    expect(e.code).toBe(-32022);
    const data = e.data as { supported: string[]; requested: string };
    expect(data.supported).toContain(LATEST_PROTOCOL_VERSION);
    expect(data.requested).toBe('1900-01-01');
  });
  it('uses the reserved code for header mismatches', () => {
    expect(headerMismatchError('nope').code).toBe(-32020);
  });
  // -32020..-32099 belongs to the spec now; ours must stay below it.
  it('keeps Folio codes out of the reserved band', () => {
    for (const code of Object.values(FOLIO_ERROR)) {
      expect(code).toBeGreaterThan(-32020);
      expect(code).toBeLessThanOrEqual(-32000);
    }
  });
});

describe('result shaping', () => {
  it('stamps resultType and server identity', () => {
    const r = completeResult({ tools: [] }, ID);
    expect(r['resultType']).toBe('complete');
    expect((r['_meta'] as Record<string, unknown>)[META.serverInfo]).toEqual(ID);
  });
  it('preserves a _meta the result already carried', () => {
    const r = completeResult({ _meta: { keep: 1 } }, ID);
    const meta = r['_meta'] as Record<string, unknown>;
    expect(meta['keep']).toBe(1);
    expect(meta[META.serverInfo]).toEqual(ID);
  });
  it('adds cache hints', () => {
    expect(withCacheHints({ tools: [] }, 300_000, 'private'))
      .toMatchObject({ ttlMs: 300_000, cacheScope: 'private' });
  });
  it('builds a DiscoverResult with versions, capabilities and cache hints', () => {
    const d = discoverResult(ID, { tools: {} }, 'Folio design engine.');
    expect(d['supportedVersions']).toContain(LATEST_PROTOCOL_VERSION);
    expect(d['capabilities']).toEqual({ tools: {} });
    expect(d['instructions']).toBe('Folio design engine.');
    expect(d['resultType']).toBe('complete');
    expect(d['cacheScope']).toBe('public');
    expect(d['ttlMs']).toBeGreaterThan(0);
  });
  it('omits instructions when there are none', () => {
    expect(discoverResult(ID, { tools: {} })).not.toHaveProperty('instructions');
  });
});

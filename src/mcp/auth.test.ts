import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { authorize, describeAuth, loadTokens, _resetForTests } from './auth';
import type * as http from 'http';

function fakeReq(authHeader?: string): http.IncomingMessage {
  return { headers: authHeader ? { authorization: authHeader } : {} } as unknown as http.IncomingMessage;
}

const ENV_KEYS = ['FOLIO_TOKENS_FILE', 'FOLIO_TOKENS', 'FOLIO_API_KEY'] as const;

describe('mcp/auth', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    _resetForTests();
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
    _resetForTests();
  });

  it('open mode when no env is set — authorize returns the open sentinel', () => {
    expect(loadTokens().mode).toBe('open');
    expect(authorize(fakeReq())).toBe('__open__');
    expect(authorize(fakeReq('Bearer anything'))).toBe('__open__');
  });

  it('single-key mode honours FOLIO_API_KEY and rejects mismatches', () => {
    process.env['FOLIO_API_KEY'] = 'sk-test';
    _resetForTests();
    expect(loadTokens().mode).toBe('single');
    expect(authorize(fakeReq('Bearer sk-test'))).toBe('default');
    expect(authorize(fakeReq('Bearer wrong'))).toBeNull();
    expect(authorize(fakeReq())).toBeNull();
  });

  it('FOLIO_TOKENS inline form maps each bearer to its name', () => {
    process.env['FOLIO_TOKENS'] = 'claude:sk-aaa,hermes:sk-bbb';
    _resetForTests();
    expect(loadTokens().mode).toBe('multi');
    expect(authorize(fakeReq('Bearer sk-aaa'))).toBe('claude');
    expect(authorize(fakeReq('Bearer sk-bbb'))).toBe('hermes');
    expect(authorize(fakeReq('Bearer sk-ccc'))).toBeNull();
  });

  it('FOLIO_TOKENS_FILE loads named tokens from a JSON file', () => {
    const file = path.join(os.tmpdir(), `folio-tokens-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ alpha: 'sk-alpha', beta: 'sk-beta' }), 'utf-8');
    process.env['FOLIO_TOKENS_FILE'] = file;
    _resetForTests();
    try {
      expect(loadTokens().mode).toBe('multi');
      expect(authorize(fakeReq('Bearer sk-alpha'))).toBe('alpha');
      expect(authorize(fakeReq('Bearer sk-beta'))).toBe('beta');
      expect(authorize(fakeReq('Bearer sk-x'))).toBeNull();
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('FOLIO_TOKENS_FILE wins when both file and inline are set', () => {
    const file = path.join(os.tmpdir(), `folio-tokens-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify({ fromfile: 'sk-file' }), 'utf-8');
    process.env['FOLIO_TOKENS_FILE'] = file;
    process.env['FOLIO_TOKENS']      = 'fromenv:sk-env';
    _resetForTests();
    try {
      expect(authorize(fakeReq('Bearer sk-file'))).toBe('fromfile');
      expect(authorize(fakeReq('Bearer sk-env'))).toBeNull();
    } finally {
      fs.unlinkSync(file);
    }
  });

  it('rejects non-Bearer schemes', () => {
    process.env['FOLIO_API_KEY'] = 'sk-test';
    _resetForTests();
    expect(authorize(fakeReq('Token sk-test'))).toBeNull();
    expect(authorize(fakeReq('Basic c2s6dGVzdA=='))).toBeNull();
  });

  it('describeAuth produces a human-readable summary per mode', () => {
    _resetForTests();
    expect(describeAuth()).toMatch(/UNAUTHENTICATED/);

    process.env['FOLIO_API_KEY'] = 'sk-x'; _resetForTests();
    expect(describeAuth()).toMatch(/single shared bearer/);

    delete process.env['FOLIO_API_KEY'];
    process.env['FOLIO_TOKENS'] = 'a:1,b:2'; _resetForTests();
    expect(describeAuth()).toMatch(/2 named token/);
  });
});

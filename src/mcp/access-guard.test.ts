import { describe, it, expect } from 'vitest';
import { clientIp, parseAllowList, ipAllowed, createConcurrencyGate, loadEditorGuards } from './access-guard';

describe('clientIp — proxy-aware, anti-spoof', () => {
  it('trusts the LAST X-Forwarded-For hop (the proxy-appended real peer)', () => {
    // A client injecting a fake leftmost value can't move the last hop.
    expect(clientIp('1.2.3.4')).toBe('1.2.3.4');
    expect(clientIp('9.9.9.9, 1.2.3.4')).toBe('1.2.3.4');
    expect(clientIp('spoofed, 10.0.0.1, 203.0.113.7')).toBe('203.0.113.7');
  });
  it('falls back to the socket address when there is no XFF', () => {
    expect(clientIp(null, '198.51.100.2')).toBe('198.51.100.2');
    expect(clientIp('', '198.51.100.2')).toBe('198.51.100.2');
    expect(clientIp(undefined, undefined)).toBe('unknown');
  });
  it('normalizes IPv4-mapped IPv6 to plain IPv4', () => {
    expect(clientIp('::ffff:192.168.1.5')).toBe('192.168.1.5');
    expect(clientIp(null, '::ffff:10.0.0.9')).toBe('10.0.0.9');
  });
});

describe('IP allow-list', () => {
  it('empty list allows everything (open default)', () => {
    expect(ipAllowed('1.2.3.4', parseAllowList(''))).toBe(true);
    expect(ipAllowed('1.2.3.4', parseAllowList(undefined))).toBe(true);
  });
  it('exact IPv4 match', () => {
    const list = parseAllowList('203.0.113.7');
    expect(ipAllowed('203.0.113.7', list)).toBe(true);
    expect(ipAllowed('203.0.113.8', list)).toBe(false);
  });
  it('IPv4 CIDR match', () => {
    const list = parseAllowList('10.0.0.0/24');
    expect(ipAllowed('10.0.0.1', list)).toBe(true);
    expect(ipAllowed('10.0.0.255', list)).toBe(true);
    expect(ipAllowed('10.0.1.1', list)).toBe(false);
  });
  it('accepts comma/space lists + mixes exact and CIDR; skips junk', () => {
    const list = parseAllowList('203.0.113.7, 192.168.0.0/16  not-an-ip');
    expect(ipAllowed('203.0.113.7', list)).toBe(true);
    expect(ipAllowed('192.168.5.5', list)).toBe(true);
    expect(ipAllowed('8.8.8.8', list)).toBe(false);
  });
  it('matches a v4-mapped-v6 peer against a v4 allow entry', () => {
    const list = parseAllowList('192.168.1.5');
    expect(ipAllowed('::ffff:192.168.1.5', list)).toBe(true);
  });
  it('a /32 is a single host; a broad CIDR is honored', () => {
    expect(ipAllowed('1.2.3.4', parseAllowList('1.2.3.4/32'))).toBe(true);
    expect(ipAllowed('1.2.3.5', parseAllowList('1.2.3.4/32'))).toBe(false);
    expect(ipAllowed('1.2.3.5', parseAllowList('0.0.0.0/0'))).toBe(true);
  });
});

describe('concurrency gate', () => {
  it('admits up to max, refuses beyond, frees on release', () => {
    const g = createConcurrencyGate(2);
    expect(g.tryAcquire()).toBe(true);
    expect(g.tryAcquire()).toBe(true);
    expect(g.tryAcquire()).toBe(false); // full
    expect(g.inFlight()).toBe(2);
    g.release();
    expect(g.tryAcquire()).toBe(true);
  });
  it('max<=0 means unlimited', () => {
    const g = createConcurrencyGate(0);
    for (let i = 0; i < 100; i++) expect(g.tryAcquire()).toBe(true);
  });
  it('release never goes negative', () => {
    const g = createConcurrencyGate(1);
    g.release(); g.release();
    expect(g.inFlight()).toBe(0);
    expect(g.tryAcquire()).toBe(true);
  });
});

describe('loadEditorGuards from env', () => {
  it('defaults: open allow-list, limiter on, heavy gate set', () => {
    const g = loadEditorGuards({});
    expect(g.allowListActive).toBe(false);
    expect(ipAllowed('1.2.3.4', g.allow)).toBe(true);
    expect(g.limiter).not.toBeNull();
    expect(g.heavy.max).toBe(8);
  });
  it('FOLIO_ALLOW_IPS activates the allow-list', () => {
    const g = loadEditorGuards({ FOLIO_ALLOW_IPS: '203.0.113.7, 10.0.0.0/8' });
    expect(g.allowListActive).toBe(true);
    expect(ipAllowed('203.0.113.7', g.allow)).toBe(true);
    expect(ipAllowed('10.1.2.3', g.allow)).toBe(true);
    expect(ipAllowed('8.8.8.8', g.allow)).toBe(false);
  });
  it('rate limit disables when burst/perSec is 0', () => {
    expect(loadEditorGuards({ FOLIO_EDITOR_RATE_BURST: '0' }).limiter).toBeNull();
    expect(loadEditorGuards({ FOLIO_EDITOR_RATE_PER_SEC: '0' }).limiter).toBeNull();
  });
});

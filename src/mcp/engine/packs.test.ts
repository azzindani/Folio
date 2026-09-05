import { describe, it, expect, beforeEach } from 'vitest';
import { listPacks, _resetPacks } from './packs';

function payload(r: { [k: string]: unknown }): Record<string, unknown> {
  return r as Record<string, unknown>;
}

describe('listPacks (WP-2.2)', () => {
  beforeEach(() => { _resetPacks(); });

  it('no kind → the three kinds with counts', () => {
    const r = payload(listPacks({}));
    expect(r.success).toBe(true);
    const packs = r.packs as Array<{ kind: string; count: number }>;
    expect(packs.map(p => p.kind).sort()).toEqual(['effects', 'palette', 'type']);
    for (const p of packs) expect(p.count).toBeGreaterThan(0);
  });

  it('rejects an unknown kind', () => {
    const r = payload(listPacks({ kind: 'gradients' }));
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('gradients');
  });

  it('palette listing carries usable swatches', () => {
    const r = payload(listPacks({ kind: 'palette', limit: 3 }));
    expect(r.success).toBe(true);
    expect(r.shown).toBe(3);
    const packs = r.packs as Array<{ id: string; swatches: string[] }>;
    expect(packs[0].swatches.length).toBeGreaterThan(0);
    expect(packs[0].swatches[0]).toMatch(/^#[0-9A-Fa-f]{3,8}$/);
  });

  it('type listing carries font families', () => {
    const r = payload(listPacks({ kind: 'type', limit: 2 }));
    const packs = r.packs as Array<{ families: Record<string, string> }>;
    expect(packs[0].families.heading).toBeTruthy();
    expect(packs[0].families.body).toBeTruthy();
  });

  it('search filters by tag/name', () => {
    const r = payload(listPacks({ kind: 'palette', search: 'retro' }));
    expect(r.success).toBe(true);
    expect((r.total as number)).toBeGreaterThan(0);
    expect((r.total as number)).toBeLessThan((payload(listPacks({ kind: 'palette' })).total as number));
  });

  it('a named palette pack returns full values under ~300 tokens', () => {
    const list = payload(listPacks({ kind: 'palette', limit: 1 }));
    const id = (list.packs as Array<{ id: string }>)[0].id;
    const r = payload(listPacks({ kind: 'palette', id }));
    expect(r.success).toBe(true);
    expect(r.id).toBe(id);
    expect(Array.isArray(r.swatches)).toBe(true);
    // ~300 token budget ≈ 1200 chars — a single pack must stay well under.
    expect(JSON.stringify(r).length).toBeLessThan(1200);
  });

  it('a named type pack returns families with an apply hint', () => {
    const list = payload(listPacks({ kind: 'type', limit: 1 }));
    const id = (list.packs as Array<{ id: string }>)[0].id;
    const r = payload(listPacks({ kind: 'type', id }));
    expect((r.families as Record<string, string>).heading).toBeTruthy();
    expect(String(r.next_action)).toMatch(/font/i);
  });

  it('an unknown id errors with a hint', () => {
    const r = payload(listPacks({ kind: 'effects', id: 'no-such-pack' }));
    expect(r.success).toBe(false);
    expect(String(r.hint)).toContain('effects');
  });

  // A model holding a pack id has no reason to know which kind it belongs to;
  // answering an id-only call with kind COUNTS read as "your pack isn't there".
  it('accepts an id ALONE and finds the pack across kinds', () => {
    const list = payload(listPacks({ kind: 'palette', limit: 1 }));
    const id = (list.packs as Array<{ id: string }>)[0].id;
    const r = payload(listPacks({ id }));
    expect(r.success).not.toBe(false);
    expect(r.id).toBe(id);
    expect(r.kind).toBe('palette');
    expect(Array.isArray(r.swatches)).toBe(true);
  });

  it('an id alone that matches nothing says so, instead of listing kind counts', () => {
    const r = payload(listPacks({ id: 'no-such-pack-anywhere' }));
    expect(r.success).toBe(false);
    expect(String(r.error ?? r.message)).toMatch(/any kind/);
  });
});

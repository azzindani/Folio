import { describe, it, expect } from 'vitest';

import { iconSearch } from './icon-search';

type Res = { total: number; icons?: string[]; resolves_to?: string | null; note?: string; by_kind?: Record<string, string[]>; by_concept?: string[] };
const run = (a?: { query?: string; limit?: number }): Res => iconSearch(a) as unknown as Res;

describe('icon_search — look a name up instead of guessing it', () => {
  it('with no query, returns the size of the set plus a starter map', () => {
    const r = run();
    expect(r.total).toBeGreaterThan(200);
    expect(Object.keys(r.by_kind ?? {})).toContain('data');
  });

  it('ranks an exact/prefix match above a mere substring', () => {
    const icons = run({ query: 'shopping' }).icons ?? [];
    expect(icons[0]).toMatch(/^shopping/);
  });

  it('confirms whether a name the model already has actually renders', () => {
    expect(run({ query: 'map-pin' }).resolves_to).toBe('map-pin');
    expect(run({ query: 'cargo' }).resolves_to).toBeNull();
  });

  it('bridges a CONCEPT to the objects the set is named for', () => {
    const icons = run({ query: 'cargo' }).icons ?? [];
    expect(icons).toContain('package');
    expect(icons).toContain('truck');
  });

  it('never answers with an empty list — a dead end sends the model back to guessing', () => {
    const r = run({ query: 'xyzzy-not-a-thing' });
    expect((r.icons ?? []).length).toBeGreaterThan(0);
    expect(r.note).toMatch(/nothing matched/);
  });

  it('warns that an unknown name renders as a blank circle, and how colour works', () => {
    const note = run({ query: 'cargo' }).note ?? '';
    expect(note).toMatch(/blank fallback circle/);
    expect(note).toMatch(/currentColor/);
  });

  it('honours limit', () => {
    expect((run({ query: 'a', limit: 5 }).icons ?? []).length).toBeLessThanOrEqual(5);
  });

  // benchmark r6 b23: "router", "plug", "lightbulb" are Lucide glyphs the bundled slice lacks; the reply read as a dead end.
  it('hands over the fetch for a glyph the bundled set lacks, and none for one it has', () => {
    const r = run({ query: 'router' }) as Res & { fetch?: { tool: string; params: Record<string, unknown> } };
    expect(r.resolves_to).toBeNull();
    expect(r.fetch).toEqual({ tool: 'manage_design', params: { op: 'asset_fetch', ref: 'iconify:lucide:router', icon_color: '#…' } });
    expect(String(r.note)).toMatch(/asset_search \{what:"icon"/);
    expect((run({ query: 'wifi' }) as Res & { fetch?: unknown }).fetch).toBeUndefined();
  });
});

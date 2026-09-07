import { describe, it, expect } from 'vitest';
import { collectFindings, errorFindings, schemaFindings, rankForDisplay } from './diagnose-collect';
import type { DesignSpec } from '../../schema/types';

/**
 * The schema validator ran nowhere but export.
 *
 * A layer typed "bg" is not a layer type. `validateDesignSpec` says so
 * precisely — `pages[0].layers[1].type  Unknown layer type: "bg"` — and it was
 * consulted only by export_design, at the very last step. diagnose_design
 * reported the design's 33 other problems and never mentioned this one; seal
 * passed it and handed over the share link. A model that fixed everything it
 * was told about still had a broken design.
 */

const withBadType = (): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'deck', type: 'carousel', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
  pages: [{
    id: 'p1',
    layers: [
      { id: 'ok', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, z: 0, fill: '#FAF5EC' },
      { id: 'oops', type: 'bg', x: 0, y: 0, width: 1080, height: 1080, z: 1 },
    ],
  }],
} as unknown as DesignSpec);

const clean = (): DesignSpec => ({
  _protocol: 'design/v1',
  meta: { id: 'd', name: 'p', type: 'poster', created: '2026-01-01', modified: '2026-01-01' },
  document: { width: 1080, height: 1080, unit: 'px', dpi: 96 },
  layers: [{ id: 'bg', type: 'rect', x: 0, y: 0, width: 1080, height: 1080, z: 0, fill: '#FAF5EC' }],
} as unknown as DesignSpec);

describe('diagnose consults the schema', () => {
  it('names the unknown layer type, with its path', () => {
    const f = schemaFindings(withBadType());
    expect(f.length).toBeGreaterThan(0);
    const hit = f.find(x => /Unknown layer type/.test(x.message));
    expect(hit, 'the validator knows, and diagnose still did not say').toBeDefined();
    expect(hit?.message).toContain('"bg"');
    expect(hit?.message).toMatch(/pages\[0\]\.layers\[1\]\.type/);
    expect(hit?.severity).toBe('error');
    expect(hit?.code).toBe('schema');
  });

  it('reaches diagnose_design, not just the helper', () => {
    const msgs = collectFindings(withBadType(), '/tmp/x.design.yaml').map(f => f.message);
    expect(msgs.some(m => /Unknown layer type/.test(m))).toBe(true);
  });

  it('reaches the SEAL gate, which is the one that hands over a link', () => {
    const errs = errorFindings(withBadType(), '/tmp/x.design.yaml');
    expect(errs.some(f => /Unknown layer type/.test(f.message))).toBe(true);
  });

  it('carries no schema noise on a clean design', () => {
    expect(schemaFindings(clean())).toEqual([]);
  });

  it('leaves duplicate z-index alone — 9,934 of those on the live corpus', () => {
    // Harmless here: the renderer sorts stably, so equal z keeps document
    // order. Surfacing them would bury the findings that matter.
    const dupes = {
      ...clean(),
      layers: [
        { id: 'a', type: 'rect', x: 0, y: 0, width: 10, height: 10, z: 3 },
        { id: 'b', type: 'rect', x: 0, y: 0, width: 10, height: 10, z: 3 },
      ],
    } as unknown as DesignSpec;
    expect(schemaFindings(dupes)).toEqual([]);
  });

  it('survives a spec that makes the validator throw', () => {
    expect(() => schemaFindings(null as unknown as DesignSpec)).not.toThrow();
    expect(() => schemaFindings('nope' as unknown as DesignSpec)).not.toThrow();
  });

  it('is skipped when scoped to one page — its paths address the document', () => {
    const scoped = collectFindings(withBadType(), '/tmp/x.design.yaml', undefined, 'p1');
    expect(scoped.some(f => f.code === 'schema')).toBe(false);
  });
});

describe('rankForDisplay — what survives the cap', () => {
  const f = (severity: string, code: string, n: number): Array<{ severity: string; code: string; message: string }> =>
    Array.from({ length: n }, (_, i) => ({ severity, code, message: `${code}#${i}` }));

  it('shows one of every kind before a second of any', () => {
    const all = [...f('error', 'off_canvas', 60), ...f('error', 'schema', 1)];
    const shown = rankForDisplay(all, 40);
    expect(shown.length).toBe(40);
    expect(shown.some(x => x.code === 'schema'),
      'a lone finding was buried under 60 copies of another').toBe(true);
    expect(shown[0]?.code).toBe('off_canvas');
    expect(shown[1]?.code).toBe('schema');
  });

  it('puts every error ahead of every warning', () => {
    const shown = rankForDisplay([...f('warning', 'w', 30), ...f('error', 'e', 5)], 10);
    expect(shown.slice(0, 5).every(x => x.severity === 'error')).toBe(true);
    expect(shown.slice(5).every(x => x.severity === 'warning')).toBe(true);
  });

  it('returns everything when it already fits, in severity order', () => {
    const shown = rankForDisplay([...f('suggestion', 's', 2), ...f('error', 'e', 2)], 40);
    expect(shown.length).toBe(4);
    expect(shown.map(x => x.severity)).toEqual(['error', 'error', 'suggestion', 'suggestion']);
  });

  it('handles an empty list and a zero limit', () => {
    expect(rankForDisplay([], 40)).toEqual([]);
    expect(rankForDisplay(f('error', 'e', 5), 0)).toEqual([]);
  });
});

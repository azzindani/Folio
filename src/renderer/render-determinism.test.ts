import { describe, it, expect } from 'vitest';
import { renderToSVGString } from '../mcp/engine/svg-export';
import type { DesignSpec } from '../schema/types';

// Exporting one unchanged design three times produced three different files:
//
//   run1  lg-1  noise-2  noise-3
//   run2  lg-4  noise-5  noise-6
//   run3  lg-7  noise-8  noise-9
//
// Identical pixels, three md5s. Generated def ids came from a module-level
// counter that nothing in production reset — `resetDefIdCounter` existed, was
// exported from the renderer's public index, and every one of its callers was a
// TEST file resetting it in beforeEach so its own ids stayed stable. The test
// setup manufactured the determinism the tests were asserting.
//
// This matters beyond tidiness: export-receipt's key claims "identical inputs
// through identical code -> identical bytes", render_preview {changed_only}
// diffs rendered SVG to decide what to re-rasterise (it carries its own
// renumbering workaround for exactly this), and anyone diffing two exports sees
// spurious churn.

const spec = (): DesignSpec => ({
  meta: { id: 'd', name: 'D', type: 'poster' },
  document: { width: 400, height: 400 },
  layers: [
    {
      id: 'bg', type: 'rect', x: 0, y: 0, width: 400, height: 400, z: 0,
      fill: { type: 'linear', angle: 135, stops: [{ color: '#101820', position: 0 }, { color: '#22303C', position: 100 }] },
    },
    { id: 'grain', type: 'rect', x: 20, y: 20, width: 360, height: 160, z: 1,
      fill: { type: 'noise', frequency: 0.8, octaves: 2, opacity: 0.12 } },
    { id: 'grain2', type: 'rect', x: 20, y: 200, width: 360, height: 160, z: 2,
      fill: { type: 'noise', frequency: 0.5, octaves: 3, opacity: 0.09 } },
    { id: 'dots', type: 'rect', x: 40, y: 40, width: 100, height: 100, z: 3,
      fill: { type: 'pattern', pattern: 'dots', fg: '#F28C28' } },
    { id: 'card', type: 'rect', x: 200, y: 240, width: 120, height: 90, z: 4,
      fill: '#F5F0E6', effects: { shadow: { x: 0, y: 4, blur: 12, color: '#000' } } },
  ],
} as unknown as DesignSpec);

describe('the same design renders to the same bytes', () => {
  it('three renders in one process are identical', () => {
    const runs = [renderToSVGString(spec()), renderToSVGString(spec()), renderToSVGString(spec())];
    expect(runs[1]).toBe(runs[0]);
    expect(runs[2]).toBe(runs[0]);
  });

  it('and it is not identical by being empty', () => {
    // A render that silently produced nothing would pass the test above.
    const out = renderToSVGString(spec());
    expect(out).toMatch(/<linearGradient/);
    expect(out).toMatch(/<filter/);
    expect(out).toMatch(/<pattern/);
    expect(out.length).toBeGreaterThan(500);
  });

  it('renders identically no matter what was rendered before it', () => {
    // The counter made output depend on process history. Render a pile of other
    // designs in between and the bytes must not move.
    const first = renderToSVGString(spec());
    for (let i = 0; i < 10; i++) {
      renderToSVGString({
        meta: { id: 'x', name: 'X', type: 'poster' },
        document: { width: 100, height: 100 },
        layers: [{ id: `r${i}`, type: 'rect', x: 0, y: 0, width: 50, height: 50, z: 0,
          fill: { type: 'linear', angle: i * 7, stops: [{ color: '#111', position: 0 }, { color: '#222', position: 100 }] } }],
      } as unknown as DesignSpec);
    }
    expect(renderToSVGString(spec())).toBe(first);
  });

  it('a real change still changes the bytes', () => {
    // Determinism must not be achieved by ignoring the input.
    const changed = spec();
    (changed.layers as unknown as Record<string, unknown>[])[0]!['fill'] =
      { type: 'linear', angle: 90, stops: [{ color: '#101820', position: 0 }, { color: '#22303C', position: 100 }] };
    expect(renderToSVGString(changed)).not.toBe(renderToSVGString(spec()));
  });

  it('every url(#…) reference resolves inside the same document', () => {
    // Content ids dedupe defs; a dedupe that dropped the wrong one would leave
    // a reference pointing at nothing, and the fill would silently vanish.
    const out = renderToSVGString(spec());
    const defined = new Set([...out.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
    const referenced = [...out.matchAll(/url\(#([^)]+)\)/g)].map(m => m[1]);
    expect(referenced.length).toBeGreaterThan(0);
    for (const r of referenced) expect(defined.has(r), `url(#${r}) has no def`).toBe(true);
  });
});

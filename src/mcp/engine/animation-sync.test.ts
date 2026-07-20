import { describe, it, expect } from 'vitest';
import { syncAnimationsToSpec, collectSpecAnimations } from './animation-sync';
import { generateDesignAnimationCSS } from '../../animation/css-generator';
import type { DesignSpec, Layer } from '../../schema/types';
import type { AnimationSpec } from '../../animation/types';

const anim = (scale: number): AnimationSpec => ({
  keyframes: [{ t: 0, scale: 1 }, { t: 1000, scale }],
  playback: { duration: 1000, origin: 'offset' },
});

const layer = (id: string, extra: Record<string, unknown> = {}): Layer =>
  ({ id, type: 'rect', x: 0, y: 0, width: 10, height: 10, ...extra }) as unknown as Layer;

const spec = (over: Record<string, unknown>): DesignSpec =>
  ({ document: { width: 100, height: 100, unit: 'px', dpi: 96 }, ...over }) as unknown as DesignSpec;

describe('collectSpecAnimations', () => {
  it('finds animations on top-level layers', () => {
    const s = spec({ layers: [layer('a', { animation: anim(1.5) }), layer('b')] });
    expect(Object.keys(collectSpecAnimations(s))).toEqual(['a']);
  });

  it('recurses into nested groups', () => {
    const s = spec({
      layers: [layer('g', { type: 'group', layers: [layer('kid', { animation: anim(2) })] })],
    });
    expect(Object.keys(collectSpecAnimations(s))).toEqual(['kid']);
  });

  it('covers every page of a carousel', () => {
    const s = spec({
      pages: [
        { id: 'p1', layers: [layer('one', { animation: anim(1.2) })] },
        { id: 'p2', layers: [layer('two', { animation: anim(1.3) })] },
      ],
    });
    expect(Object.keys(collectSpecAnimations(s)).sort()).toEqual(['one', 'two']);
  });
});

describe('syncAnimationsToSpec', () => {
  it('writes the top-level map the editor actually reads', () => {
    // The bug this fixes: MCP wrote layer.animation, the editor read
    // spec.animations, and nothing bridged them — so a design exported with
    // motion and opened in the editor completely static.
    const s = spec({ layers: [layer('a', { animation: anim(1.5) })] });
    expect(syncAnimationsToSpec(s)).toBe(1);
    const out = s as DesignSpec & { animations?: Record<string, AnimationSpec> };
    expect(out.animations?.['a']).toBeDefined();
  });

  it('rebuilds rather than merges, so a removed animation disappears', () => {
    const s = spec({ layers: [layer('a')] }) as DesignSpec & { animations?: Record<string, AnimationSpec> };
    s.animations = { a: anim(1.5) };   // stale entry from an earlier state
    syncAnimationsToSpec(s);
    // Merging would leave it behind and the editor would animate a still layer.
    expect(s.animations).toBeUndefined();
  });

  it('drops the key entirely when nothing is animated', () => {
    const s = spec({ layers: [layer('a'), layer('b')] });
    expect(syncAnimationsToSpec(s)).toBe(0);
    expect((s as DesignSpec & { animations?: Record<string, AnimationSpec> }).animations).toBeUndefined();
  });

  it('produces a map the editor can turn straight into CSS', () => {
    // Reproduces the editor's own load path: app.ts lifts spec.animations into
    // state, canvas-base.ts feeds it to generateDesignAnimationCSS as a Map.
    const s = spec({ layers: [layer('box', { animation: anim(1.5) })] });
    syncAnimationsToSpec(s);
    const entries = Object.entries((s as DesignSpec & { animations?: Record<string, AnimationSpec> }).animations ?? {});
    const css = generateDesignAnimationCSS(new Map(entries));
    expect(css).toContain('@keyframes kf-box');
    expect(css).toContain('[data-layer-id="box"]');
  });

  it('keeps the per-layer field as the authoritative one', () => {
    const l = layer('a', { animation: anim(1.5) });
    const s = spec({ layers: [l] });
    syncAnimationsToSpec(s);
    expect((l as Layer & { animation?: AnimationSpec }).animation).toBeDefined();
  });
});

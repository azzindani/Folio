// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../schema/types';
import type { AnimationSpec, MotionRule } from '../animation/types';
import { compileRules } from './resolve-motion';
import { expandPreset } from '../mcp/engine/motion-presets';
import { mergeFragment } from '../mcp/engine/motion-merge';
import { specAt, animationDuration } from '../export/gif-frames';
import { buildAnimatedSVG } from '../export/svg-animate';
import { renderToSVGString } from '../mcp/engine/svg-export';
import { collectFindings } from '../mcp/engine/diagnose-collect';
import { syncAnimationsToSpec } from '../mcp/engine/animation-sync';
import { withAnimationMirror } from '../animation/page-animations';
import { buildPosePlan } from '../editor/motion-pose';
import { sourceOptions } from './resolve-source';

const scope = { names: { Beat: 600 }, W: 1080, H: 1350 };
const L = (o: Record<string, unknown>): Layer => o as unknown as Layer;
const moving = (id: string, rule: MotionRule | MotionRule[]): Layer =>
  L({ id, type: 'rect', z: 1, x: 100, y: 200, width: 300, height: 120, fill: '#E4572E', animation: { rule } });
const design = (layers: Layer[]): DesignSpec => ({ meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1350 },
  names: { Beat: 600 }, layers: [L({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#FBF7F0' }), ...layers] } as unknown as DesignSpec);
const opacityAt = (spec: DesignSpec, t: number, id: string): number =>
  ((specAt(spec, 0, t).layers ?? []).find(l => l.id === id) as { opacity?: number } | undefined)?.opacity ?? 1;

describe('motion rules', () => {
  it('compile to the track op:sequence writes — one preset, and an entrance then an exit', () => {
    const rise = expandPreset('rise', { duration: 600, delay: 1200 });
    expect(compileRules({ preset: 'rise', at: 1200, duration: 600 }, scope)).toEqual({ keyframes: rise.keyframes, playback: rise.playback });
    const both = compileRules([{ preset: 'rise', at: 0 }, { preset: 'fade_out', at: '=Beat * 5' }], scope);
    expect(both).toEqual(mergeFragment({ keyframes: expandPreset('rise').keyframes, playback: expandPreset('rise').playback },
      expandPreset('fade_out', { delay: 3000 })));
  });

  it('says why a rule cannot compile', () => {
    expect(compileRules({ preset: 'zigzag_nope' }, scope)).toMatch(/preset "zigzag_nope" is unknown/);
    expect(compileRules({ preset: 'rise', at: '=Bet * 2' }, scope)).toMatch(/at: .*Bet/);
    expect(compileRules([{ preset: 'rise', at: 0, duration: 800 }, { preset: 'fade_out', at: 400 }], scope)).toMatch(/rule 2: Motions overlap/);
    const errs = collectFindings(design([moving('card', { preset: 'zigzag_nope' })]), '/dev/null').filter(f => f.code === 'rule_error');
    expect(errs.map(f => f.layers)).toEqual([['card']]);
  });

  it('plays in the frames, counts in the scene length and writes CSS in the animated SVG', () => {
    const spec = design([moving('card', [{ preset: 'fade_in', at: '=Beat', duration: 400 }, { preset: 'fade_out', at: 3000, duration: 400 }])]);
    expect([opacityAt(spec, 300, 'card'), opacityAt(spec, 1500, 'card'), opacityAt(spec, 3600, 'card')]).toEqual([0, 1, 0]);
    expect(animationDuration(spec.layers ?? [], sourceOptions(spec))).toBe(3400);
    const { svg, animatedLayers } = buildAnimatedSVG(spec, { renderSVG: s => renderToSVGString(s) });
    expect(animatedLayers).toContain('card');
    expect(svg).toMatch(/@keyframes[^{]*card/);
  });

  it('staggers gallery cells by Index', () => {
    const template = [L({ id: 'dot', type: 'rect', z: 0, x: 0, y: 0, width: 40, height: 40, fill: '#1B998B', animation: { rule: { preset: 'fade_in', at: '=Index * 1000', duration: 200 } } })];
    const spec = design([L({ id: 'row', type: 'group', z: 1, x: 80, y: 400, width: 920, height: 60, layers: [], gallery: { items: 3, template } })]);
    const cells = (specAt(spec, 0, 1500).layers?.[1] as { layers: { layers: { opacity?: number }[] }[] }).layers;
    expect(cells.map(c => c.layers[0]?.opacity ?? 1)).toEqual([1, 1, 0]);
  });

  it('is not mirrored into the editor map, and the editor plans it as its track', () => {
    const rule: MotionRule = { preset: 'rise', at: 500 };
    const spec = design([moving('card', rule), L({ id: 'lit', type: 'rect', z: 2, animation: expandPreset('pop') as AnimationSpec })]);
    syncAnimationsToSpec(spec);
    expect(Object.keys((spec as { animations?: object }).animations ?? {})).toEqual(['lit']);
    const edited = { ...spec, animations: { card: { keyframes: [] }, lit: {} } } as unknown as DesignSpec;
    expect(Object.keys((withAnimationMirror(edited) as { animations?: object }).animations ?? {})).toEqual(['lit']);
    const plan = buildPosePlan(spec.layers ?? [], sourceOptions(spec));
    expect(plan.touched).toContain('card');
    expect(plan.duration).toBeGreaterThan(500);
  });
});

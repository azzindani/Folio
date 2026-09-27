import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { collectFindings } from './diagnose-collect';
import { diagnoseLayers } from '../shorthand-diagnose';

// Found building the entity-OCR piece: a layer's animation.rule replaces its keyframes when it
// compiles, and nothing said so — a model that writes both sees one of them silently not play.

const L = (o: Record<string, unknown>): Layer => ({ id: 'chip', type: 'rect', z: 1, x: 100, y: 100, width: 200, height: 60, fill: '#2A63C9', ...o } as unknown as Layer);
const design = (layer: Layer): DesignSpec => ({
  _protocol: 'design/v1', meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1350 }, length_ms: 6000,
  layers: [layer],
} as unknown as DesignSpec);
const shadowed = (layer: Layer): string[] => collectFindings(design(layer), '/dev/null')
  .filter(f => f.code === 'rule_over_keyframes').map(f => `${f.severity}: ${f.message}`);

const keys = { keyframes: [{ t: 0, x: 0 }, { t: 1000, x: 400 }], playback: { duration: 1000, origin: 'offset' } };
const rule = { rule: { preset: 'pop', at: 400, duration: 350 } };

describe('a motion rule and keyframes on one layer', () => {
  it('says the rule plays and the keyframes do not', () => {
    const found = shadowed(L({ animation: { ...keys, ...rule } }));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(/^warning: "chip".*rule.*keyframes/);
  });

  it('says nothing about a layer that has only one of them', () => {
    expect(shadowed(L({ animation: rule }))).toEqual([]);
    expect(shadowed(L({ animation: keys }))).toEqual([]);
  });

  it('is said when the layer is written, at any depth — add_layers and append_page read these notes', () => {
    const group = { id: 'g', type: 'group', z: 1, layers: [L({ animation: { ...keys, ...rule } })] } as unknown as Layer;
    expect(diagnoseLayers([group]).some(n => n.includes('"chip"') && /rule.*keyframes/.test(n))).toBe(true);
    expect(diagnoseLayers([L({ animation: keys }), L({ id: 'other', animation: rule })]).some(n => /keyframes never/.test(n))).toBe(false);
  });
});

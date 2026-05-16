import { describe, it, expect, beforeAll } from 'vitest';
import { JSDOM } from 'jsdom';
import { renderParticle } from './layer-renderers';
import type { ParticleLayer } from '../schema/types';

beforeAll(() => {
  const dom = new JSDOM('<!DOCTYPE html>', { pretendToBeVisual: true });
  const g = globalThis as Record<string, unknown>;
  g['document'] = dom.window.document;
  g['window'] = dom.window;
});

function makeLayer(overrides: Partial<ParticleLayer> = {}): ParticleLayer {
  return {
    id: 'p1', type: 'particle', z: 1,
    x: 0, y: 0, width: 400, height: 300,
    count: 10, size: 6, speed: 2,
    colors: ['#ff0000', '#00ff00'],
    shape: 'circle',
    ...overrides,
  };
}

const fakeSvg = {} as SVGSVGElement;

describe('renderParticle', () => {
  it('returns a <g> element', () => {
    const el = renderParticle(makeLayer(), fakeSvg);
    expect(el.tagName.toLowerCase()).toBe('g');
  });

  it('sets data-layer-id on the group', () => {
    const el = renderParticle(makeLayer({ id: 'ptest' }), fakeSvg);
    expect(el.getAttribute('data-layer-id')).toBe('ptest');
  });

  it('generates count child elements', () => {
    const el = renderParticle(makeLayer({ count: 15 }), fakeSvg);
    expect(el.children.length).toBe(15);
  });

  it('defaults to 50 particles when count omitted', () => {
    const layer = { id: 'def', type: 'particle' as const, z: 1 } as ParticleLayer;
    const el = renderParticle(layer, fakeSvg);
    expect(el.children.length).toBe(50);
  });

  it('renders circles for shape=circle', () => {
    const el = renderParticle(makeLayer({ shape: 'circle', count: 3 }), fakeSvg);
    const tags = Array.from(el.children).map(c => c.tagName.toLowerCase());
    expect(tags.every(t => t === 'circle')).toBe(true);
  });

  it('renders rects for shape=square', () => {
    const el = renderParticle(makeLayer({ shape: 'square', count: 3 }), fakeSvg);
    const tags = Array.from(el.children).map(c => c.tagName.toLowerCase());
    expect(tags.every(t => t === 'rect')).toBe(true);
  });

  it('renders polygons for shape=star', () => {
    const el = renderParticle(makeLayer({ shape: 'star', count: 3 }), fakeSvg);
    const tags = Array.from(el.children).map(c => c.tagName.toLowerCase());
    expect(tags.every(t => t === 'polygon')).toBe(true);
  });

  it('produces deterministic output for same id', () => {
    const layer = makeLayer({ count: 5 });
    const el1 = renderParticle(layer, fakeSvg);
    const el2 = renderParticle(layer, fakeSvg);
    const cx1 = (el1.children[0] as Element).getAttribute('cx');
    const cx2 = (el2.children[0] as Element).getAttribute('cx');
    expect(cx1).toBe(cx2);
  });

  it('applies animation style to particles', () => {
    const el = renderParticle(makeLayer({ count: 1 }), fakeSvg);
    const style = (el.children[0] as HTMLElement).getAttribute('style') ?? '';
    expect(style).toContain('animation');
  });
});

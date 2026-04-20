import { describe, it, expect } from 'vitest';
import { applyEffects } from './effects-renderer';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(): SVGSVGElement {
  return document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
}
function makeEl(): SVGElement {
  return document.createElementNS(SVG_NS, 'rect') as SVGElement;
}

describe('applyEffects — shadow', () => {
  it('adds feDropShadow filter for single shadow', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { shadows: [{ x: 2, y: 4, blur: 8, color: '#000' }] }, svg);
    expect(el.getAttribute('filter')).toMatch(/^url\(#fx-/);
    expect(svg.querySelector('feDropShadow')).not.toBeNull();
  });

  it('adds multiple feDropShadow primitives for multiple shadows', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, {
      shadows: [
        { x: 1, y: 1, blur: 4, color: '#000' },
        { x: 4, y: 4, blur: 12, color: 'rgba(0,0,0,0.5)' },
      ],
    }, svg);
    expect(svg.querySelectorAll('feDropShadow').length).toBe(2);
  });

  it('sets shadow dx/dy/stdDeviation from shadow properties', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { shadows: [{ x: 3, y: 6, blur: 10, color: '#f00' }] }, svg);
    const shadow = svg.querySelector('feDropShadow')!;
    expect(shadow.getAttribute('dx')).toBe('3');
    expect(shadow.getAttribute('dy')).toBe('6');
    expect(shadow.getAttribute('stdDeviation')).toBe('5'); // blur/2
    expect(shadow.getAttribute('flood-color')).toBe('#f00');
  });
});

describe('applyEffects — blur', () => {
  it('adds feGaussianBlur filter when blur is set', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { blur: 6 }, svg);
    expect(el.getAttribute('filter')).toMatch(/^url\(#fx-/);
    const blur = svg.querySelector('feGaussianBlur')!;
    expect(blur.getAttribute('stdDeviation')).toBe('6');
  });

  it('combines shadow and blur in the same filter', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { shadows: [{ x: 0, y: 2, blur: 4, color: '#000' }], blur: 3 }, svg);
    expect(svg.querySelectorAll('filter').length).toBe(1);
    expect(svg.querySelector('feDropShadow')).not.toBeNull();
    expect(svg.querySelector('feGaussianBlur')).not.toBeNull();
  });
});

describe('applyEffects — opacity', () => {
  it('sets opacity attribute on element', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { opacity: 0.4 }, svg);
    expect(el.getAttribute('opacity')).toBe('0.4');
  });

  it('does not set opacity attribute when undefined', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { blur: 2 }, svg);
    expect(el.getAttribute('opacity')).toBeNull();
  });
});

describe('applyEffects — blend_mode', () => {
  it('sets mixBlendMode CSS style', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { blend_mode: 'multiply' }, svg);
    expect((el as HTMLElement).style.mixBlendMode).toBe('multiply');
  });
});

describe('applyEffects — no effects', () => {
  it('does not add filter when no shadows or blur', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { opacity: 1 }, svg);
    expect(el.getAttribute('filter')).toBeNull();
    expect(svg.querySelector('filter')).toBeNull();
  });

  it('does not create defs when not needed', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, {}, svg);
    expect(el.getAttribute('filter')).toBeNull();
  });
});

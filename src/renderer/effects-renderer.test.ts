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
    expect((el as unknown as HTMLElement).style.mixBlendMode).toBe('multiply');
  });
});

describe('applyEffects — shadow with spread', () => {
  it('uses feMorphology+feGaussianBlur+feOffset decomposition when spread > 0', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { shadows: [{ x: 2, y: 4, blur: 8, color: '#000', spread: 4 }] }, svg);
    expect(el.getAttribute('filter')).toMatch(/^url\(#fx-/);
    expect(svg.querySelector('feMorphology')).not.toBeNull();
    expect(svg.querySelector('feGaussianBlur')).not.toBeNull();
    expect(svg.querySelector('feOffset')).not.toBeNull();
    expect(svg.querySelector('feFlood')).not.toBeNull();
    expect(svg.querySelector('feComposite')).not.toBeNull();
    expect(svg.querySelector('feMerge')).not.toBeNull();
  });

  it('feMorphology has correct dilate radius', () => {
    const svg = makeSvg();
    applyEffects(makeEl(), { shadows: [{ x: 0, y: 0, blur: 4, color: '#f00', spread: 6 }] }, svg);
    const morph = svg.querySelector('feMorphology')!;
    expect(morph.getAttribute('operator')).toBe('dilate');
    expect(morph.getAttribute('radius')).toBe('6');
  });

  it('falls back to feDropShadow when spread is 0', () => {
    const svg = makeSvg();
    applyEffects(makeEl(), { shadows: [{ x: 1, y: 1, blur: 4, color: '#000', spread: 0 }] }, svg);
    expect(svg.querySelector('feDropShadow')).not.toBeNull();
    expect(svg.querySelector('feMorphology')).toBeNull();
  });
});

describe('applyEffects — duotone', () => {
  it('maps luminance to a two-color ramp (feColorMatrix + feComponentTransfer)', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { duotone: { shadow: '#1B1B3A', highlight: '#F5C518' } }, svg);
    expect(el.getAttribute('filter')).toMatch(/^url\(#fx-/);
    const lum = svg.querySelector('feColorMatrix[type="matrix"]');
    expect(lum).not.toBeNull();
    const ct = svg.querySelector('feComponentTransfer')!;
    expect(ct).not.toBeNull();
    const r = ct.querySelector('feFuncR')!;
    expect(r.getAttribute('type')).toBe('table');
    // shadow #1B → 0.106, highlight #F5 → 0.961
    expect(r.getAttribute('tableValues')).toMatch(/^0\.1\d+ 0\.9\d+$/);
  });
});

describe('applyEffects — posterize / saturate', () => {
  it('posterize emits discrete feComponentTransfer with N levels', () => {
    const svg = makeSvg();
    applyEffects(makeEl(), { posterize: 4 }, svg);
    const fn = svg.querySelector('feComponentTransfer feFuncR')!;
    expect(fn.getAttribute('type')).toBe('discrete');
    expect(fn.getAttribute('tableValues')!.split(' ')).toHaveLength(4);
  });

  it('saturate emits a saturate feColorMatrix', () => {
    const svg = makeSvg();
    applyEffects(makeEl(), { saturate: 0 }, svg);
    const cm = svg.querySelector('feColorMatrix[type="saturate"]')!;
    expect(cm.getAttribute('values')).toBe('0');
  });
});

describe('applyEffects — grain', () => {
  it('overlays clipped turbulence noise', () => {
    const svg = makeSvg();
    applyEffects(makeEl(), { grain: 0.5 }, svg);
    expect(svg.querySelector('feTurbulence')).not.toBeNull();
    expect(svg.querySelector('feBlend')).not.toBeNull();
  });
});

describe('applyEffects — backdrop_blur', () => {
  it('sets backdropFilter style (glassmorphism, HTML contexts)', () => {
    const svg = makeSvg();
    const el = makeEl();
    applyEffects(el, { backdrop_blur: 12 }, svg);
    expect((el as unknown as HTMLElement).style.backdropFilter).toBe('blur(12px)');
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

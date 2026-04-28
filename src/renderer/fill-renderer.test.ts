/**
 * Unit tests for fill-renderer.ts
 * Coverage target: 90%
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { applyFill, resolveColorOrGradient } from './fill-renderer';
import { createSVGRoot, resetDefIdCounter } from './svg-utils';
import type {
  SolidFill, LinearGradientFill, RadialGradientFill, ConicGradientFill,
  NoiseFill, MultiFill, Fill,
} from '../schema/types';

function makeSVG() {
  return createSVGRoot(200, 200);
}

function getDefs(svg: SVGSVGElement) {
  return svg.querySelector('defs');
}

beforeEach(() => {
  resetDefIdCounter();
});

describe('applyFill — solid', () => {
  it('returns the solid color as fill', () => {
    const fill: SolidFill = { type: 'solid', color: '#FF0000' };
    const result = applyFill(fill, makeSVG(), { width: 200, height: 200 });
    expect(result.fill).toBe('#FF0000');
    expect(result.opacity).toBeUndefined();
  });

  it('returns opacity when specified', () => {
    const fill: SolidFill = { type: 'solid', color: '#00FF00', opacity: 0.5 };
    const result = applyFill(fill, makeSVG(), { width: 200, height: 200 });
    expect(result.fill).toBe('#00FF00');
    expect(result.opacity).toBe(0.5);
  });
});

describe('applyFill — linear gradient', () => {
  it('returns a url(#...) reference and writes linearGradient to defs', () => {
    const svg = makeSVG();
    const fill: LinearGradientFill = {
      type: 'linear',
      angle: 135,
      stops: [
        { color: '#000000', position: 0 },
        { color: '#FFFFFF', position: 100 },
      ],
    };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toMatch(/^url\(#lg-\d+\)$/);

    const defs = getDefs(svg);
    expect(defs).toBeTruthy();
    const gradient = defs!.querySelector('linearGradient');
    expect(gradient).toBeTruthy();
    const stops = gradient!.querySelectorAll('stop');
    expect(stops).toHaveLength(2);
    expect(stops[0].getAttribute('offset')).toBe('0%');
    expect(stops[0].getAttribute('stop-color')).toBe('#000000');
    expect(stops[1].getAttribute('offset')).toBe('100%');
    expect(stops[1].getAttribute('stop-color')).toBe('#FFFFFF');
  });

  it('calculates gradient direction from angle', () => {
    const svg = makeSVG();
    const fill: LinearGradientFill = {
      type: 'linear',
      angle: 90,
      stops: [{ color: '#F00', position: 0 }, { color: '#00F', position: 100 }],
    };
    applyFill(fill, svg, { width: 200, height: 200 });
    const defs = getDefs(svg);
    const gradient = defs!.querySelector('linearGradient')!;
    // Angle 90 → radians = 0, cos=1, sin=0
    // x1 = 50 - 50 = 0, x2 = 50 + 50 = 100, y1=y2=50 (horizontal)
    expect(parseFloat(gradient.getAttribute('x1')!)).toBeCloseTo(0, 0);
    expect(parseFloat(gradient.getAttribute('x2')!)).toBeCloseTo(100, 0);
    expect(parseFloat(gradient.getAttribute('y1')!)).toBeCloseTo(50, 0);
    expect(parseFloat(gradient.getAttribute('y2')!)).toBeCloseTo(50, 0);
  });
});

describe('applyFill — radial gradient', () => {
  it('returns a url(#...) reference and writes radialGradient to defs', () => {
    const svg = makeSVG();
    const fill: RadialGradientFill = {
      type: 'radial',
      cx: 50,
      cy: 50,
      radius: 70,
      stops: [
        { color: '#E94560', position: 0 },
        { color: '#1A1A2E', position: 100 },
      ],
    };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toMatch(/^url\(#rg-\d+\)$/);

    const defs = getDefs(svg);
    const gradient = defs!.querySelector('radialGradient');
    expect(gradient).toBeTruthy();
    expect(gradient!.getAttribute('cx')).toBe('50%');
    expect(gradient!.getAttribute('cy')).toBe('50%');
    expect(gradient!.getAttribute('r')).toBe('70%');
    const stops = gradient!.querySelectorAll('stop');
    expect(stops).toHaveLength(2);
    expect(stops[0].getAttribute('stop-color')).toBe('#E94560');
  });
});

describe('applyFill — conic gradient', () => {
  it('returns a url(#...) reference (approximated as radial)', () => {
    const svg = makeSVG();
    const fill: ConicGradientFill = {
      type: 'conic',
      cx: 50,
      cy: 50,
      stops: [
        { color: '#FF0000', position: 0 },
        { color: '#0000FF', position: 100 },
      ],
    };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toMatch(/^url\(#cg-\d+\)$/);

    const defs = getDefs(svg);
    // Conic is approximated as radialGradient
    const gradient = defs!.querySelector('radialGradient');
    expect(gradient).toBeTruthy();
    expect(gradient!.getAttribute('cx')).toBe('50%');
    expect(gradient!.getAttribute('cy')).toBe('50%');
  });
});

describe('applyFill — noise', () => {
  it('returns fill: none and an extra noise rect element', () => {
    const svg = makeSVG();
    const fill: NoiseFill = {
      type: 'noise',
      opacity: 0.05,
      frequency: 0.65,
      octaves: 4,
    };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toBe('none');
    expect(result.extraElements).toHaveLength(1);

    const noiseRect = result.extraElements![0] as SVGRectElement;
    expect(noiseRect.tagName).toBe('rect');
    expect(noiseRect.getAttribute('width')).toBe('200');
    expect(noiseRect.getAttribute('height')).toBe('200');
    expect(noiseRect.getAttribute('opacity')).toBe('0.05');

    // Verify feTurbulence filter was created in defs
    const defs = getDefs(svg);
    const filter = defs!.querySelector('filter');
    expect(filter).toBeTruthy();
    const turbulence = filter!.querySelector('feTurbulence');
    expect(turbulence).toBeTruthy();
    expect(turbulence!.getAttribute('baseFrequency')).toBe('0.65');
    expect(turbulence!.getAttribute('numOctaves')).toBe('4');
  });
});

describe('applyFill — multi', () => {
  it('combines multiple fill layers and returns first non-none fill', () => {
    const svg = makeSVG();
    const fill: MultiFill = {
      type: 'multi',
      layers: [
        { type: 'linear', angle: 135, stops: [{ color: '#000', position: 0 }, { color: '#FFF', position: 100 }] },
        { type: 'noise', opacity: 0.03, frequency: 0.65, octaves: 4 },
      ],
    };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toMatch(/^url\(#lg-\d+\)$/);
    // Noise rect should be included as extra element
    expect(result.extraElements).toBeTruthy();
    expect(result.extraElements!.length).toBeGreaterThanOrEqual(1);
  });

  it('returns fill: none when all sub-layers are none', () => {
    const svg = makeSVG();
    const fill: MultiFill = {
      type: 'multi',
      layers: [
        { type: 'none' },
        { type: 'none' },
      ],
    };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toBe('none');
    expect(result.extraElements).toBeUndefined();
  });

  it('handles empty layers array', () => {
    const svg = makeSVG();
    const fill: MultiFill = { type: 'multi', layers: [] };
    const result = applyFill(fill, svg, { width: 200, height: 200 });
    expect(result.fill).toBe('none');
  });
});

describe('applyFill — none', () => {
  it('returns fill: none', () => {
    const fill: Fill = { type: 'none' };
    const result = applyFill(fill, makeSVG(), { width: 200, height: 200 });
    expect(result.fill).toBe('none');
    expect(result.extraElements).toBeUndefined();
  });
});

describe('applyFill — def ID uniqueness', () => {
  it('each fill call produces a unique ID', () => {
    const svg = makeSVG();
    const fill: LinearGradientFill = {
      type: 'linear',
      angle: 45,
      stops: [{ color: '#F00', position: 0 }, { color: '#00F', position: 100 }],
    };
    const r1 = applyFill(fill, svg, { width: 200, height: 200 });
    const r2 = applyFill(fill, svg, { width: 200, height: 200 });
    expect(r1.fill).not.toBe(r2.fill);
  });
});

describe('resolveColorOrGradient', () => {
  it('returns string color directly', () => {
    const svg = makeSVG();
    const defs = (svg.querySelector('defs') ?? (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.appendChild(d); return d;
    })()) as SVGDefsElement;
    expect(resolveColorOrGradient('#ff0000', defs)).toBe('#ff0000');
  });

  it('resolves linear gradient and returns url reference', () => {
    const svg = makeSVG();
    const defs = (svg.querySelector('defs') ?? (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.appendChild(d); return d;
    })()) as SVGDefsElement;
    const fill = { type: 'linear' as const, angle: 90, stops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] };
    const result = resolveColorOrGradient(fill, defs);
    expect(result).toMatch(/^url\(#lg-/);
  });

  it('resolves radial gradient and returns url reference', () => {
    const svg = makeSVG();
    const defs = (svg.querySelector('defs') ?? (() => {
      const d = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      svg.appendChild(d); return d;
    })()) as SVGDefsElement;
    const fill = { type: 'radial' as const, cx: 50, cy: 50, radius: 50, stops: [{ color: '#000', position: 0 }, { color: '#fff', position: 100 }] };
    const result = resolveColorOrGradient(fill, defs);
    expect(result).toMatch(/^url\(#rg-/);
  });
});

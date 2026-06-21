import { describe, it, expect, beforeEach } from 'vitest';
import { renderConnector, type ConnectorLayer } from './layer-renderers-connector';

function svgEl(): SVGSVGElement {
  return document.createElementNS('http://www.w3.org/2000/svg', 'svg');
}

describe('renderConnector', () => {
  let svg: SVGSVGElement;
  beforeEach(() => { svg = svgEl(); });

  const base = (o: Partial<ConnectorLayer>): ConnectorLayer =>
    ({ id: 'c1', type: 'connector', from: [0, 0], to: [100, 0], ...o }) as ConnectorLayer;

  it('draws a straight path between from/to', () => {
    const g = renderConnector(base({ arrow: 'none' }), svg);
    const path = g.querySelector('path')!;
    expect(path.getAttribute('d')).toContain('M 0 0');
    expect(path.getAttribute('d')).toContain('L 100 0');
    expect(path.getAttribute('fill')).toBe('none');
  });

  it('emits an arrowhead polygon at the end by default', () => {
    const g = renderConnector(base({}), svg);
    expect(g.querySelectorAll('polygon')).toHaveLength(1);
  });

  it('emits two arrowheads when arrow=both', () => {
    const g = renderConnector(base({ arrow: 'both' }), svg);
    expect(g.querySelectorAll('polygon')).toHaveLength(2);
  });

  it('arc curve produces a quadratic bezier', () => {
    const g = renderConnector(base({ curve: 'arc' }), svg);
    expect(g.querySelector('path')!.getAttribute('d')).toContain('Q');
  });

  it('elbow curve routes orthogonally (two corner vertices)', () => {
    const g = renderConnector(base({ to: [100, 80], curve: 'elbow' }), svg);
    const d = g.querySelector('path')!.getAttribute('d')!;
    expect((d.match(/L /g) ?? []).length).toBe(3);
  });

  it('dashed sets a stroke-dasharray', () => {
    const g = renderConnector(base({ dashed: true, stroke: '#000', stroke_width: 2 }), svg);
    expect(g.querySelector('path')!.getAttribute('stroke-dasharray')).toBeTruthy();
  });

  it('accepts x1/y1/x2/y2 as an alias for from/to', () => {
    const g = renderConnector({ id: 'c', type: 'connector', x1: 5, y1: 5, x2: 50, y2: 5, arrow: 'none' } as ConnectorLayer, svg);
    expect(g.querySelector('path')!.getAttribute('d')).toContain('M 5 5');
  });
});

import { describe, it, expect } from 'vitest';
import { extractVectorTextCandidates, parseSolidColor } from './pdf-vector-text';

function svgFrom(inner: string): Element {
  const doc = new DOMParser().parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${inner}</svg>`,
    'image/svg+xml',
  );
  return doc.documentElement;
}

describe('parseSolidColor', () => {
  it('parses #rgb, #rrggbb, rgb(), and names', () => {
    expect(parseSolidColor('#fff')).toEqual([255, 255, 255]);
    expect(parseSolidColor('#00FF00')).toEqual([0, 255, 0]);
    expect(parseSolidColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseSolidColor('black')).toEqual([0, 0, 0]);
  });
  it('rejects gradients, none, and unknowns', () => {
    expect(parseSolidColor('url(#g)')).toBeNull();
    expect(parseSolidColor('none')).toBeNull();
    expect(parseSolidColor(null)).toBeNull();
    expect(parseSolidColor('hsl(1,2%,3%)')).toBeNull();
  });
});

describe('extractVectorTextCandidates', () => {
  it('extracts a simple single-line solid-fill text', () => {
    const c = extractVectorTextCandidates(svgFrom(
      '<text x="40" y="50" font-family="Inter" font-size="24" font-weight="700" text-anchor="middle" fill="#112233">Hello</text>',
    ));
    expect(c).toHaveLength(1);
    expect(c[0].runs).toHaveLength(1);
    expect(c[0].runs[0]).toMatchObject({
      text: 'Hello', x: 40, baseline: 50, fontSize: 24, family: 'Inter',
      weight: 700, anchor: 'middle', color: [17, 34, 51],
    });
  });

  it('expands multi-line tspans into one run per line with stepped baselines', () => {
    const c = extractVectorTextCandidates(svgFrom(
      '<text x="10" y="20" font-size="16" fill="#000">' +
      '<tspan x="10" dy="0">one</tspan><tspan x="10" dy="22">two</tspan></text>',
    ));
    expect(c).toHaveLength(1);
    expect(c[0].runs.map(r => [r.text, r.baseline])).toEqual([['one', 20], ['two', 42]]);
  });

  it('skips gradient-filled text (left to raster)', () => {
    expect(extractVectorTextCandidates(svgFrom(
      '<text x="0" y="10" fill="url(#grad)">grad</text>',
    ))).toHaveLength(0);
  });

  it('skips rotated/flipped text via ancestor transform', () => {
    expect(extractVectorTextCandidates(svgFrom(
      '<g transform="rotate(45 50 50)"><text x="0" y="10" fill="#000">rot</text></g>',
    ))).toHaveLength(0);
  });

  it('skips curved textPath', () => {
    expect(extractVectorTextCandidates(svgFrom(
      '<text fill="#000"><textPath href="#p">curve</textPath></text>',
    ))).toHaveLength(0);
  });

  it('skips inline rich tspans (no per-tspan x) to avoid misplacement', () => {
    expect(extractVectorTextCandidates(svgFrom(
      '<text x="0" y="10" fill="#000"><tspan font-weight="bold">a</tspan><tspan fill="#f00">b</tspan></text>',
    ))).toHaveLength(0);
  });

  it('skips text under sub-1 opacity ancestry', () => {
    expect(extractVectorTextCandidates(svgFrom(
      '<g opacity="0.5"><text x="0" y="10" fill="#000">faint</text></g>',
    ))).toHaveLength(0);
  });

  it('parses px letter-spacing into user units', () => {
    const c = extractVectorTextCandidates(svgFrom(
      '<text x="0" y="10" fill="#000" letter-spacing="3px">spaced</text>',
    ));
    expect(c[0].runs[0].letterSpacing).toBe(3);
  });
});

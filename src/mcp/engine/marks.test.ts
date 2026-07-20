import { describe, it, expect } from 'vitest';
import { opticalCenter, scaleSurvival, areaDownsample } from './marks';
import { markContrast, clearspace, contrastRatio, relativeLuminance } from './marks-contrast';
import { looksLikeMark, auditMark } from './mark-audit';
import type { RasterImage } from '../../utils/png-codec';
import type { DesignSpec } from '../../schema/types';

function raster(size: number, fill: (x: number, y: number) => [number, number, number, number]): RasterImage {
  const pixels = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * size + x) * 4;
      pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b; pixels[i + 3] = a;
    }
  }
  return { width: size, height: size, pixels };
}

const BLACK: [number, number, number, number] = [0, 0, 0, 255];
const CLEAR: [number, number, number, number] = [0, 0, 0, 0];

/** A right-pointing triangle — the classic optical-centring case. */
function playTriangle(size = 100): RasterImage {
  return raster(size, (x, y) => {
    const t = (x - 20) / 60;                 // 0 at the flat edge, 1 at the point
    if (t < 0 || t > 1) return CLEAR;
    const half = (1 - t) * 30;
    return Math.abs(y - size / 2) <= half ? BLACK : CLEAR;
  });
}

describe('opticalCenter', () => {
  it('reports no offset for a symmetric shape', () => {
    const square = raster(100, (x, y) => (x >= 20 && x < 80 && y >= 20 && y < 80 ? BLACK : CLEAR));
    const r = opticalCenter(square);
    expect(Math.abs(r.offset.x)).toBeLessThan(1);
    expect(r.needsAdjustment).toBe(false);
  });

  it('detects that a triangle\'s mass sits left of its bounding-box centre', () => {
    // This is why a play button box-centred in a circle always looks pushed
    // left: the mass is at the flat edge, the box is set by the far point.
    const r = opticalCenter(playTriangle());
    expect(r.offset.x).toBeLessThan(0);
    expect(r.needsAdjustment).toBe(true);
  });

  it('expresses the offset as a fraction of the mark, so it holds at any scale', () => {
    const small = opticalCenter(playTriangle(100));
    const large = opticalCenter(playTriangle(200));
    expect(small.offsetFraction.x).toBeCloseTo(large.offsetFraction.x, 1);
  });

  it('weights by alpha so a soft edge counts in proportion', () => {
    const soft = raster(40, (x) => (x < 20 ? BLACK : [0, 0, 0, 40]));
    const r = opticalCenter(soft);
    // The faint half pulls the centroid right of the solid half, but not fully.
    expect(r.optical.x).toBeGreaterThan(10);
    expect(r.optical.x).toBeLessThan(20);
  });

  it('handles an entirely blank raster without dividing by zero', () => {
    const r = opticalCenter(raster(20, () => CLEAR));
    expect(r.needsAdjustment).toBe(false);
    expect(Number.isFinite(r.optical.x)).toBe(true);
  });
});

describe('scaleSurvival', () => {
  it('keeps a simple bold shape legible when small', () => {
    const disc = raster(256, (x, y) => (Math.hypot(x - 128, y - 128) < 90 ? BLACK : CLEAR));
    const r = scaleSurvival(disc, [16, 32, 128]);
    expect(r.minimumSize).toBeLessThanOrEqual(32);
  });

  it('flags a mark whose detail collapses at small sizes', () => {
    // Hairline stripes: fine at 512, mud at 16.
    const stripes = raster(256, (x, y) => (x % 4 === 0 && y > 40 && y < 210 ? BLACK : CLEAR));
    const r = scaleSurvival(stripes, [16, 24, 512]);
    const smallest = r.steps[0];
    const largest = r.steps[r.steps.length - 1];
    expect(smallest.detail).toBeLessThanOrEqual(largest.detail);
  });

  it('says so when nothing reads at any size', () => {
    const blank = raster(64, () => CLEAR);
    const r = scaleSurvival(blank, [16, 32]);
    expect(r.minimumSize).toBeNull();
    expect(r.notes.join(' ')).toContain('does not read');
  });

  it('reports one step per requested size', () => {
    const disc = raster(64, (x, y) => (Math.hypot(x - 32, y - 32) < 20 ? BLACK : CLEAR));
    expect(scaleSurvival(disc, [16, 24, 32]).steps).toHaveLength(3);
  });
});

describe('areaDownsample', () => {
  it('averages rather than point-sampling, so a thin stroke is not simply dropped', () => {
    const line = raster(64, (x) => (x === 32 ? BLACK : CLEAR));
    const small = areaDownsample(line, 16);
    const anyInk = [...small.pixels].some((v, i) => i % 4 === 3 && v > 0);
    expect(anyInk).toBe(true);
  });

  it('produces the requested dimensions', () => {
    const out = areaDownsample(raster(100, () => BLACK), 16);
    expect(out.width).toBe(16);
    expect(out.height).toBe(16);
  });
});

describe('contrast', () => {
  it('computes WCAG luminance with gamma correction, not a flat average', () => {
    // A naive average would put mid-grey at 0.5; the real curve puts it far lower.
    expect(relativeLuminance([128, 128, 128])).toBeLessThan(0.3);
  });

  it('gives black on white the canonical 21:1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBeCloseTo(21, 0);
  });

  it('passes a dark mark on white and fails it on black', () => {
    const dark = raster(40, () => [20, 20, 20, 255]);
    const r = markContrast(dark);
    expect(r.cases.find(c => c.background === '#FFFFFF')?.passes).toBe(true);
    expect(r.cases.find(c => c.background === '#000000')?.passes).toBe(false);
  });

  it('passes a mid-grey mark against the defaults, because that is the truth', () => {
    // Mid grey clears 3:1 on both white and black. Failing against BOTH is in
    // fact impossible — it would need luminance above 0.3 and below 0.1 at once.
    const mid = raster(40, () => [128, 128, 128, 255]);
    const r = markContrast(mid);
    expect(r.cases.find(c => c.background === '#FFFFFF')?.passes).toBe(true);
    expect(r.cases.find(c => c.background === '#000000')?.passes).toBe(true);
  });

  it('warns when every supplied background fails', () => {
    const mid = raster(40, () => [128, 128, 128, 255]);
    const r = markContrast(mid, ['#7A7A7A', '#808080', '#8A8A8A']);
    expect(r.notes.join(' ')).toContain('every tested background');
  });

  it('ignores transparent pixels when averaging the ink', () => {
    const half = raster(40, (x) => (x < 20 ? [200, 0, 0, 255] : CLEAR));
    expect(markContrast(half).ink.toLowerCase()).toBe('#c80000');
  });
});

describe('clearspace', () => {
  it('derives a unit from the mark rather than a fixed pixel count', () => {
    const bar = raster(80, (x, y) => (y >= 38 && y < 42 && x >= 10 && x < 70 ? BLACK : CLEAR));
    const r = clearspace(bar);
    expect(r.unit).toBeGreaterThan(0);
    expect(r.padding).toBe(r.unit * 2);
  });

  it('measures the padding already present on each side', () => {
    const inset = raster(100, (x, y) => (x >= 25 && x < 75 && y >= 25 && y < 75 ? BLACK : CLEAR));
    const r = clearspace(inset);
    expect(r.current.left).toBe(25);
    expect(r.current.top).toBe(25);
  });

  it('handles a blank raster', () => {
    expect(clearspace(raster(20, () => CLEAR)).unit).toBe(0);
  });
});

describe('looksLikeMark', () => {
  const spec = (over: Record<string, unknown>): DesignSpec =>
    ({ document: { width: 512, height: 512, unit: 'px', dpi: 96 }, layers: [{ id: 'a' }], ...over }) as unknown as DesignSpec;

  it('accepts a small square single-page design', () => {
    expect(looksLikeMark(spec({}))).toBe(true);
  });

  it('rejects a multi-page carousel', () => {
    expect(looksLikeMark(spec({ pages: [{ id: 'p1', layers: [] }, { id: 'p2', layers: [] }] }))).toBe(false);
  });

  it('rejects a poster-sized canvas', () => {
    expect(looksLikeMark(spec({ document: { width: 1440, height: 1440, unit: 'px', dpi: 96 } }))).toBe(false);
  });

  it('rejects a strongly non-square canvas', () => {
    expect(looksLikeMark(spec({ document: { width: 1080, height: 400, unit: 'px', dpi: 96 } }))).toBe(false);
  });

  it('rejects a design with many layers', () => {
    expect(looksLikeMark(spec({ layers: Array.from({ length: 20 }, (_, i) => ({ id: `l${i}` })) }))).toBe(false);
  });

  it('rejects an empty design', () => {
    expect(looksLikeMark(spec({ layers: [] }))).toBe(false);
  });
});

describe('auditMark', () => {
  it('returns every measurement and tells the caller which way to nudge', () => {
    const audit = auditMark(playTriangle());
    expect(audit.optical_center).toBeDefined();
    expect(audit.scale_survival.steps.length).toBeGreaterThan(0);
    expect(audit.contrast.cases.length).toBe(3);
    expect(audit.clearspace.padding).toBeGreaterThanOrEqual(0);
    // Direction is the part a caller cannot derive from a number they can't see.
    expect(audit.notes.join(' ')).toMatch(/nudge it .*(left|right|up|down)/);
  });
});

describe('clearspace — solid forms', () => {
  it('does not mistake a solid disc\'s diameter for a stroke width', () => {
    // Live bug: a 400px disc on a 512px canvas produced "clearspace is 696px",
    // because the median ink run THROUGH a solid shape is its own diameter.
    const disc = raster(512, (x, y) => (Math.hypot(x - 256, y - 256) < 200 ? BLACK : CLEAR));
    const r = clearspace(disc);
    expect(r.padding).toBeLessThan(512);
    expect(r.unitBasis).toContain('solid form');
    expect(r.unit).toBeCloseTo(40, -1); // ~1/10 of the 400px mark
  });

  it('still uses the real stroke width for a stroked mark', () => {
    const bars = raster(200, (x, y) => (y % 20 < 6 && x >= 20 && x < 180 ? BLACK : CLEAR));
    const r = clearspace(bars);
    expect(r.unitBasis).toContain('stroke');
  });
});

describe('opticalCenter — documented limit', () => {
  it('cannot see an inner element inside an opaque outer one', () => {
    // A white triangle on a solid disc is opaque everywhere, so the centroid is
    // the disc's. The guide says so explicitly rather than implying otherwise.
    const disc = raster(200, (x, y) => {
      if (Math.hypot(x - 100, y - 100) >= 80) return CLEAR;
      const t = (x - 70) / 50;
      const inTri = t >= 0 && t <= 1 && Math.abs(y - 100) <= (1 - t) * 40;
      return inTri ? [255, 255, 255, 255] : [27, 110, 243, 255];
    });
    const r = opticalCenter(disc);
    expect(Math.abs(r.offsetFraction.x)).toBeLessThan(0.02);
    expect(r.needsAdjustment).toBe(false);
  });

  it('does detect a silhouette sitting off-centre on its canvas', () => {
    const tri = raster(200, (x, y) => {
      const t = (x - 40) / 120;
      return t >= 0 && t <= 1 && Math.abs(y - 100) <= (1 - t) * 60 ? BLACK : CLEAR;
    });
    expect(opticalCenter(tri).needsAdjustment).toBe(true);
  });
});

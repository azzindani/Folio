import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { widthClasses, classEms } from './font-widths';
import { metricsForFamily, charOffsets } from './font-metrics';

const FONTS = path.resolve(__dirname, '../mcp/fonts');

/** The real advance of a line, from the TTF itself. */
function realEm(family: string, weight: number, text: string): number {
  const m = metricsForFamily(family, [FONTS], weight);
  if (!m) throw new Error(`no metrics for ${family}`);
  return charOffsets(text, 1, m).total;
}

describe('widthClasses', () => {
  it('finds a bundled face by any spelling of its family, at the nearest weight', () => {
    expect(widthClasses('Caveat', 700)).not.toBeNull();
    expect(widthClasses('"Bebas Neue", sans-serif')).not.toBeNull();
    expect(widthClasses('bebasneue', 'bold')?.classes).toEqual(widthClasses('Bebas Neue', 400)?.classes);   // one weight bundled
    expect(widthClasses('Nonesuch Grotesk')).toBeNull();
    expect(widthClasses(undefined)).toBeNull();
  });

  it('is generated from the fonts on disk (re-run npm run gen:widths after adding one)', () => {
    const table = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'font-widths.json'), 'utf8')) as Record<string, unknown>;
    expect(Object.keys(table).length).toBeGreaterThanOrEqual(50);
  });
});

describe('classEms — a line within a few percent of the real face', () => {
  // benchmark r3: "Nori & Broth" in Caveat Bold wrapped in a 780px box at 140px,
  // measured at 0.52 em a glyph; it draws ~650px.
  const cases: Array<[string, number, string]> = [
    ['Caveat', 700, 'Nori & Broth'],
    ['Bebas Neue', 400, 'THERE IS NO PLANET B'],
    ['Archivo', 900, 'BLACK FRIDAY SALE'],
    ['Inter', 400, 'Air keeps the heap working and stops the smell.'],
    ['DM Sans', 700, 'Iced barley tea 3'],
    // One word — the class average put it 16% wide and it broke mid-token.
    ['Archivo', 900, 'DRIFT'],
    ['Archivo', 900, 'ICE COLD.'],
  ];
  for (const [family, weight, text] of cases) {
    it(`${family} ${weight}: "${text}"`, () => {
      const c = widthClasses(family, weight);
      expect(c).not.toBeNull();
      if (!c) return;
      const est = classEms(c, text), real = realEm(family, weight, text);
      expect(Math.abs(est - real) / real).toBeLessThan(0.05);
    });
  }
});

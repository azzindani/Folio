import { describe, it, expect } from 'vitest';
import { wrapPlainText } from './layer-renderers-shared';
import { estTextHeight } from '../mcp/engine/text-measure';
import { estTextHeight as estTextHeightPresets } from '../mcp/shorthand-helpers';
import { textEms, isWideChar } from '../utils/text-width';

// The engine's stated job is spatial correctness, and every layout decision
// rests on measuring text. Both the renderer's wrapper and the engine's height
// estimator counted `string.length` at a flat ~0.52 em.
//
// Measured live on an 800x700 canvas, a 66-glyph Chinese paragraph in a
// 700x120 box at 32px:
//   • the engine "measured" it at 84px and SHRANK the model's 120px box to fit
//   • the renderer never wrapped it — CJK has no spaces, so the paragraph was
//     one token — and it rendered as a single line running to x=799, clipped
//     by the canvas edge
//   • diagnose_design reported 0 errors, 0 warnings: "No problems"
// The instrument shared the bug with the thing it was measuring.

const CJK = '空间正确性是引擎的工作每一个布局决策都建立在测量一段换行文本在页面上实际渲染高度的基础之上排版必须准确无误否则文字会溢出边界';
const LATIN = 'Spatial correctness is the engine job and every layout decision rests upon measuring how tall a wrapped block of running text will actually render.';

const widest = (lines: string[], fontSize: number, narrowEm = 0.52): number =>
  Math.max(...lines.map(l => textEms(l, narrowEm) * fontSize));

describe('character width classes', () => {
  it('knows Han, Kana and Hangul are full-width', () => {
    for (const ch of ['空', 'あ', 'カ', '한', '，']) expect(isWideChar(ch), ch).toBe(true);
  });

  it('leaves Latin, Cyrillic and Arabic narrow', () => {
    for (const ch of ['a', 'Z', 'д', 'ع', '9']) expect(isWideChar(ch), ch).toBe(false);
  });

  it('counts an astral emoji once, not twice', () => {
    // '🎯'.length === 2 in UTF-16 — the old code charged it double.
    expect('🎯'.length).toBe(2);
    expect(textEms('🎯', 0.52)).toBeCloseTo(0.52, 5);
  });
});

describe('wrapping text that has no spaces', () => {
  it('breaks a CJK paragraph into lines that FIT the box', () => {
    const lines = wrapPlainText(CJK, 700, 32);
    expect(lines.length, 'CJK never wrapped — one endless line').toBeGreaterThan(1);
    expect(widest(lines, 32)).toBeLessThanOrEqual(700);
  });

  it('breaks a single over-long token, like a URL', () => {
    const url = 'https://example.com/a/very/long/path/that/never/contains/a/space/at/all/ever';
    const lines = wrapPlainText(url, 300, 20);
    expect(lines.length).toBeGreaterThan(1);
    expect(widest(lines, 20)).toBeLessThanOrEqual(300);
  });

  it('keeps every glyph — breaking must not drop content', () => {
    expect(wrapPlainText(CJK, 700, 32).join('')).toBe(CJK);
  });
});

describe('plain Latin wraps exactly as it did', () => {
  it('same line count and content at a typical size', () => {
    const lines = wrapPlainText(LATIN, 700, 32);
    // Reproduces the ORIGINAL algorithm: count characters against
    // floor(maxWidth / (fontSize * 0.52)).
    const maxChars = Math.floor(700 / (32 * 0.52));
    const legacy: string[] = [];
    let cur = '';
    for (const w of LATIN.split(' ')) {
      if (!cur) cur = w;
      else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w;
      else { legacy.push(cur); cur = w; }
    }
    legacy.push(cur);
    expect(lines).toEqual(legacy);
  });

  it('honours an explicit per-char width for wide runs', () => {
    const narrow = wrapPlainText(LATIN, 400, 20);
    const wide = wrapPlainText(LATIN, 400, 20, 20 * 0.75);
    expect(wide.length).toBeGreaterThan(narrow.length);
  });

  it('still respects explicit newlines', () => {
    expect(wrapPlainText('one\ntwo', 900, 16)).toEqual(['one', 'two']);
  });
});

describe('the estimator agrees with the renderer', () => {
  // The invariant that was missing. These two live in different modules and
  // must answer the same question the same way; when they drifted, diagnose
  // blessed a design whose text was off the canvas.
  const cases: Array<[string, string, number, number]> = [
    ['latin', LATIN, 700, 32],
    ['cjk', CJK, 700, 32],
    ['cjk narrow box', CJK, 300, 24],
    ['mixed', `Folio ${CJK.slice(0, 20)} engine`, 500, 28],
  ];

  for (const [name, text, width, size] of cases) {
    it(`${name}: the estimate is EXACTLY the lines rendered`, () => {
      // Exact, not approximate: both now call utils/text-width.wrapToWidth, so
      // they cannot drift. Before, the estimator had its own arithmetic and
      // under-counted (5 vs 6 lines here, 2 vs 3 there).
      const rendered = wrapPlainText(text, width, size).length;
      const estimated = Math.round(estTextHeight(text, size, width, 1.3) / (size * 1.3));
      expect(estimated, `estimate ${estimated} lines vs ${rendered} rendered`).toBe(rendered);
    });
  }

  it('the CJK estimate is no longer about half the truth', () => {
    const rendered = wrapPlainText(CJK, 700, 32).length;
    expect(estTextHeight(CJK, 32, 700, 1.3)).toBeGreaterThanOrEqual(rendered * 32 * 1.3 - 1);
  });
});

describe('all THREE copies of the rule agree', () => {
  // There were three: the renderer wraps, engine/text-measure estimates for
  // diagnose, and shorthand-helpers estimates for the presets and finalize
  // passes (10 modules). Fixing the first two left the third untouched — the
  // live CJK box still came back 84px after deploying, because the pass that
  // sets the height imports estTextHeight from shorthand-parser, not from
  // engine/text-measure. Same name, same job, different file.
  const cases: Array<[string, string, number, number]> = [
    ['latin', LATIN, 700, 32],
    ['cjk', CJK, 700, 32],
    ['cjk narrow', CJK, 300, 24],
    ['long url', 'https://example.com/a/very/long/path/without/any/spaces/in/it', 280, 18],
  ];
  for (const [name, text, width, size] of cases) {
    it(`${name}: renderer, diagnose and presets report the same lines`, () => {
      const rendered = wrapPlainText(text, width, size).length;
      const viaDiagnose = Math.round(estTextHeight(text, size, width, 1.3) / (size * 1.3));
      const viaPresets = Math.round(estTextHeightPresets(text, size, width, 1.3, 0.52) / (size * 1.3));
      expect(viaDiagnose, 'diagnose disagrees with the renderer').toBe(rendered);
      expect(viaPresets, 'the preset estimator disagrees with the renderer').toBe(rendered);
    });
  }
});

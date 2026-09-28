import { describe, it, expect } from 'vitest';
import type { DesignSpec, Layer } from '../../schema/types';
import { joinSplitPieces } from './split-join';
import { collectFindings } from './diagnose-collect';

const piece = (id: string, of: string, value: string, x: number, y = 300, extra: object = {}): Layer =>
  ({ id, type: 'text', z: 3, x, y, width: 30 + 20 * value.length, height: 80, split_of: of, content: { type: 'plain', value },
     style: { font_size: 64, font_family: 'Fraunces', color: '#F4E9D0' }, animation: { keyframes: [{ t: 0, y: 20 }, { t: 400, y: 0 }] }, ...extra } as unknown as Layer);

describe('joinSplitPieces — a split line as the line it reads as', () => {
  it('joins word pieces with spaces and letters without, over the union of their boxes', () => {
    const words = ['He', 'was', 'here'].map((w, i) => piece(`q_w${i + 1}`, 'q', w, 100 + 120 * i));
    const [line, ...rest] = joinSplitPieces(words) as unknown as Array<Record<string, unknown>>;
    expect(rest).toEqual([]);
    expect(line).toMatchObject({ id: 'q_w1', x: 100, content: { value: 'He was here' } });
    expect(line?.['animation']).toBeUndefined();
    const masked = [...'DEV'].map((c, i) => ({ id: `t_mask${i + 1}`, type: 'group', z: 2, clip: true, x: 100 + 60 * i, y: 300, width: 60, height: 90,
      layers: [piece(`t_c${i + 1}`, 't', c, 100 + 60 * i)] } as unknown as Layer));
    expect((joinSplitPieces([{ id: 'page', type: 'group', z: 1, layers: masked } as unknown as Layer])[0] as unknown as { layers: Array<{ content: { value: string } }> }).layers.map(l => l.content.value)).toEqual(['DEV']);
  });

  it('does not re-wrap a line its pieces hold on one line', () => {
    // Found live (rag-library): op:text placed "How many leave days can I carry over?" by the font's
    // advances; joined, the union was 529px, the wrap rule read the sentence a hair wider, and the
    // gate called it a 2-line overflow "running out of" the bubble it sits in.
    const at = [[360, 63], [428, 75], [510, 74], [590, 66], [663, 50], [719, 8], [734, 72], [812, 77]] as const;
    const words = 'How many leave days can I carry over?'.split(' ').map((w, i) => ({ id: `q_t_w${i + 1}`, type: 'text', z: 2, x: at[i]?.[0], y: 308,
      width: at[i]?.[1], height: 39.2, split_of: 'q_t', content: { type: 'plain', value: w }, style: { font_family: 'Inter', font_size: 28, font_weight: 600, color: '#FBF6EC' } } as unknown as Layer));
    const spec = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1350 },
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1350, fill: '#FBF6EC' },
        { id: 'q', type: 'group', z: 1, layers: [{ id: 'q_bg', type: 'rect', z: 1, x: 330, y: 286, width: 660, height: 84, radius: 28, fill: '#1F4D3A' }, ...words] }] } as unknown as DesignSpec;
    expect(collectFindings(spec, '/nowhere/d.design.yaml').filter(f => f.code === 'text_overflow').map(f => f.message)).toEqual([]);
    const [line] = joinSplitPieces(words) as unknown as Array<{ x: number; width: number }>;
    expect(line?.x).toBe(360);
    expect(line?.width).toBeGreaterThanOrEqual(529);
  });

  it('keeps diagnose from judging a split quote word by word', () => {
    const words = 'He was here by nine and it was fixed by ten'.split(' ').map((w, i) =>
      piece(`q_w${i + 1}`, 'q', w, 90 + (i % 6) * 150 + (i === 3 ? 2 : 0), 300 + Math.floor(i / 6) * 90));
    const spec = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#101820' }, ...words] } as unknown as DesignSpec;
    const noise = collectFindings(spec, '/nowhere/d.design.yaml').filter(f => /left edges|almost left-aligned|accent hue/.test(f.message));
    expect(noise).toEqual([]);
  });
});

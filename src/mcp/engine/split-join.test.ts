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

  it('keeps diagnose from judging a split quote word by word', () => {
    const words = 'He was here by nine and it was fixed by ten'.split(' ').map((w, i) =>
      piece(`q_w${i + 1}`, 'q', w, 90 + (i % 6) * 150 + (i === 3 ? 2 : 0), 300 + Math.floor(i / 6) * 90));
    const spec = { meta: { id: 'd', name: 'D', type: 'poster' }, document: { width: 1080, height: 1080 },
      layers: [{ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: '#101820' }, ...words] } as unknown as DesignSpec;
    const noise = collectFindings(spec, '/nowhere/d.design.yaml').filter(f => /left edges|almost left-aligned|accent hue/.test(f.message));
    expect(noise).toEqual([]);
  });
});

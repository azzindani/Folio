import { describe, it, expect } from 'vitest';
import { buildRibbonCards, buildValueList } from './shorthand-presets-cards';
import type { Layer } from '../schema/types';

type L = Record<string, unknown> & { id: string; type: string; layers?: L[] };
function flat(g: Layer): L[] {
  const out: L[] = [];
  const walk = (l: L): void => { out.push(l); (l.layers ?? []).forEach(walk); };
  walk(g as unknown as L);
  return out;
}

const TIPS = {
  type: 'ribbon_cards', title: '4 SOCIAL MEDIA TIPS', pos: [0, 0, 1080, 1500],
  items: [
    { title: 'Strong hooks', bullets: ['Curiosity openers', 'Stop the scroll'] },
    { title: 'Short videos', bullets: ['5-12 seconds', 'Fast cuts', 'One topic'] },
    { title: 'Shareable content', bullets: ['Tips', 'Checklists'] },
    { title: 'Ask questions', bullets: ['Agree?', 'Which one?'] },
  ],
};

describe('buildRibbonCards', () => {
  const g = buildRibbonCards(TIPS as never, 'rc', 0);
  const ls = flat(g);

  it('emits one ribbon, body and number badge per card', () => {
    expect(ls.filter(l => /^rc_rb\d+$/.test(l.id))).toHaveLength(4);   // ribbon banners
    expect(ls.filter(l => /^rc_bn\d+$/.test(l.id))).toHaveLength(4);   // number badges
  });

  it('numbers the badges 01..04', () => {
    const nums = ls.filter(l => /^rc_bn\d+$/.test(l.id))
      .map(n => String((n.content as { value?: unknown })?.value ?? '')).sort();
    expect(nums).toEqual(['01.', '02.', '03.', '04.']);
  });

  it('the body of a card starts BELOW its ribbon (no overlap)', () => {
    const rb0 = ls.find(l => l.id === 'rc_rb0') as L;       // ribbon path at card top
    const bd0 = ls.find(l => l.id === 'rc_bd0') as L;       // body text
    const ribbonBottom = (rb0.y as number) + (rb0.height as number);
    expect(bd0.y as number).toBeGreaterThanOrEqual(ribbonBottom - 1);
  });

  it('fills a taller-than-content canvas (group height honors H)', () => {
    expect((g as unknown as L).height as number).toBeGreaterThanOrEqual(1500);
  });
});

const VALUES = {
  type: 'value_list', kicker: 'these are our', title: 'Brand Values', brand: 'Salford & Co.',
  pos: [0, 0, 1080, 1530],
  items: [
    { title: 'Integrity', desc: 'Doing the right thing.' },
    { title: 'Innovation', desc: 'Seeking new ways.' },
    { title: 'Customer Focus', desc: 'Customer at the heart.' },
  ],
};

describe('buildValueList', () => {
  const g = buildValueList(VALUES as never, 'vl', 0);
  const ls = flat(g);

  it('renders a rotated word-number per row', () => {
    const nums = ls.filter(l => /^vl_num\d+$/.test(l.id));
    expect(nums).toHaveLength(3);
    expect(nums.every(n => (n as { rotation?: number }).rotation === -90)).toBe(true);
    expect(String((nums[0].content as { value?: unknown })?.value ?? '')).toBe('one');
  });

  it('draws a dashed divider between rows (n-1)', () => {
    expect(ls.filter(l => /^vl_div\d+$/.test(l.id) && l.type === 'line')).toHaveLength(2);
  });

  it('renders the brand tag and title', () => {
    expect(ls.find(l => l.id === 'vl_brand')).toBeTruthy();
    expect(ls.find(l => l.id === 'vl_title')).toBeTruthy();
  });

  it('digits mode numbers 01,02,03 instead of words', () => {
    const g2 = buildValueList({ ...VALUES, numbering: 'digits' } as never, 'vl', 0);
    const n0 = flat(g2).find(l => l.id === 'vl_num0') as L;
    expect(String((n0.content as { value?: unknown })?.value ?? '')).toBe('01');
  });
});

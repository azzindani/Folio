import { describe, it, expect } from 'vitest';
import { buildNewsletter } from './shorthand-presets-news';
import type { Layer } from '../schema/types';

type L = Record<string, unknown> & { id: string; type: string; layers?: L[] };
function flat(g: Layer): L[] {
  const out: L[] = [];
  const walk = (l: L): void => { out.push(l); (l.layers ?? []).forEach(walk); };
  walk(g as unknown as L);
  return out;
}

const NL = {
  type: 'newsletter', title: 'Springtime Connections', subtitle: 'Community Newsletter', date: 'April 2030',
  pos: [0, 0, 1080, 1530],
  intro_title: 'A Note', intro: 'Spring is for renewal and reconnection.',
  sections: [
    { title: 'Thank Your Neighbors', desc: 'Celebrate the people.' },
    { title: 'Wellness Tips', desc: 'Refresh.', bullets: ['Walks', 'Food', 'Mindfulness'] },
    { title: 'Community Events', desc: 'Discover.', bullets: ['Cleanups', 'Art walks'] },
    { title: 'Book Suggestions', desc: 'Curl up with a good book.' },
  ],
  footer: 'Community Contacts',
};

describe('buildNewsletter', () => {
  const g = buildNewsletter(NL as never, 'nl', 0);
  const ls = flat(g);

  it('renders masthead, a border frame, and honors the A4 canvas', () => {
    expect(ls.find(l => l.id === 'nl_title')).toBeTruthy();
    expect(ls.find(l => l.id === 'nl_frame' && l.type === 'rect')).toBeTruthy();
    expect((g as unknown as L).height).toBe(1530);
  });

  it('boxes the lead + every section + footer (each a pill-tag panel)', () => {
    // lead (box0) + 4 sections (box1..4) + footer (box5) = 6 boxes
    expect(ls.filter(l => /^nl_box\d+$/.test(l.id))).toHaveLength(6);
  });

  it('lays sections across two columns (some x at the left gutter, some at the right)', () => {
    const sectionBoxes = ls.filter(l => /^nl_box[1-4]$/.test(l.id)) as L[];
    const xs = new Set(sectionBoxes.map(b => Math.round((b.x as number) / 10)));
    expect(xs.size).toBeGreaterThan(1); // not all in one column
  });

  it('bulleted bodies are left-aligned, prose bodies centered', () => {
    const wellness = ls.find(l => l.id === 'nl_bd2') as L; // has bullets
    const thanks = ls.find(l => l.id === 'nl_bd1') as L;    // prose
    expect((wellness.style as { align?: string }).align).toBe('left');
    expect((thanks.style as { align?: string }).align).toBe('center');
  });
});

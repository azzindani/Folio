import { describe, it, expect } from 'vitest';
import { collapseDuplicateSections } from './engine-finalize-dedupe';
import type { Layer } from '../schema/types';

const text = (id: string, value: string, y: number, h = 40): Layer =>
  ({ id, type: 'text', z: 10, x: 80, y, width: 900, height: h, content: { type: 'plain', value } } as unknown as Layer);

const section = (id: string, y: number, heading: string, body: string): Layer =>
  ({
    id, type: 'group', z: 10, x: 0, y, width: 1080, height: 600,
    layers: [
      text(`${id}_h`, heading, y + 40, 60),
      text(`${id}_b`, body, y + 120, 120),
    ],
  } as unknown as Layer);

const bg = (): Layer => ({ id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 4000, fill: { type: 'solid', color: '#fff8f0' } } as unknown as Layer);

describe('collapseDuplicateSections (WP-3.5 — 120B thrash rescue)', () => {
  it('drops later copies of an identical section and keeps the first', () => {
    const layers = [
      bg(),
      section('s1', 400, "What's Inside", 'Three rotating single-origin espressos, curated monthly'),
      section('s2', 1100, "What's Inside", 'Three rotating single-origin espressos, curated monthly'),
      section('s3', 1800, "What's Inside", 'Three rotating single-origin espressos, curated monthly'),
      text('cta', 'Join the waitlist at emberoak.coffee — code EMBER20', 2600),
    ];
    const removed = collapseDuplicateSections(layers, 1080, 4000);
    expect(removed).toBe(2);
    const ids = layers.map(l => l.id);
    expect(ids).toContain('s1');
    expect(ids).not.toContain('s2');
    expect(ids).not.toContain('s3');
    // the gap the removed copies left collapses to MAX_GAP (160): the kept
    // section ends at y=1000, so the CTA at 2600 moves up to 1160
    const cta = layers.find(l => l.id === 'cta') as unknown as { y: number };
    expect(cta.y).toBe(1160);
    // background never shifts
    expect((layers.find(l => l.id === 'bg') as unknown as { y: number }).y).toBe(0);
  });

  it('keeps the TOPMOST copy even when duplicates are listed first', () => {
    const layers = [
      section('later', 2000, 'Launch Offer Details', '20% off your first box with code EMBER20 at checkout'),
      section('first', 300, 'Launch Offer Details', '20% off your first box with code EMBER20 at checkout'),
    ];
    collapseDuplicateSections(layers, 1080, 3000);
    expect(layers.map(l => l.id)).toEqual(['first']);
  });

  it('leaves legitimate short repetition alone', () => {
    const layers = [
      text('a', 'EMBER & OAK', 100),
      text('b', 'EMBER & OAK', 900), // deliberate brand echo — sig < 24 chars
      section('s1', 300, 'Our roasting philosophy', 'Small batches, roasted the week they ship to you'),
    ];
    expect(collapseDuplicateSections(layers, 1080, 1350)).toBe(0);
    expect(layers).toHaveLength(3);
  });

  it('drops identical rows nested inside DIFFERENT groups (near-duplicate sections)', () => {
    const row = (id: string, y: number): Layer => text(id, 'Ethiopia, Colombia, Guatemala — a new origin every month', y);
    const g = (id: string, y: number, extra: Layer[]): Layer =>
      ({ id, type: 'group', z: 10, x: 0, y, width: 1080, height: 500, layers: extra } as unknown as Layer);
    const layers = [
      g('secA', 300, [text('hA', "What's Inside heading here", 340), row('rA', 420)]),
      g('secB', 900, [row('rB', 940), text('uniq', 'Fresh-roasted the week it ships, never sits on a shelf', 1020)]),
    ];
    const removed = collapseDuplicateSections(layers, 1080, 2000);
    expect(removed).toBe(1);
    const secB = layers.find(l => l.id === 'secB') as unknown as { layers: Layer[] };
    expect(secB.layers.map(l => l.id)).toEqual(['uniq']);
    // the kept parent's own copy is untouched
    const secA = layers.find(l => l.id === 'secA') as unknown as { layers: Layer[] };
    expect(secA.layers.map(l => l.id)).toEqual(['hA', 'rA']);
  });

  // A repeated string in a DIFFERENT visual role is deliberate design, not a
  // rebuild artifact: the 4K conference poster printed its repo URL small+teal
  // in the header and again big+white in the footer CTA, and the CTA copy was
  // silently deleted (both ≥24 chars, identical characters).
  it('keeps a repeated string that carries a different visual role', () => {
    const styled = (id: string, value: string, y: number, size: number, color: string): Layer =>
      ({
        id, type: 'text', z: 10, x: 2700, y, width: 900, height: 50,
        content: { type: 'plain', value }, style: { font_size: size, color },
      } as unknown as Layer);
    const url = 'github.com/azzindani/Folio';
    const layers = [
      styled('header_url', url, 212, 26, '#0FA3A3'),   // header credit
      styled('cta_url', url, 1774, 34, '#FFFFFF'),     // footer CTA
    ];
    expect(collapseDuplicateSections(layers, 3840, 2160)).toBe(0);
    expect(layers.map(l => l.id)).toEqual(['header_url', 'cta_url']);
  });

  // Same words, same style, but side by side = a deliberate multi-column layout
  // (identical cards in a grid), not a model stamping the block down one column.
  it('keeps identical blocks that sit side by side rather than stacked', () => {
    const col = (id: string, x: number): Layer =>
      ({
        id, type: 'group', z: 10, x, y: 400, width: 800, height: 300,
        layers: [{
          id: `${id}_t`, type: 'text', z: 11, x, y: 420, width: 760, height: 60,
          content: { type: 'plain', value: 'Unlimited seats, priority support, audit log' },
        } as unknown as Layer],
      } as unknown as Layer);
    const layers = [col('colA', 100), col('colB', 1000)];
    expect(collapseDuplicateSections(layers, 3840, 2160)).toBe(0);
    expect(layers.map(l => l.id)).toEqual(['colA', 'colB']);
  });

  it('drops a stacked short-text echo but keeps a far-apart deliberate echo', () => {
    const layers = [
      text('offer1', '20% Off First Box', 560, 34),
      text('offer2', '20% Off First Box', 596, 34),   // stacked directly below → echo
      text('brand1', 'Espresso Subscription', 100, 30),
      text('brand2', 'Espresso Subscription', 1200, 30), // far apart → deliberate
    ];
    const removed = collapseDuplicateSections(layers, 1080, 1350);
    expect(removed).toBe(1);
    const ids = layers.map(l => l.id);
    expect(ids).toEqual(['offer1', 'brand1', 'brand2']);
  });

  it('drops repeated identical images ONLY when text thrash was detected', () => {
    const img = (id: string, y: number): Layer =>
      ({ id, type: 'image', z: 5, x: 80, y, width: 460, height: 620, src: 'assets/images/hero.png' } as unknown as Layer);
    // clean design: repeated image alone is never touched
    const clean = [img('i1', 100), img('i2', 900)];
    expect(collapseDuplicateSections(clean, 1080, 2000)).toBe(0);
    // thrash design: duplicate section trips the gate → image copies collapse too
    const thrash = [
      img('i1', 100), img('i2', 900), img('i3', 1700),
      section('s1', 300, "What's Inside", 'Three rotating single-origin espressos, curated monthly'),
      section('s2', 1100, "What's Inside", 'Three rotating single-origin espressos, curated monthly'),
    ];
    const removed = collapseDuplicateSections(thrash, 1080, 2400);
    expect(removed).toBe(3); // 1 section + 2 image copies
    expect(thrash.filter(l => l.type === 'image').map(l => l.id)).toEqual(['i1']);
  });

  it('leaves distinct sections alone', () => {
    const layers = [
      section('s1', 300, "What's Inside", 'Three rotating single-origin espressos, curated monthly'),
      section('s2', 1000, 'How it works', 'Pick a grind, we roast to order and ship every month'),
    ];
    expect(collapseDuplicateSections(layers, 1080, 2000)).toBe(0);
    expect(layers).toHaveLength(2);
  });
});

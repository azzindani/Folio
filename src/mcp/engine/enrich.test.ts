import { describe, it, expect } from 'vitest';
import { enrichBrief } from './enrich';

type Enriched = {
  success: boolean; design_type?: string; needs_research?: boolean;
  research_queries?: string[]; outline?: unknown; suggested?: { bg_style?: string; width?: number; height?: number };
  canvas?: { width: number; height: number }; instruction?: string;
};
const run = (prompt: string, type?: string) => enrichBrief({ prompt, type }) as unknown as Enriched;

describe('enrichBrief — thin prompt → rich plan', () => {
  it('a "state of" report → sections, research ON, 4 queries, tall canvas, block outline', () => {
    const r = run('the state of remote work 2026');
    expect(r.design_type).toBe('sections');
    expect(r.needs_research).toBe(true);
    expect(r.research_queries!.length).toBe(4);
    expect(r.research_queries!.every(q => q.toLowerCase().includes('remote work'))).toBe(true);
    expect(r.canvas!.height).toBeGreaterThanOrEqual(1920);
    expect(Array.isArray(r.outline)).toBe(true);
    expect((r.outline as string[]).length).toBeGreaterThanOrEqual(6);
  });

  it('infers a numbered list and skips research', () => {
    const r = run('5 tips for better sleep');
    expect(r.design_type).toBe('list');
    expect(r.needs_research).toBe(false);
    expect(r.research_queries!.length).toBe(0);
  });

  it('infers feature_grid from product/feature language', () => {
    const r = run('a feature poster for my CI/CD platform');
    expect(r.design_type).toBe('feature_grid');
  });

  it('a product/app LAUNCH is a feature_grid, not an event (the "launch" trap)', () => {
    expect(run('a launch poster for a productivity app').design_type).toBe('feature_grid');
    expect(run('the launch of our new developer tool').design_type).toBe('feature_grid');
    // a real event with no product noun still routes to event
    expect(run('a flyer for a design systems conference').design_type).toBe('event');
  });

  it('a craft/artisan MARKET or FAIR routes to event, not a sections infographic', () => {
    // bare "market" is finance/research, but a real-world market/fair is a poster —
    // without this it fell through to sections + a fabricated donut chart.
    expect(run('a poster for a botanical artisan market').design_type).toBe('event');
    expect(run('a farmers market poster, first sunday monthly').design_type).toBe('event');
    expect(run('flyer for the village craft fair').design_type).toBe('event');
    expect(run('a holiday makers market at the old glasshouse').design_type).toBe('event');
    // a genuine finance/research "market" brief must NOT be hijacked to event
    expect(run('the state of the AI market in 2025, with adoption data').design_type).toBe('sections');
  });

  it('a tech topic gets a dark mood with a procedural grained background', () => {
    const r = run('the state of AI in healthcare') as unknown as { suggested: { bg: string; bg_style: string } };
    expect(r.suggested.bg.toLowerCase()).toBe('#0e0b14'); // indigo tech mood (colour is curated)
    expect(r.suggested.bg_style).toContain('grain');      // procedural geometry, grain floor
  });

  it('a money/cost topic gets the DARK dramatic gold mood (not flat cream)', () => {
    const r = run('the financial cost of unnecessary meetings to US business') as unknown as { suggested: { bg: string; accent: string; bg_style: string } };
    expect(r.suggested.bg.toLowerCase()).toBe('#0a0a0a');
    expect(r.suggested.accent.toLowerCase()).toBe('#f4b740');
    expect(r.suggested.bg_style).toContain('grain');
  });

  it('unmatched topics get VARIED but STABLE moods (no single same-template default)', () => {
    const sug = (p: string) => (run(p) as unknown as { suggested: { bg: string; accent: string; bg_style: string } }).suggested;
    // Same topic ⇒ identical art-direction every time (deterministic, no Math.random).
    expect(sug('a poster about origami cranes')).toEqual(sug('a poster about origami cranes'));
    // A spread of unrelated, lane-less topics must NOT all collapse to one bg —
    // this is the "same template" complaint, now fixed by the hashed mood bank.
    const topics = ['origami cranes', 'lighthouse keepers', 'vintage typewriters',
      'desert mirages', 'paper airplanes', 'abandoned subway stations', 'tea ceremonies', 'glassblowing'];
    const bgs = new Set(topics.map(t => sug(`a poster about ${t}`).bg));
    expect(bgs.size).toBeGreaterThanOrEqual(4); // genuine variety, not one charcoal default
    // every bg_style still carries grain (the texture floor that kills the flat-AI look)
    expect(topics.every(t => sug(`a poster about ${t}`).bg_style.includes('grain'))).toBe(true);
  });

  it('the same KNOWN-domain topics map to apt, distinct moods (ocean≠money≠tech)', () => {
    const bg = (p: string) => (run(p) as unknown as { suggested: { bg: string } }).suggested.bg.toLowerCase();
    const ocean = bg('deep sea creatures of the abyss');
    const money = bg('the financial cost of meetings to business');
    const tech = bg('the state of AI developer tools');
    expect(new Set([ocean, money, tech]).size).toBe(3); // three different art-directions
  });

  it('an explicit type hint overrides inference', () => {
    const r = run('quarterly numbers', 'stat');
    expect(r.design_type).toBe('stat');
  });

  it('the stat plan demands a full-sentence caption + a required source, and a portrait canvas', () => {
    const r = run('the $37B cost of meetings', 'stat');
    const fields = (r.outline as string[]).join(' | ');
    expect(fields).toMatch(/full sentence/i);
    expect(fields).toMatch(/source/i);
    expect(r.canvas!.height).toBeGreaterThan(r.canvas!.width); // portrait
    expect(r.instruction!).toMatch(/EXACTLY \d+×\d+/);
    expect(r.instruction!).toMatch(/always include the source/i);
  });

  it('the instruction tells the model to research first and fill every slot', () => {
    const r = run('the state of electric vehicles');
    expect(r.instruction!).toMatch(/research/i);
    expect(r.instruction!).toMatch(/bg_style/);
  });

  it('steers to ONE preset layer, never hand-placed text (the editorial loop fix)', () => {
    const r = run('an opinion essay: make software boring', 'editorial');
    expect(r.instruction!).toMatch(/ONE layer/);
    expect(r.instruction!).toMatch(/NEVER hand-place/i);
  });

  it('directs a topic-apt motif to fill side space on dense posters, conditional on minimal ones', () => {
    const bolt = run('how lightning forms');                    // explainer → blocks-based (dense)
    expect(bolt.instruction!).toMatch(/type:"motif"/);
    expect(bolt.instruction!).toMatch(/motif:"bolt"/);          // topic → bolt
    expect(bolt.instruction!).toMatch(/fill the open side space/i); // DIRECTIVE on a dense poster
    const tech = run('how neural networks learn');
    expect(tech.instruction!).toMatch(/motif:"(circuit|orbit)"/); // tech/network topic → tech motif
    const essay = run('an opinion essay: make software boring', 'editorial'); // minimal/fields
    expect(essay.instruction!).toMatch(/IF the finished layout/i); // CONDITIONAL — preserves whitespace
  });

  it('does NOT direct a motif onto a full-width layout (versus/pricing/timeline span the canvas)', () => {
    // A comparison's versus table fills the full width — there is no open side
    // column, so the motif must be CONDITIONAL, not directed into width*0.6.
    const cmp = run('monolith vs microservices');
    expect(cmp.design_type).toBe('comparison');
    expect(cmp.instruction!).toMatch(/IF the finished layout/i);   // conditional
    expect(cmp.instruction!).not.toMatch(/fill the open side space/i);
    const price = run('pricing plans for our SaaS', 'pricing');
    expect(price.instruction!).toMatch(/IF the finished layout/i);
    // a left-anchored explainer still gets the DIRECTIVE (it leaves a real column)
    const proc = run('how lightning forms');
    expect(proc.instruction!).toMatch(/fill the open side space/i);
  });

  it('variant N yields a DISTINCT art-direction for the SAME topic (the "N options" feature)', () => {
    type Sug = { variant: number; design_type: string; suggested: { bg: string; accent: string; bg_style: string } };
    const sug = (v: number) => enrichBrief({ prompt: 'the future of artificial intelligence', variant: v }) as unknown as Sug;
    const key = (s: Sug) => `${s.suggested.bg}|${s.suggested.accent}|${s.suggested.bg_style}`;
    const v0 = sug(0), v1 = sug(1), v2 = sug(2);
    expect(v0.variant).toBe(0);
    expect(v1.variant).toBe(1);
    // same topic ⇒ same preset, but the look (palette + geometry) differs per variant
    expect(v1.design_type).toBe(v0.design_type);
    expect(new Set([key(v0), key(v1), key(v2)]).size).toBe(3);
    // deterministic: re-asking for option 2 returns the identical art-direction
    expect(sug(2).suggested).toEqual(v2.suggested);
  });

  it('an empty prompt fails gracefully (no throw)', () => {
    const r = enrichBrief({ prompt: '' }) as unknown as { success: boolean };
    expect(r.success).toBe(true);
  });
});

describe('enrichBrief — carousel / multi-page decks', () => {
  type Carousel = { output_type?: string; page_count?: number; pages?: Array<{ role: string; preset: string; hints: string }>;
    needs_research?: boolean; suggested?: { bg_style?: string; width?: number; height?: number }; instruction?: string };
  const car = (prompt: string, type?: string) => enrichBrief({ prompt, type }) as unknown as Carousel;

  it('detects a carousel + page count, plans cover→…→closing pages', () => {
    const r = car('a 6-slide carousel about the future of work');
    expect(r.output_type).toBe('carousel');
    expect(r.page_count).toBe(6);
    expect(r.pages!.length).toBe(6);
    expect(r.pages![0].role).toBe('cover');
    expect(r.pages![r.pages!.length - 1].role).toBe('closing');
  });

  it('a presentation/deck goes landscape; social carousel stays portrait', () => {
    expect(car('a presentation deck on AI in healthcare').suggested!.width).toBe(1920);
    expect(car('an instagram carousel about remote work').suggested!.height).toBe(1350);
  });

  it('every content/data page names a preset + has hints, and the mood is shared', () => {
    const r = car('a 7-page carousel on the state of solar energy');
    expect(r.pages!.every(p => p.preset && p.hints.length > 0)).toBe(true);
    expect(r.pages!.some(p => p.role === 'data')).toBe(true);
    expect(r.needs_research).toBe(true);
    expect(r.instruction!).toMatch(/SAME bg_style/);
  });

  it('bakes the shared bg_style into EVERY page hint (so a thin model cannot drop it)', () => {
    const r = car('a 6-slide carousel about the future of AI');
    // The recipe is procedural now, but ONE shared recipe must appear verbatim on
    // every page hint for a cohesive deck.
    const shared = r.suggested!.bg_style as string;
    expect(shared).toContain('grain');
    expect(r.pages!.every(p => p.hints.includes(`bg_style:"${shared}"`))).toBe(true);
    expect(r.pages!.every(p => p.hints.includes('ONE preset layer'))).toBe(true);
  });

  it('instruction tells the model to pass the suggested canvas to create_task', () => {
    const r = car('a presentation about renewable energy');
    expect(r.instruction!).toMatch(/create_task with width:1920, height:1080/);
  });

  it('explicit type:"carousel" forces a deck even without a keyword', () => {
    expect(car('quarterly results', 'carousel').output_type).toBe('carousel');
  });

  it('clamps page count to a sane range', () => {
    expect(car('a 99-slide carousel about x').page_count).toBeLessThanOrEqual(10);
    expect(car('a 1-slide carousel about x').page_count).toBeGreaterThanOrEqual(3);
  });
});

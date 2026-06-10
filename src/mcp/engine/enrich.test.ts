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

  it('a tech topic gets a dark mesh+glow+grain mood', () => {
    const r = run('the state of AI in healthcare');
    expect(r.suggested!.bg_style).toContain('mesh');
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
    // AI topic → mesh bg_style; every page hint must carry it verbatim.
    expect(r.suggested!.bg_style).toContain('mesh');
    expect(r.pages!.every(p => /bg_style:"mesh/.test(p.hints))).toBe(true);
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

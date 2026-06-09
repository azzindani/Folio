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

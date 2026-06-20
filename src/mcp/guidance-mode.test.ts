import { describe, it, expect, afterEach } from 'vitest';
import { guidanceMode, isMinimalGuidance, freeComposeDescription, COMPOSE_NEUTRAL } from './guidance-mode';
import { buildGuide } from './engine/guide';

const orig = process.env.FOLIO_GUIDANCE;
afterEach(() => { if (orig === undefined) delete process.env.FOLIO_GUIDANCE; else process.env.FOLIO_GUIDANCE = orig; });

describe('guidance mode', () => {
  it('defaults to full (blind-model path unchanged)', () => {
    delete process.env.FOLIO_GUIDANCE;
    expect(guidanceMode()).toBe('full');
    expect(isMinimalGuidance()).toBe(false);
  });

  it('reads minimal/frontier from FOLIO_GUIDANCE, ignores other values', () => {
    process.env.FOLIO_GUIDANCE = 'minimal';
    expect(guidanceMode()).toBe('minimal');
    process.env.FOLIO_GUIDANCE = 'FRONTIER';
    expect(guidanceMode()).toBe('minimal');
    process.env.FOLIO_GUIDANCE = 'something-else';
    expect(guidanceMode()).toBe('full');
  });

  it('freeComposeDescription strips the prescriptive lead ONLY in minimal, keeps the spatial guidance', () => {
    const desc = 'Compose a poster in one call via layers_shorthand. Design like a human, not an AI template: flat solid canvas, NO gradient, Playfair/Anton, ONE accent. ALWAYS PREFER A PRESET over hand-placing — the preset measures + lays out everything.';
    expect(freeComposeDescription(desc, false)).toBe(desc);          // full → untouched
    const min = freeComposeDescription(desc, true);
    expect(min).not.toContain('NO gradient');                        // prescription gone
    expect(min).toContain(COMPOSE_NEUTRAL);                          // neutral lead in
    expect(min).toContain('ALWAYS PREFER A PRESET');                 // spatial guidance kept
  });

  it('buildGuide prepends the free-compose preamble in minimal, not in full', () => {
    process.env.FOLIO_GUIDANCE = 'minimal';
    expect(buildGuide('quick_ref')).toContain('FREE-COMPOSE MODE');
    process.env.FOLIO_GUIDANCE = '';
    expect(buildGuide('quick_ref')).not.toContain('FREE-COMPOSE MODE');
  });
});

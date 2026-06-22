import { describe, it, expect } from 'vitest';
import { craft, craftFor, CRAFT_MODULES, CRAFT_SECTIONS } from './craft';
import { buildGuide, GUIDE_SECTIONS } from './guide';

describe('craft modules', () => {
  it('exposes the index + every module by slug', () => {
    expect(craft('craft')).toMatch(/three ax/i);
    for (const slug of CRAFT_MODULES) {
      expect(craft(slug), slug).toBeTruthy();
    }
    expect(craft('nope')).toBeNull();
  });

  it('the index lists the 80/20 soul rule + identifiability test', () => {
    const idx = craft('craft') ?? '';
    expect(idx).toMatch(/80\/20|80% proven/);
    expect(idx.toLowerCase()).toContain('identifiability');
  });

  it('anti_slop names the cardinal AI tells', () => {
    const s = (craft('anti_slop') ?? '').toLowerCase();
    expect(s).toContain('indigo');
    expect(s).toContain('gradient');
    expect(s).toContain('emoji');
    expect(s).toContain('filler');
  });

  it('color enforces one-accent + neutral dominance', () => {
    const s = craft('color') ?? '';
    expect(s).toMatch(/70.?90%/);
    expect(s.toLowerCase()).toContain('accent');
  });

  it('craftFor scales modules by design kind', () => {
    expect(craftFor('poster')).toEqual(['color', 'type', 'anti_slop']);
    expect(craftFor('interactive report')).toContain('a11y');
    expect(craftFor('pitch deck')).toContain('ux_laws');
  });
});

describe('guide integration', () => {
  it('GUIDE_SECTIONS includes every craft section', () => {
    for (const slug of CRAFT_SECTIONS) expect(GUIDE_SECTIONS).toContain(slug);
  });

  it('buildGuide serves a craft section', () => {
    expect(buildGuide('anti_slop')).toContain('cardinal sins');
  });

  it('default guide points at the craft rulebooks', () => {
    expect(buildGuide()).toContain('craft');
  });

  it('unknown section lists craft sections as available', () => {
    expect(buildGuide('zzz')).toContain('anti_slop');
  });
});

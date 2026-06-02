import { describe, it, expect } from 'vitest';
import { buildIconSVG, LUCIDE_ICONS, ALL_ICON_NAMES, resolveIconName } from './lucide-icons';

describe('resolveIconName — tolerates the names small models emit', () => {
  it('passes through an exact canonical id', () => {
    expect(resolveIconName('arrow-right')).toBe('arrow-right');
  });
  it('normalizes separators and case (coffee_cup stays unresolved, photo→image)', () => {
    expect(resolveIconName('Arrow_Right')).toBe('arrow-right');
    expect(resolveIconName('arrow right')).toBe('arrow-right');
  });
  it('maps common synonyms to canonical ids', () => {
    expect(resolveIconName('photo')).toBe('image');
    expect(resolveIconName('email')).toBe('mail');
    expect(resolveIconName('gear')).toBe('settings');
    expect(resolveIconName('person')).toBe('user');
    expect(resolveIconName('bolt')).toBe('zap');
    expect(resolveIconName('location')).toBe('map-pin');
  });
  it('strips an "icon-" prefix', () => {
    expect(resolveIconName('icon-home')).toBe('home');
  });
  it('handles singular/plural drift', () => {
    expect(resolveIconName('layer')).toBe('layers');
    expect(resolveIconName('stars')).toBe('star');
  });
  it('resolves via a single known hyphen-token', () => {
    expect(resolveIconName('trash-can')).toBe('trash');
  });
  it('returns null (→ honest placeholder) when there is no confident match', () => {
    expect(resolveIconName('coffee_cup')).toBeNull();
    expect(resolveIconName('nonexistent-xyz')).toBeNull();
    expect(resolveIconName('')).toBeNull();
  });
});

describe('buildIconSVG', () => {
  it('returns null for unknown icon', () => {
    expect(buildIconSVG('nonexistent-icon-xyz', 24, '#000')).toBeNull();
  });

  it('returns SVGSVGElement for known icon', () => {
    const firstIcon = Object.keys(LUCIDE_ICONS)[0];
    const svg = buildIconSVG(firstIcon, 24, '#ff0000');
    expect(svg).not.toBeNull();
    expect(svg?.tagName.toLowerCase()).toBe('svg');
  });

  it('sets width and height from size parameter', () => {
    const firstIcon = Object.keys(LUCIDE_ICONS)[0];
    const svg = buildIconSVG(firstIcon, 32, '#000000')!;
    expect(svg.getAttribute('width')).toBe('32');
    expect(svg.getAttribute('height')).toBe('32');
  });

  it('sets stroke to the given color', () => {
    const firstIcon = Object.keys(LUCIDE_ICONS)[0];
    const svg = buildIconSVG(firstIcon, 24, '#abcdef')!;
    expect(svg.getAttribute('stroke')).toBe('#abcdef');
  });

  it('has viewBox 0 0 24 24', () => {
    const firstIcon = Object.keys(LUCIDE_ICONS)[0];
    const svg = buildIconSVG(firstIcon, 24, '#000')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 24 24');
  });

  it('has fill none', () => {
    const firstIcon = Object.keys(LUCIDE_ICONS)[0];
    const svg = buildIconSVG(firstIcon, 24, '#000')!;
    expect(svg.getAttribute('fill')).toBe('none');
  });
});

describe('LUCIDE_ICONS and ALL_ICON_NAMES', () => {
  it('LUCIDE_ICONS contains at least one icon', () => {
    expect(Object.keys(LUCIDE_ICONS).length).toBeGreaterThan(0);
  });

  it('ALL_ICON_NAMES is sorted alphabetically', () => {
    const sorted = [...ALL_ICON_NAMES].sort();
    expect(ALL_ICON_NAMES).toEqual(sorted);
  });

  it('ALL_ICON_NAMES length matches LUCIDE_ICONS', () => {
    expect(ALL_ICON_NAMES.length).toBe(Object.keys(LUCIDE_ICONS).length);
  });
});

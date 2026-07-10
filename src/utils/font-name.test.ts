import { describe, it, expect } from 'vitest';
import { fontFamilyFromFilename, fontWeightFromFilename, isFontFile } from './font-name';

describe('fontFamilyFromFilename', () => {
  it('strips extension and weight suffix', () => {
    expect(fontFamilyFromFilename('Clash_Display-SemiBold.ttf')).toBe('clash display');
    expect(fontFamilyFromFilename('Inter-Regular.otf')).toBe('inter');
    expect(fontFamilyFromFilename('SpaceGrotesk.woff2')).toBe('spacegrotesk');
  });

  it('collapses separators and lowercases', () => {
    expect(fontFamilyFromFilename('My  Cool__Font-Bold.ttf')).toBe('my cool font');
  });

  it('strips numeric weight tokens', () => {
    expect(fontFamilyFromFilename('Roboto-700.ttf')).toBe('roboto');
  });
});

describe('fontWeightFromFilename', () => {
  it('maps common suffixes to CSS weights', () => {
    expect(fontWeightFromFilename('X-Thin.ttf')).toBe('200');
    expect(fontWeightFromFilename('X-Light.ttf')).toBe('300');
    expect(fontWeightFromFilename('X-Regular.ttf')).toBe('400');
    expect(fontWeightFromFilename('X-Medium.ttf')).toBe('500');
    expect(fontWeightFromFilename('X-SemiBold.ttf')).toBe('600');
    expect(fontWeightFromFilename('X-Bold.ttf')).toBe('700');
    expect(fontWeightFromFilename('X-Black.ttf')).toBe('800');
  });

  it('defaults to 400 without a recognizable suffix', () => {
    expect(fontWeightFromFilename('PlainFont.ttf')).toBe('400');
  });
});

describe('isFontFile', () => {
  it('accepts ttf/otf/woff/woff2 only', () => {
    for (const f of ['a.ttf', 'a.otf', 'a.woff', 'a.woff2', 'A.TTF']) expect(isFontFile(f)).toBe(true);
    for (const f of ['a.png', 'a.svg', 'a.txt', 'a']) expect(isFontFile(f)).toBe(false);
  });
});

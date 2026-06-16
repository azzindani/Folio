import { describe, it, expect } from 'vitest';
import { selectFontFile, resolveFamilyKey } from './pdf-font-select';

const FILES: Record<string, string[]> = {
  Inter: ['Inter[opsz,wght].ttf'],
  'IBM Plex Mono': ['IBMPlexMono-Bold.ttf', 'IBMPlexMono-Medium.ttf', 'IBMPlexMono-Regular.ttf', 'IBMPlexMono-SemiBold.ttf'],
  'Space Grotesk': ['SpaceGrotesk[wght].ttf'],
};

describe('selectFontFile', () => {
  it('maps a variable family case-insensitively, faux-bold for heavy weights', () => {
    expect(selectFontFile(FILES, 'inter', 400)).toMatchObject({ file: 'Inter[opsz,wght].ttf', fauxBold: false });
    expect(selectFontFile(FILES, 'Inter', 800)).toMatchObject({ file: 'Inter[opsz,wght].ttf', fauxBold: true });
  });

  it('picks the dedicated weight file for static families (no faux-bold)', () => {
    expect(selectFontFile(FILES, 'IBM Plex Mono', 700)!.file.toLowerCase()).toContain('bold');
    expect(selectFontFile(FILES, 'IBM Plex Mono', 700)!.fauxBold).toBe(false);
    expect(selectFontFile(FILES, 'IBM Plex Mono', 500)!.file.toLowerCase()).toContain('medium');
    expect(selectFontFile(FILES, 'IBM Plex Mono', 400)!.file.toLowerCase()).toContain('regular');
  });

  it('returns null for unbundled / empty families', () => {
    expect(selectFontFile(FILES, 'Comic Sans MS', 400)).toBeNull();
    expect(selectFontFile(FILES, '', 400)).toBeNull();
  });

  it('produces a stable PDF-safe alias and matches resolveFamilyKey', () => {
    const a = selectFontFile(FILES, 'Space Grotesk', 500)!;
    expect(a.alias).toMatch(/^f_[a-z0-9_]+$/i);
    expect(selectFontFile(FILES, 'space grotesk', 500)!.alias).toBe(a.alias);
    expect(resolveFamilyKey(FILES, 'SPACE GROTESK')).toBe('Space Grotesk');
    expect(resolveFamilyKey(FILES, 'nope')).toBeNull();
  });
});

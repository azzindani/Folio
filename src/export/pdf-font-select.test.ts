import { describe, it, expect } from 'vitest';
import { selectFontFile, resolveFamilyKey, fileWeight } from './pdf-font-select';

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

  // The bundle is now one static file per weight; "bold" used to match SemiBold and ExtraBold alike.
  it('picks the nearest named weight in a full static set, and synthesizes only when nothing is close', () => {
    const set = { Archivo: ['Archivo-Black.ttf', 'Archivo-Bold.ttf', 'Archivo-ExtraBold.ttf', 'Archivo-SemiBold.ttf', 'Archivo-Regular.ttf', 'Archivo-Light.ttf'], Solo: ['Solo-Regular.ttf'] };
    const pick = (w: number): string | undefined => selectFontFile(set, 'Archivo', w)?.file;
    expect([300, 400, 600, 650, 700, 800, 900].map(pick)).toEqual([
      'Archivo-Light.ttf', 'Archivo-Regular.ttf', 'Archivo-SemiBold.ttf', 'Archivo-Bold.ttf', 'Archivo-Bold.ttf', 'Archivo-ExtraBold.ttf', 'Archivo-Black.ttf',
    ]);
    expect(selectFontFile(set, 'Archivo', 800)?.fauxBold).toBe(false);
    expect(selectFontFile(set, 'Solo', 800)).toMatchObject({ file: 'Solo-Regular.ttf', fauxBold: true });
    expect([fileWeight('Inter-ExtraBold.ttf'), fileWeight('Inter-SemiBold.ttf'), fileWeight('Inter[opsz,wght].ttf'), fileWeight('brand.ttf')]).toEqual([800, 600, null, null]);
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

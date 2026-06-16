import { describe, it, expect } from 'vitest';
import { pickFont, fontFileBase64 } from './pdf-fonts';

describe('pickFont', () => {
  it('resolves a bundled variable family (case-insensitive) and flags faux-bold for heavy weights', () => {
    const reg = pickFont('inter', 400);
    expect(reg).not.toBeNull();
    expect(reg!.file.toLowerCase()).toContain('inter');
    expect(reg!.fauxBold).toBe(false);

    const bold = pickFont('Inter', 800);
    expect(bold).not.toBeNull();
    // One variable file → no dedicated bold → synthesize it.
    expect(bold!.fauxBold).toBe(true);
    expect(bold!.file).toBe(reg!.file);
  });

  it('picks the closest dedicated weight file for static families (no faux-bold)', () => {
    const bold = pickFont('IBM Plex Mono', 700);
    expect(bold).not.toBeNull();
    expect(bold!.file.toLowerCase()).toContain('bold');
    expect(bold!.fauxBold).toBe(false);

    const reg = pickFont('IBM Plex Mono', 400);
    expect(reg!.file.toLowerCase()).toContain('regular');
  });

  it('returns null for an unbundled family (caller keeps it in the raster)', () => {
    expect(pickFont('Comic Sans MS', 400)).toBeNull();
    expect(pickFont('', 400)).toBeNull();
  });

  it('produces a filesystem-safe, stable alias and readable font bytes', () => {
    const reg = pickFont('Space Grotesk', 500)!;
    expect(reg.alias).toMatch(/^[a-z0-9_]+$/i);
    expect(pickFont('Space Grotesk', 500)!.alias).toBe(reg.alias);
    const b64 = fontFileBase64(reg.file);
    expect(b64.length).toBeGreaterThan(1000);
  });
});

import { describe, it, expect } from 'vitest';
import { buildPptx, type PptxSlide } from './pptx-export';

// A tiny but real 1×1 PNG (the bytes don't matter to the zip, but use a real one).
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const slide = (): PptxSlide => ({ png: PNG, width: 1920, height: 1080 });

/** Read the END-OF-CENTRAL-DIRECTORY record's total-entries field. */
function eocdEntryCount(buf: Buffer): number {
  const sig = 0x06054b50;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === sig) return buf.readUInt16LE(i + 10);
  }
  return -1;
}
const hasEntry = (buf: Buffer, name: string): boolean => buf.includes(Buffer.from(name, 'utf8'));

describe('buildPptx', () => {
  it('produces a ZIP (PK magic) with the OOXML parts', () => {
    const buf = buildPptx([slide(), slide(), slide()], 'My Deck');
    expect(buf[0]).toBe(0x50); // 'P'
    expect(buf[1]).toBe(0x4b); // 'K'
    for (const name of [
      '[Content_Types].xml', '_rels/.rels', 'ppt/presentation.xml',
      'ppt/_rels/presentation.xml.rels', 'ppt/theme/theme1.xml',
      'ppt/slideMasters/slideMaster1.xml', 'ppt/slideLayouts/slideLayout1.xml',
      'ppt/slides/slide1.xml', 'ppt/slides/slide3.xml', 'ppt/media/image3.png',
    ]) {
      expect(hasEntry(buf, name), name).toBe(true);
    }
  });

  it('writes 10 base parts + 3 parts per slide, matching the EOCD count', () => {
    const n = 4;
    const buf = buildPptx(Array.from({ length: n }, slide), 'D');
    expect(eocdEntryCount(buf)).toBe(10 + 3 * n);
  });

  it('sets slide size from the first page dimensions (EMU = px×9525)', () => {
    const buf = buildPptx([{ png: PNG, width: 1080, height: 1080 }], 'Sq');
    expect(buf.includes(Buffer.from(`cx="${1080 * 9525}" cy="${1080 * 9525}"`))).toBe(true);
  });

  it('escapes the title in slide XML', () => {
    const buf = buildPptx([slide()], 'A & B <deck>');
    expect(hasEntry(buf, 'A &amp; B &lt;deck&gt;')).toBe(true);
  });

  it('throws on no slides', () => {
    expect(() => buildPptx([], 'x')).toThrow(/no slides/);
  });
});

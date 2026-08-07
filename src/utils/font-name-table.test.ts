import { describe, it, expect } from 'vitest';
import { readFontNames } from './font-name-table';

// Build a minimal sfnt whose only real table is `name` (+ optionally OS/2).
// Hand-rolling it beats committing a binary fixture and keeps the parser
// honest about offsets.
function buildFont(records: { platformId: number; nameId: number; text: string }[], weightClass?: number): Buffer {
  const strings: Buffer[] = [];
  const recs: Buffer[] = [];
  let offset = 0;
  for (const r of records) {
    const bytes = r.platformId === 1
      ? Buffer.from(r.text, 'latin1')
      : Buffer.from(r.text.split('').flatMap(c => [0, c.charCodeAt(0)]));
    const rec = Buffer.alloc(12);
    rec.writeUInt16BE(r.platformId, 0);
    rec.writeUInt16BE(r.platformId === 1 ? 0 : 1, 2);   // encodingId
    rec.writeUInt16BE(0, 4);                             // languageId
    rec.writeUInt16BE(r.nameId, 6);
    rec.writeUInt16BE(bytes.length, 8);
    rec.writeUInt16BE(offset, 10);
    recs.push(rec); strings.push(bytes); offset += bytes.length;
  }
  const header = Buffer.alloc(6);
  header.writeUInt16BE(0, 0);
  header.writeUInt16BE(recs.length, 2);
  header.writeUInt16BE(6 + 12 * recs.length, 4);         // storage offset
  const nameTable = Buffer.concat([header, ...recs, ...strings]);

  const os2 = Buffer.alloc(96);
  if (weightClass !== undefined) os2.writeUInt16BE(weightClass, 4);
  const tables: [string, Buffer][] = weightClass === undefined
    ? [['name', nameTable]]
    : [['OS/2', os2], ['name', nameTable]];

  const dirLen = 12 + 16 * tables.length;
  const dir = Buffer.alloc(dirLen);
  dir.writeUInt32BE(0x00010000, 0);
  dir.writeUInt16BE(tables.length, 4);
  let dataOff = dirLen;
  const bodies: Buffer[] = [];
  tables.forEach(([tag, body], i) => {
    const rec = 12 + 16 * i;
    dir.write(tag, rec, 4, 'latin1');
    dir.writeUInt32BE(0, rec + 4);
    dir.writeUInt32BE(dataOff, rec + 8);
    dir.writeUInt32BE(body.length, rec + 12);
    bodies.push(body); dataOff += body.length;
  });
  return Buffer.concat([dir, ...bodies]);
}

describe('readFontNames', () => {
  it('reads the Windows UTF-16 family and subfamily', () => {
    const f = buildFont([
      { platformId: 3, nameId: 1, text: 'Space Grotesk Light' },
      { platformId: 3, nameId: 2, text: 'Bold' },
    ], 700);
    expect(readFontNames(f)).toEqual({ family: 'Space Grotesk Light', subfamily: 'Bold', weightClass: 700 });
  });

  it('prefers the typographic family (16) over the legacy split family (1)', () => {
    // This is the case the legacy names exist FOR: a family with more than four
    // weights splits into "Foo Light"/"Foo Black" in id 1, while id 16 keeps
    // the real family that a renderer groups them under.
    const f = buildFont([
      { platformId: 3, nameId: 1, text: 'Inter Display SemiBold' },
      { platformId: 3, nameId: 2, text: 'Regular' },
      { platformId: 3, nameId: 16, text: 'Inter Display' },
      { platformId: 3, nameId: 17, text: 'SemiBold' },
    ], 600);
    expect(readFontNames(f)).toMatchObject({ family: 'Inter Display', subfamily: 'SemiBold' });
  });

  it('reads a Mac (latin1) record too', () => {
    const f = buildFont([{ platformId: 1, nameId: 1, text: 'Old Mac Face' }]);
    expect(readFontNames(f).family).toBe('Old Mac Face');
  });

  it('returns {} for anything that is not a parseable font, rather than throwing', () => {
    for (const junk of [Buffer.alloc(0), Buffer.from('not a font at all'), Buffer.alloc(400)]) {
      expect(readFontNames(junk)).toEqual({});
    }
  });

  it('ignores an out-of-range weight class instead of reporting nonsense', () => {
    const f = buildFont([{ platformId: 3, nameId: 1, text: 'X' }], 0);
    expect(readFontNames(f).weightClass).toBeUndefined();
  });
});

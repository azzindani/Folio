// Read a font's REAL family name out of its `name` table.
//
// Everywhere else in Folio a font's family is guessed from its filename, which
// is fine for a file an operator named. It is wrong for a downloaded one:
// Fontsource ships static instances of a variable family under the variable
// font's default-instance name, so "space-grotesk-700.ttf" declares itself
// "Space Grotesk Light". resvg reads the table, the filename guess does not,
// and a design asking for "Space Grotesk" silently renders in a fallback.
//
// Pure Buffer → names. No fs, no dependency, so the client can use it too.

export interface FontNames {
  family?: string;
  subfamily?: string;   // "Regular", "Bold", …
  weightClass?: number; // OS/2 usWeightClass — the authority on weight
}

const NAME_FAMILY = 1;
const NAME_SUBFAMILY = 2;
const NAME_TYPO_FAMILY = 16;      // preferred family, when the legacy one is split
const NAME_TYPO_SUBFAMILY = 17;

/** Parse the sfnt table directory. Returns offsets by 4-char tag. */
function tableDirectory(buf: Buffer): Map<string, number> | null {
  if (buf.length < 12) return null;
  // A TTC (font collection) points at its first font's header.
  const base = buf.toString('latin1', 0, 4) === 'ttcf' && buf.length >= 16 ? buf.readUInt32BE(12) : 0;
  if (base + 12 > buf.length) return null;
  const count = buf.readUInt16BE(base + 4);
  const out = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + 16 * i;
    if (rec + 16 > buf.length) return out;
    out.set(buf.toString('latin1', rec, rec + 4), buf.readUInt32BE(rec + 8));
  }
  return out;
}

function decodeName(buf: Buffer, platformId: number, start: number, len: number): string {
  if (len <= 0 || start + len > buf.length) return '';
  const slice = buf.subarray(start, start + len);
  // Platform 3 (Windows) and 0 (Unicode) store UTF-16BE; platform 1 (Mac) is
  // MacRoman, close enough to latin1 for the Latin family names we care about.
  const s = platformId === 1 ? slice.toString('latin1') : swap16(slice).toString('utf16le');
  return s.replace(/\0/g, '').trim();
}

function swap16(b: Buffer): Buffer {
  const out = Buffer.allocUnsafe(b.length - (b.length % 2));
  for (let i = 0; i + 1 < b.length; i += 2) { out[i] = b[i + 1] as number; out[i + 1] = b[i] as number; }
  return out;
}

/**
 * Best-effort: a malformed or unsupported file returns {} rather than throwing.
 * Callers fall back to the filename guess, which is what they did before.
 */
export function readFontNames(buf: Buffer): FontNames {
  try {
    const tables = tableDirectory(buf);
    const nameOff = tables?.get('name');
    if (nameOff === undefined || nameOff + 6 > buf.length) return {};
    const count = buf.readUInt16BE(nameOff + 2);
    const stringOff = nameOff + buf.readUInt16BE(nameOff + 4);
    const picked = new Map<number, string>();
    for (let i = 0; i < count; i++) {
      const rec = nameOff + 6 + 12 * i;
      if (rec + 12 > buf.length) break;
      const platformId = buf.readUInt16BE(rec);
      const nameId = buf.readUInt16BE(rec + 6);
      if (![NAME_FAMILY, NAME_SUBFAMILY, NAME_TYPO_FAMILY, NAME_TYPO_SUBFAMILY].includes(nameId)) continue;
      const len = buf.readUInt16BE(rec + 8);
      const text = decodeName(buf, platformId, stringOff + buf.readUInt16BE(rec + 10), len);
      // First readable record per id wins — Windows records come first in
      // practice, and any of them names the same family.
      if (text && !picked.has(nameId)) picked.set(nameId, text);
    }
    const out: FontNames = {};
    // The typographic family (16) is the one a renderer groups weights under;
    // fall back to the legacy family (1) when it is absent.
    const family = picked.get(NAME_TYPO_FAMILY) ?? picked.get(NAME_FAMILY);
    const subfamily = picked.get(NAME_TYPO_SUBFAMILY) ?? picked.get(NAME_SUBFAMILY);
    if (family) out.family = family;
    if (subfamily) out.subfamily = subfamily;
    const os2 = tables?.get('OS/2');
    if (os2 !== undefined && os2 + 6 <= buf.length) {
      const wc = buf.readUInt16BE(os2 + 4);
      if (wc >= 1 && wc <= 1000) out.weightClass = wc;
    }
    return out;
  } catch { return {}; }
}

// Pure font-selection shared by the server (mcp/engine/pdf-fonts) and the
// browser (export/pdf-fonts-browser) vector-PDF font registries, so both pick
// the SAME bundled TTF for a given family+weight and the editor's PDF matches
// the MCP's. No fs / no fetch here — callers supply the family→files map (the
// server reads it from the bundled manifest.json; the browser fetches the same
// manifest from /fonts/manifest.json).

export interface FontSelection {
  /** TTF filename within the fonts dir. */
  file: string;
  /** Stable, filesystem/PDF-safe alias (register once, reuse). */
  alias: string;
  /** Synthesize bold via stroke (variable family with no dedicated weight file). */
  fauxBold: boolean;
}

const WEIGHT_ORDER: Record<string, string[]> = {
  bold: ['bold', 'semibold', 'medium', 'regular'],
  semibold: ['semibold', 'bold', 'medium', 'regular'],
  medium: ['medium', 'regular', 'semibold', 'bold'],
  regular: ['regular', 'medium', 'semibold', 'bold'],
};

/** Case-insensitive family → manifest key (e.g. "inter" → "Inter"). */
export function resolveFamilyKey(files: Record<string, string[]>, family: string): string | null {
  const want = family.trim().toLowerCase();
  if (!want) return null;
  for (const key of Object.keys(files)) {
    if (key.toLowerCase() === want) return key;
  }
  return null;
}

function pickWeightFile(list: string[], weight: number): { file: string; dedicated: boolean } {
  if (list.length === 1) return { file: list[0], dedicated: false };
  const bucket = weight >= 700 ? 'bold' : weight >= 600 ? 'semibold' : weight >= 500 ? 'medium' : 'regular';
  for (const token of WEIGHT_ORDER[bucket]) {
    const f = list.find(x => x.toLowerCase().includes(token));
    if (f) return { file: f, dedicated: true };
  }
  return { file: list[0], dedicated: false };
}

/** Resolve a font-family + weight to a bundled TTF, or null when the family
 *  isn't bundled (caller then leaves that text in the raster). */
export function selectFontFile(files: Record<string, string[]>, family: string, weight: number): FontSelection | null {
  const key = resolveFamilyKey(files, family);
  if (!key) return null;
  const list = files[key];
  if (!list || list.length === 0) return null;
  const { file, dedicated } = pickWeightFile(list, weight);
  const alias = `f_${`${key}_${file}`.replace(/[^a-z0-9]/gi, '_')}`;
  return { file, alias, fauxBold: !dedicated && weight >= 600 };
}

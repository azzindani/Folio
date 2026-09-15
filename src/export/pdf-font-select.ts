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

/** Style words in a file name, longest first so "ExtraBold" is never read as "Bold". */
const STYLE_WEIGHTS: Array<[string, number]> = [
  ['extralight', 200], ['ultralight', 200], ['semibold', 600], ['demibold', 600], ['extrabold', 800], ['ultrabold', 800],
  ['thin', 100], ['light', 300], ['regular', 400], ['medium', 500], ['bold', 700], ['black', 900], ['heavy', 900],
];

/** The weight a static file's name declares, or null for a name with no style word (a variable font). */
export function fileWeight(file: string): number | null {
  const name = file.toLowerCase().replace(/\.(ttf|otf)$/, '');
  if (name.includes('[')) return null;
  const hit = STYLE_WEIGHTS.find(([word]) => name.includes(word));
  return hit ? hit[1] : null;
}

/** Case-insensitive family → manifest key (e.g. "inter" → "Inter"). */
export function resolveFamilyKey(files: Record<string, string[]>, family: string): string | null {
  const want = family.trim().toLowerCase();
  if (!want) return null;
  for (const key of Object.keys(files)) {
    if (key.toLowerCase() === want) return key;
  }
  return null;
}

/**
 * The file nearest the asked weight (a tie goes heavier, as CSS matching does above
 * 500). Bundled families are one static file per weight (scripts/instance-fonts.py),
 * so this is usually exact. A family with no named weights — a variable or unnamed
 * upload — has one face for every weight; a heavy weight far above the heaviest file
 * is not dedicated either, so the caller synthesizes bold.
 */
function pickWeightFile(list: string[], weight: number): { file: string; dedicated: boolean } {
  const named = list.flatMap(file => { const w = fileWeight(file); return w === null ? [] : [{ file, w }]; });
  const first = named[0];
  if (!first) return { file: list[0], dedicated: false };
  let best = first;
  for (const x of named) {
    const gap = Math.abs(x.w - weight), bestGap = Math.abs(best.w - weight);
    if (gap < bestGap || (gap === bestGap && x.w > best.w)) best = x;
  }
  return { file: best.file, dedicated: weight < 600 || best.w >= weight - 150 };
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

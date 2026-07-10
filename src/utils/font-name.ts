// Pure filename → font-family guess, shared by the server font registry
// (mcp/engine/fonts.ts) and the editor's project-font loader (no fs here —
// this must bundle into the client).

const FONT_FILE_RE = /\.(ttf|otf|woff2?)$/i;
const WEIGHT_SUFFIX_RE = /[-_ ]?(thin|extralight|ultralight|light|regular|book|normal|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|\d{3})(?=[-_ .]|$)/gi;

/** Family guess from a font filename ("Clash_Display-SemiBold.ttf" → "clash display"). */
export function fontFamilyFromFilename(file: string): string {
  return file.replace(FONT_FILE_RE, '').replace(WEIGHT_SUFFIX_RE, '')
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/** CSS weight guess from a font filename's suffix tokens. */
export function fontWeightFromFilename(file: string): string {
  const f = file.toLowerCase();
  if (/extrabold|ultrabold|black|heavy/.test(f)) return '800';
  if (/semibold|demibold/.test(f)) return '600';
  if (/bold/.test(f)) return '700';
  if (/medium/.test(f)) return '500';
  if (/extralight|ultralight|thin/.test(f)) return '200';
  if (/light/.test(f)) return '300';
  return '400';
}

export function isFontFile(file: string): boolean {
  return FONT_FILE_RE.test(file);
}

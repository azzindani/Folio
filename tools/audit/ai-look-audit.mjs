// AI-look classifier for Folio catalog templates.
// Walks every template's layers, scores the "AI-generated" tells, and flags
// which are artistic-by-design (gradient is intentional) vs business/tech
// (gradient = AI tell). Output: ranked TSV to stdout + summary to stderr.
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const DIR = 'public/templates/builtin';
const files = fs.readdirSync(DIR).filter(f => f.endsWith('.template.yaml')).sort();

// Names where a gradient / neon / glow is the whole point — leave alone.
const ARTISTIC = /vaporwave|synthwave|sunset|sunrise|holo|holographic|neon|retro|aurora|gradient|glow|iridescent|prism|cosmic|galaxy|nebula|disco|miami|y2k|chrome|liquid|plasma|spectrum|rainbow|tie-dye|psychedelic|vinyl|album|festival|rave|club|nightlife|cyberpunk|glassmorph|duotone|ombre|pride/i;

function walk(layers, fn) {
  if (!Array.isArray(layers)) return;
  for (const l of layers) {
    if (l && typeof l === 'object') {
      fn(l);
      if (Array.isArray(l.layers)) walk(l.layers, fn);
      if (Array.isArray(l.children)) walk(l.children, fn);
    }
  }
}

const rows = [];
for (const f of files) {
  let doc;
  try { doc = yaml.load(fs.readFileSync(path.join(DIR, f), 'utf8')); }
  catch (e) { rows.push({ f, err: String(e.message).slice(0, 40) }); continue; }
  if (!doc) continue;

  const themeRef = doc.theme?.ref ?? doc.theme_ref ?? '';
  let grads = 0, tokenGrads = 0, litGrads = 0, glow = 0, radialFade = 0;
  const radii = new Set();
  let centered = 0, total = 0;

  const allLayers = doc.layers ?? doc.pages?.flatMap(p => p.layers ?? []) ?? [];
  walk(allLayers, (l) => {
    total++;
    const fill = l.fill;
    if (fill && typeof fill === 'object' && /^(linear|radial|conic)$/.test(fill.type || '')) {
      grads++;
      const stops = fill.stops || [];
      const tok = stops.some(s => typeof s?.color === 'string' && s.color.startsWith('$'));
      if (tok) tokenGrads++; else litGrads++;
      // radial fade to transparent = the glow blob tell
      if (fill.type === 'radial' && stops.some(s => /transparent|rgba\([^)]*,\s*0\s*\)/.test(String(s?.color)))) radialFade++;
    }
    if (typeof fill === 'string' && /gradient/.test(fill)) { grads++; tokenGrads++; }
    const sh = JSON.stringify(l.shadow ?? l.effects ?? l.style?.shadow ?? '');
    if (/glow/i.test(sh) || /0 0 [2-9][0-9]/.test(sh)) glow++;
    const r = l.radius ?? l.border_radius ?? l.corner_radius ?? l.style?.border_radius;
    if (typeof r === 'number') radii.add(r);
    const al = l.align ?? l.text_align ?? l.style?.text_align;
    if (al === 'center') centered++;
  });

  const midRadii = [...radii].filter(r => [8, 12, 16, 20, 24].includes(r));
  const artistic = ARTISTIC.test(f) || ARTISTIC.test(themeRef);
  // AI-look score: gradients (token worse than literal) + glow blobs + mid radii
  // + heavy centering, discounted hard if artistic-by-design.
  let score = tokenGrads * 3 + litGrads * 1 + radialFade * 3 + glow * 2 + midRadii.length * 1;
  if (total > 0 && centered / total > 0.8) score += 2;
  if (artistic) score = Math.round(score * 0.15);

  rows.push({ f, themeRef, total, grads, tokenGrads, litGrads, radialFade, glow,
    midRadii: midRadii.join('/'), centered, artistic: artistic ? 'ART' : '', score });
}

const errs = rows.filter(r => r.err);
const ok = rows.filter(r => !r.err).sort((a, b) => b.score - a.score);

process.stdout.write('score\ttokG\tlitG\tfade\tglow\tmidR\tcent/tot\tART\ttheme\tfile\n');
for (const r of ok) {
  process.stdout.write(`${r.score}\t${r.tokenGrads}\t${r.litGrads}\t${r.radialFade}\t${r.glow}\t${r.midRadii||'-'}\t${r.centered}/${r.total}\t${r.artistic}\t${r.themeRef}\t${r.f}\n`);
}
const buckets = { 'high (>=10)': 0, 'med (5-9)': 0, 'low (1-4)': 0, 'clean (0)': 0, 'artistic-skip': 0 };
for (const r of ok) {
  if (r.artistic && r.score <= 2) buckets['artistic-skip']++;
  else if (r.score >= 10) buckets['high (>=10)']++;
  else if (r.score >= 5) buckets['med (5-9)']++;
  else if (r.score >= 1) buckets['low (1-4)']++;
  else buckets['clean (0)']++;
}
process.stderr.write(`\n${files.length} templates, ${errs.length} parse-errors\n`);
for (const [k, v] of Object.entries(buckets)) process.stderr.write(`  ${k}: ${v}\n`);

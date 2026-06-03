// De-AI gradient flattener. The #1 "AI-generated" tell across the catalog is
// token gradients + radial glow orbs. This flattens them on NON-artistic
// templates, preserving comments/formatting (text transform, not YAML re-dump):
//   linear/conic gradient            → solid (first non-transparent stop)
//   radial WITHOUT a transparent stop → solid (first stop)
//   radial WITH a transparent stop    → { type: none }   (glow/vignette removed)
// Artistic-by-design templates (vaporwave/sunset/neon/album/…) keep gradients.
//
// Usage: node scripts/_deai-flatten.mjs [--apply]   (default = dry-run report)
import fs from 'fs';
import path from 'path';

const DIR = 'public/templates/builtin';
const APPLY = process.argv.includes('--apply');
// Word-boundary anchored so substrings don't false-skip: "travel"≠rave,
// "discount"/"discord"/"discovery"≠disco, "bride"≠pride.
const ARTISTIC = /\b(?:vaporwave|synthwave|sunset|sunrise|holographic|holo|neon|retro|aurora|gradient|glow|iridescent|prism|cosmic|galaxy|nebula|disco|miami|y2k|chrome|liquid|plasma|spectrum|rainbow|tie-dye|psychedelic|vinyl|album|festival|rave|club|nightlife|cyberpunk|glassmorphism|duotone|ombre|pride|wallpaper|movie-poster|splash|mood-board|spotify|music-share|audio-waveform|coming-soon|meditation)\b/i;

const isTransparent = (c) => /transparent|rgba\([^)]*,\s*0(\.0+)?\s*\)|#[0-9a-f]{6}00\b|#0000\b/i.test(String(c));
// Pull "color" values out of a stops fragment, in source order.
function stopColors(frag) {
  const out = [];
  const re = /color:\s*("?)([^",}\]]+)\1/g;
  let m;
  while ((m = re.exec(frag))) out.push(m[2].trim());
  return out;
}
function firstSolid(colors) {
  return colors.find(c => !isTransparent(c)) ?? colors[0] ?? '#111111';
}
function q(c) { return c.startsWith('$') ? c : `"${c}"`; }

// ── Pass 1: inline flow gradients on one line ────────────────────────────────
// fill: { type: linear, angle: 145, stops: [{ color: "$a", position: 0 }, ...] }
const INLINE = /fill:\s*\{\s*type:\s*(linear|radial|conic)\b([^\[\]]*)stops:\s*\[([^\]]*)\]\s*\}/g;
function pass1(text, counts) {
  return text.replace(INLINE, (_full, type, _mid, stops) => {
    const colors = stopColors(stops);
    const hasTransparent = colors.some(isTransparent);
    if (type === 'radial' && hasTransparent) { counts.glow++; return 'fill: { type: none }'; }
    counts.flat++;
    return `fill: { type: solid, color: ${q(firstSolid(colors))} }`;
  });
}

// ── Pass 2: block-form gradients across indented lines ───────────────────────
//   fill:
//     type: linear
//     stops:
//       - { color: "$a", position: 0 }
function pass2(text, counts) {
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)fill:\s*$/);
    if (!m) { out.push(lines[i]); continue; }
    const baseIndent = m[1].length;
    let j = i + 1;
    const block = [];
    while (j < lines.length) {
      const ln = lines[j];
      if (ln.trim() === '') { block.push(ln); j++; continue; }
      const ind = ln.match(/^(\s*)/)[1].length;
      if (ind <= baseIndent) break;
      block.push(ln);
      j++;
    }
    const blockText = block.join('\n');
    const typeM = blockText.match(/type:\s*(linear|radial|conic)\b/);
    if (!typeM) { out.push(lines[i]); continue; } // not a gradient block
    const colors = stopColors(blockText);
    const hasTransparent = colors.some(isTransparent);
    const pad = ' '.repeat(baseIndent);
    if (typeM[1] === 'radial' && hasTransparent) {
      out.push(`${pad}fill: { type: none }`);
      counts.glow++;
    } else {
      out.push(`${pad}fill: { type: solid, color: ${q(firstSolid(colors))} }`);
      counts.flat++;
    }
    i = j - 1; // skip consumed block lines
  }
  return out.join('\n');
}

const files = fs.readdirSync(DIR).filter(f => f.endsWith('.template.yaml')).sort();
let touched = 0, totFlat = 0, totGlow = 0, skipped = 0;
const report = [];
for (const f of files) {
  if (ARTISTIC.test(f)) { skipped++; continue; }
  const p = path.join(DIR, f);
  const orig = fs.readFileSync(p, 'utf8');
  const counts = { flat: 0, glow: 0 };
  let next = pass1(orig, counts);
  next = pass2(next, counts);
  if (next !== orig) {
    touched++; totFlat += counts.flat; totGlow += counts.glow;
    report.push(`${counts.flat + counts.glow}\tflat:${counts.flat}\tglow→none:${counts.glow}\t${f}`);
    if (APPLY) fs.writeFileSync(p, next);
  }
}
report.sort((a, b) => parseInt(b) - parseInt(a));
process.stderr.write(report.join('\n') + '\n');
process.stderr.write(`\n${APPLY ? 'APPLIED' : 'DRY-RUN'}: ${touched} files touched, ${totFlat} gradients→solid, ${totGlow} glow→none; ${skipped} artistic files skipped.\n`);

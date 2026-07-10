// Folio shorthand parser — background composer + motif layers. Split from shorthand-parser.ts; verbatim bodies.
import type { Layer, Fill } from '../schema/types';

import { shapePath, type ShapeBox } from '../engine/shape-paths';
import { hexToRgb, luminance } from './engine/reference';

import { asHex, PATTERN_NAMES, expandFill, BgCtx, mixHex } from './shorthand-helpers';

export interface PatternOverlay { name: string; strength: number; absOpacity?: number }
// Parse a strength qualifier on a pattern token: soft/faint→quiet, bold/strong→loud,
// a bare numeric (0–1) → an absolute opacity. Default 1 = the visible base.
function strengthOf(arg: string): { strength: number; absOpacity?: number } {
  const a = (arg ?? '').trim();
  if (!a) return { strength: 1 };
  const num = Number(a);
  if (Number.isFinite(num) && num > 0 && num <= 1) return { strength: 1, absOpacity: num };
  if (/faint|subtle|soft|whisper|ghost/.test(a)) return { strength: 0.32 };
  if (/bold|strong|loud|heavy|solid/.test(a)) return { strength: 1.7 };
  if (/medium|normal/.test(a)) return { strength: 1 };
  return { strength: 1 };
}

export function parseBgSpec(spec: string): { base: string; baseArg: string; sweeps: string[]; overlays: PatternOverlay[] } {
  let base = 'solid', baseArg = '';
  const sweeps: string[] = [], overlays: PatternOverlay[] = [];
  for (const raw of spec.toLowerCase().split('+')) {
    const tk = raw.trim(); if (!tk) continue;
    const [nm0, arg = ''] = tk.split(':').map(s => s.trim());
    const nm = nm0.replace(/[\s-]+/g, '_');
    if (nm === 'solid' || nm === 'flat') base = 'solid';
    else if (nm === 'gradient' || nm === 'linear') { base = 'gradient'; baseArg = arg; }
    else if (nm === 'radial') { base = 'radial'; baseArg = arg; }
    else if (nm === 'mesh' || nm === 'marble') base = nm;
    else if (nm === 'photo' || nm === 'image' || nm === 'cover') base = 'photo';
    // sweeps keep their placement arg (e.g. curve:bl, glow:bottom) after the ':'.
    else if (nm === 'curve' || nm === 'curved' || nm === 'curved_gradient' || nm === 'corner' || nm === 'sweep') sweeps.push('curve:' + (arg || 'tr'));
    else if (nm === 'glow' || nm === 'spotlight') sweeps.push('glow:' + (arg || 'top'));
    else if (nm === 'band' || nm === 'band_left' || nm === 'sidebar') sweeps.push('band_left');
    else if (nm === 'band_top' || nm === 'topbar') sweeps.push('band_top');
    else if (nm === 'grain' || nm === 'noise' || nm === 'film') sweeps.push('grain');
    else if (nm === 'vignette' || nm === 'vignet') sweeps.push('vignette');
    // Bold GEOMETRIC sweeps (non-circular) — the anti-"AI circle" vocabulary.
    else if (nm === 'tri' || nm === 'triangle' || nm === 'wedge') sweeps.push('tri:' + (arg || 'br'));
    else if (nm === 'blocks' || nm === 'bauhaus' || nm === 'block') sweeps.push('blocks:' + (arg || 'mix'));
    else if (nm === 'rings' || nm === 'concentric' || nm === 'target') sweeps.push('rings:' + (arg || 'tr'));
    else if (nm === 'arcs' || nm === 'scallop_arc' || nm === 'orbit') sweeps.push('arcs:' + (arg || 'bottom'));
    else if (nm === 'diag' || nm === 'diagonal' || nm === 'slash') sweeps.push('diag:' + (arg || 'tr'));
    else if (nm === 'wave' || nm === 'waveband' || nm === 'ribbon') sweeps.push('wave:' + (arg || 'bottom'));
    else if (nm === 'shards' || nm === 'confetti_shapes' || nm === 'scatter_shapes') sweeps.push('shards:' + (arg || 'mix'));
    else if (nm === 'pattern') { const parts = tk.split(':').map(s => s.trim()); const p = (parts[1] ?? '').replace(/[\s-]+/g, '_'); overlays.push({ name: PATTERN_NAMES.has(p) ? p : 'dots', ...strengthOf(parts[2] ?? '') }); }
    else if (PATTERN_NAMES.has(nm)) overlays.push({ name: nm, ...strengthOf(arg) });
  }
  return { base, baseArg, sweeps, overlays };
}

/** Compose a layered background (base + sweeps + texture) behind content. */

export function composeBackground(spec: string, idp: string, X: number, Y: number, W: number, H: number, ctx: BgCtx, z0 = 0): Layer[] {
  const { base, baseArg, sweeps, overlays } = parseBgSpec(spec);
  const { bg, accent, text } = ctx;
  const bgHex = asHex(bg) ?? '#FAF5EC';
  const bgRgb = hexToRgb(bgHex);
  const dark = bgRgb ? luminance(bgRgb) < 0.42 : false;
  const pal = ctx.palette.length >= 2 ? ctx.palette : [accent, mixHex(bgHex, accent, 0.5), mixHex(bgHex, text, 0.3)];
  const p0 = pal[0] ?? accent, p1 = pal[1] ?? accent, p2 = pal[2] ?? p1;
  const layers: Layer[] = [];
  let z = z0;
  const radialTo = (c: string): Fill => ({ type: 'radial', stops: [{ color: c, position: 0 }, { color: bgHex, position: 100 }] } as unknown as Fill);
  const blob = (id: string, cx: number, cy: number, s: number, c: string, op: number): void => {
    layers.push({ id, type: 'ellipse', z: z++, x: Math.round(cx - s / 2), y: Math.round(cy - s / 2), width: s, height: s, fill: radialTo(c), opacity: +op.toFixed(2) } as unknown as Layer);
  };
  // Resolve a placement keyword (corner/edge/center) to an anchor point.
  const anchor = (a: string): [number, number] => {
    switch (a) {
      case 'tl': return [X, Y]; case 'tr': return [X + W, Y]; case 'bl': return [X, Y + H]; case 'br': return [X + W, Y + H];
      case 'top': return [X + W * 0.5, Y]; case 'bottom': return [X + W * 0.5, Y + H];
      case 'left': return [X, Y + H * 0.5]; case 'right': return [X + W, Y + H * 0.5];
      case 'center': case 'centre': case 'middle': return [X + W * 0.5, Y + H * 0.5];
      default: return [X + W, Y];
    }
  };

  // BASE WASH
  if (base === 'photo' && ctx.image) {
    // Full-bleed image (renders in editor/HTML; resvg can't fetch remote URLs,
    // so PNG preview shows the scrim+layout). A solid legibility veil keeps text
    // readable — dark veil under light text, light veil under dark text.
    layers.push({ id: `${idp}_photo`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'image', src: ctx.image, mode: 'cover' } as unknown as Fill } as unknown as Layer);
    const tRgb = hexToRgb(asHex(text) ?? '#1A1A1A');
    const veil = tRgb && luminance(tRgb) > 0.5 ? '#0A0A0A' : '#FFFFFF';
    layers.push({ id: `${idp}_scrim`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'solid', color: veil }, opacity: 0.5 } as unknown as Layer);
  } else if (base === 'gradient' || base === 'radial') {
    const ang = /^\d+$/.test(baseArg) ? Number(baseArg) : baseArg === 'vert' ? 180 : baseArg === 'horiz' ? 90 : 135;
    // Palette-driven multi-hue wash (tinted toward bg so text stays legible),
    // else a subtle two-tone bg→accent.
    // A radial that drops the SATURATED palette colour at the dead centre reads as
    // an "over-processed glow blob" (user feedback). For radial, keep the canvas
    // colour at the centre (position 0) and let only a FAINT tint reach the edge —
    // and mix gentler on a light canvas so the wash never turns into a colour spot.
    const isRadial = base === 'radial';
    // Gentler on light canvases: a 0.38 mix turned the wash into a muddy two-tone
    // field (user: "over-processed background"). Keep light gradients subtle so a
    // bg stays a backdrop, not a colour event; dark canvases tolerate more.
    const mixK = isRadial ? (dark ? 0.34 : 0.1) : (dark ? 0.46 : 0.2);
    // A bg → SINGLE-tint two-stop wash. A multi-hue 3–4 stop ramp (bg→blue→gold→…)
    // reads as a muddy two-tone field with a hard perceptual seam; one tint keeps
    // the gradient a quiet backdrop. mesh/marble bases still use the full palette.
    const tintTo = ctx.palette[0] ?? accent;
    const stops = [{ color: bgHex, position: 0 }, { color: mixHex(bgHex, tintTo, mixK), position: 100 }];
    const grad: Fill = isRadial
      ? { type: 'radial', stops } as unknown as Fill   // bg at centre, faint tint at edge — no saturated centre blob
      : { type: 'linear', angle: ang, stops } as unknown as Fill;
    layers.push({ id: `${idp}_bg`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: grad } as unknown as Layer);
  } else {
    layers.push({ id: `${idp}_bg`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: expandFill(bg) } as unknown as Layer);
    if (base === 'mesh') {
      // A SUBTLE tonal mesh, not an "AI gradient mesh": 3 soft blobs (down from 4)
      // tinted TOWARD the bg (full-saturation palette hues read as over-processed
      // glow — user feedback) using at most TWO hues so it's quiet depth, not a
      // rainbow wash, at low opacity (0.4→0.26 dark).
      const spots: [number, number][] = [[0.16, 0.12], [0.85, 0.2], [0.78, 0.86]];
      const hues = [pal[0] ?? accent, pal[1] ?? pal[0] ?? accent];
      spots.forEach(([fx, fy], i) => blob(`${idp}_mesh${i}`, X + fx * W, Y + fy * H, Math.round(W * 0.5), mixHex(bgHex, hues[i % hues.length], dark ? 0.55 : 0.4), dark ? 0.26 : 0.16));
    } else if (base === 'marble') {
      const cs: [number, number, number, number][] = [[X + W, Y, -1, 1], [X, Y + H, 1, -1]];
      cs.forEach(([ax, ay, dx, dy], ci) => {
        const inset = Math.round(W * 0.05), step = Math.round(W * 0.1), bse = Math.round(W * 0.4);
        for (let i = 0; i < 3; i++) blob(`${idp}_mb${ci}_${i}`, ax + dx * (inset + i * step), ay + dy * (inset + i * step), bse - i * Math.round(W * 0.06), pal[i % pal.length], (dark ? 0.55 : 0.4) * (0.95 - i * 0.18));
      });
    }
  }

  // SWEEPS — curved-gradient sweep / glow (both placement-aware) / edge band /
  // grain / vignette (built-in shapes only, so everything rasterizes in PNG).
  for (const sw of sweeps) {
    const [kind, place] = sw.split(':');
    if (kind === 'curve') { const [cx, cy] = anchor(place || 'tr'); blob(`${idp}_curve`, cx, cy, Math.round(W * 0.85), mixHex(bgHex, accent, dark ? 0.46 : 0.2), dark ? 0.5 : 0.4); }
    else if (kind === 'glow') { const [cx, cy] = anchor(place || 'top'); blob(`${idp}_glow`, cx, cy, Math.round(W * 0.72), mixHex(bgHex, accent, dark ? 0.42 : 0.18), dark ? 0.32 : 0.22); }
    else if (kind === 'band_left') layers.push({ id: `${idp}_band`, type: 'rect', z: z++, x: X, y: Y, width: Math.max(6, Math.round(W * 0.022)), height: H, fill: { type: 'solid', color: accent } } as unknown as Layer);
    else if (kind === 'band_top') layers.push({ id: `${idp}_band`, type: 'rect', z: z++, x: X, y: Y, width: W, height: Math.max(5, Math.round(W * 0.016)), fill: { type: 'solid', color: accent } } as unknown as Layer);
    else if (kind === 'grain') layers.push({ id: `${idp}_grain`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'noise', frequency: 0.9, octaves: 2, opacity: dark ? 0.06 : 0.045 } as unknown as Fill } as unknown as Layer);
    else if (kind === 'vignette') {
      // Edge-framing: dark radial blobs centred just BEYOND each corner so only
      // the outer edge darkens (the bright centre is left clear) and they fade to
      // the canvas color. Opaque stops → rasterizes everywhere. Subtle on light.
      const dk = mixHex(bgHex, '#000000', dark ? 0.6 : 0.28), s = Math.round(Math.max(W, H) * 0.52);
      const o = Math.round(s * 0.18); // push centre outward past the corner
      ([['tl', X - o, Y - o], ['tr', X + W + o, Y - o], ['bl', X - o, Y + H + o], ['br', X + W + o, Y + H + o]] as [string, number, number][])
        .forEach(([c, cx, cy]) => blob(`${idp}_vig_${c}`, cx, cy, s, dk, dark ? 0.55 : 0.32));
    }
    // ── GEOMETRIC sweeps (rect / triangle / ring / arc / diagonal / wave /
    // scattered polygons) — the NON-circular vocabulary so styles stop looking
    // like the same radial-blob template. All built from primitives that
    // rasterize in PNG. Colors blend toward bg so text over them stays legible.
    else if (kind === 'tri') {
      const x2 = X + W, y2 = Y + H, T = Math.round(W * 0.6);
      const triD = (k: string): string =>
        k === 'tr' ? `M${x2 - T} ${Y}L${x2} ${Y}L${x2} ${Y + T}Z`
          : k === 'tl' ? `M${X} ${Y}L${X + T} ${Y}L${X} ${Y + T}Z`
          : k === 'bl' ? `M${X} ${y2 - T}L${X} ${y2}L${X + T} ${y2}Z`
          : `M${x2 - T} ${y2}L${x2} ${y2}L${x2} ${y2 - T}Z`;
      const c1 = place || 'br', c2 = c1 === 'br' ? 'tl' : c1 === 'tl' ? 'br' : c1 === 'tr' ? 'bl' : 'tr';
      layers.push({ id: `${idp}_tri0`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: triD(c1), fill: { type: 'solid', color: mixHex(bgHex, p0, dark ? 0.5 : 0.55) }, opacity: dark ? 0.3 : 0.28 } as unknown as Layer);
      layers.push({ id: `${idp}_tri1`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: triD(c2), fill: { type: 'solid', color: mixHex(bgHex, p1, 0.45) }, opacity: dark ? 0.2 : 0.16 } as unknown as Layer);
    }
    else if (kind === 'diag') {
      // A diagonal color field (one big triangle across a diagonal) — a flat,
      // hard-edged wash instead of a soft circular gradient.
      const x2 = X + W, y2 = Y + H, d = place === 'tl'
        ? `M${X} ${Y}L${x2} ${Y}L${X} ${y2}Z` : `M${x2} ${Y}L${x2} ${y2}L${X} ${y2}Z`;
      layers.push({ id: `${idp}_diag`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d, fill: { type: 'solid', color: mixHex(bgHex, p0, dark ? 0.42 : 0.5) }, opacity: dark ? 0.26 : 0.2 } as unknown as Layer);
    }
    else if (kind === 'blocks') {
      // Bauhaus/Swiss offset rectangles — strong rectilinear character.
      const specs: [number, number, number, number, string][] = [
        [0.0, 0.0, 0.16, 1.0, p0], [0.74, 0.62, 0.26, 0.38, p1], [0.55, 0.0, 0.45, 0.12, p2],
      ];
      specs.forEach(([fx, fy, fw, fh, c], i) => layers.push({ id: `${idp}_blk${i}`, type: 'rect', z: z++,
        x: Math.round(X + fx * W), y: Math.round(Y + fy * H), width: Math.round(fw * W), height: Math.round(fh * H),
        fill: { type: 'solid', color: mixHex(bgHex, c, dark ? 0.4 : 0.5) }, opacity: dark ? 0.28 : 0.2 } as unknown as Layer));
    }
    else if (kind === 'rings') {
      // Concentric OUTLINED ovals (stroke, no fill) near a corner — round, but a
      // different feel than the solid blob: airy, technical.
      const [cx, cy] = anchor(place || 'tr');
      for (let i = 0; i < 3; i++) { const r = Math.round(W * (0.5 - i * 0.13));
        layers.push({ id: `${idp}_ring${i}`, type: 'ellipse', z: z++, x: Math.round(cx - r), y: Math.round(cy - r), width: r * 2, height: r * 2, stroke: { color: mixHex(bgHex, p0, dark ? 0.55 : 0.6), width: Math.max(2, Math.round(W * 0.006)) }, opacity: dark ? 0.32 : 0.26 } as unknown as Layer); }
    }
    else if (kind === 'arcs') {
      // A big sweeping arc band at an edge (open stroke).
      const band = Math.round(W * 0.5), atBottom = (place || 'bottom') !== 'top';
      const by = atBottom ? Y + H - band : Y - band;
      const box: ShapeBox = { x: X - Math.round(W * 0.15), y: by, w: Math.round(W * 1.3), h: band * 2 };
      const arc = shapePath('arc', box, { start: atBottom ? 180 : 0, end: atBottom ? 360 : 180 });
      layers.push({ id: `${idp}_arc`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: arc.d, stroke: { color: mixHex(bgHex, p0, dark ? 0.55 : 0.55), width: Math.max(8, Math.round(W * 0.05)) }, opacity: dark ? 0.28 : 0.24 } as unknown as Layer);
    }
    else if (kind === 'wave') {
      // A wavy ribbon band along one edge — organic but hard-rendered (no circle).
      const band = Math.round(H * 0.22), atBottom = (place || 'bottom') !== 'top';
      const wy = atBottom ? Y + H - band : Y;
      const box: ShapeBox = { x: X - 2, y: wy, w: W + 4, h: band };
      const wv = shapePath('wave', box, { amplitude: Math.round(band * 0.45), cycles: 3 });
      layers.push({ id: `${idp}_wave`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: wv.d, fill: { type: 'solid', color: mixHex(bgHex, p0, dark ? 0.42 : 0.5) }, opacity: dark ? 0.28 : 0.22 } as unknown as Layer);
    }
    else if (kind === 'shards') {
      // Scattered GEOMETRIC confetti (triangles + squares + a plus) in palette —
      // playful, editorial, decidedly not dots.
      const shards: [number, number, number, number][] = [
        [0.12, 0.08, 0.07, 0], [0.9, 0.14, 0.05, 1], [0.84, 0.78, 0.08, 2],
        [0.08, 0.86, 0.06, 0], [0.93, 0.5, 0.045, 1], [0.06, 0.46, 0.05, 2],
      ];
      shards.forEach(([fx, fy, fs, kindIdx], i) => {
        const cx = X + fx * W, cy = Y + fy * H, s2 = Math.round(fs * W), c = mixHex(bgHex, [p0, p1, p2][i % 3] ?? p0, dark ? 0.5 : 0.6);
        if (kindIdx === 0) layers.push({ id: `${idp}_sh${i}`, type: 'path', z: z++, x: X, y: Y, width: W, height: H, d: `M${Math.round(cx)} ${Math.round(cy - s2)}L${Math.round(cx + s2)} ${Math.round(cy + s2)}L${Math.round(cx - s2)} ${Math.round(cy + s2)}Z`, fill: { type: 'solid', color: c }, opacity: dark ? 0.32 : 0.28 } as unknown as Layer);
        else if (kindIdx === 1) layers.push({ id: `${idp}_sh${i}`, type: 'rect', z: z++, x: Math.round(cx - s2), y: Math.round(cy - s2), width: s2 * 2, height: s2 * 2, rotation: 18, fill: { type: 'solid', color: c }, opacity: dark ? 0.32 : 0.28 } as unknown as Layer);
        else layers.push({ id: `${idp}_sh${i}`, type: 'rect', z: z++, x: Math.round(cx - s2 * 1.4), y: Math.round(cy - s2 * 0.4), width: Math.round(s2 * 2.8), height: Math.round(s2 * 0.8), fill: { type: 'solid', color: c }, opacity: dark ? 0.32 : 0.28 } as unknown as Layer);
      });
    }
  }

  // OVERLAY — a pattern texture (graph paper / dot grid / etc.). When the model
  // NAMES a pattern it wants to SEE it, so the base is visible-but-tasteful and
  // scales with the token's strength (`graph_paper:soft|bold|0.12`). The auto
  // default never reaches here (defaultBgStyle emits a sweep grain, not a pattern),
  // so loudening explicit patterns leaves quiet posters quiet.
  overlays.forEach((ov, i) => {
    // Grid/line patterns read as ink lines → a touch more contrast than dot fills.
    const liney = /grid|graph_paper|blueprint|crosshatch|stripe|isometric|brick|carbon|engraving/.test(ov.name);
    const fg = dark ? mixHex(bgHex, text, liney ? 0.6 : 0.45) : mixHex(bgHex, text, liney ? 0.5 : 0.32);
    const visBase = dark ? 0.16 : 0.12;
    const opacity = ov.absOpacity ?? Math.max(0.025, Math.min(0.55, visBase * ov.strength));
    layers.push({ id: `${idp}_tex${i || ''}`, type: 'rect', z: z++, x: X, y: Y, width: W, height: H, fill: { type: 'pattern', pattern: ov.name, fg, opacity, scale: 2.4 } as unknown as Fill } as unknown as Layer);
  });
  return layers;
}

// When a preset is given NO bg_style, the OLD fallback was a flat solid rect —
// which reads as a template, the #1 "AI-generated" tell and the gap between a
// diagnose-clean poster and the hand-art-directed peak. Default instead to a
// tasteful, collision-proof designed background: a faint accent glow/sweep + a
// premium grain, tuned by bg luminance. Subtle enough never to fight the text,
// it's what turns a flat number-on-cream into a designed poster. A model that
// genuinely wants flat can still pass bg_style:"solid".

export const MOTIF_NAMES = new Set([
  'bolt', 'lightning', 'arcs', 'waves', 'orbit', 'rings', 'rays', 'sunburst',
  'grid', 'dots', 'peaks', 'mountains', 'circuit',
]);

export function motifLayers(name: string, box: ShapeBox, accent: string, idp: string, z0: number): Layer[] {
  const { x, y, w, h } = box;
  const a = accent;
  const layers: Layer[] = [];
  let z = z0;
  const R = (n: number): number => Math.round(n);
  const cx = x + w / 2, cy = y + h / 2;
  const poly = (pts: number[][]): string => pts.map((p, i) => `${i ? 'L' : 'M'}${R(p[0])} ${R(p[1])}`).join(' ');
  const op = (v: number): number => +v.toFixed(2);
  const key = MOTIF_NAMES.has(name) ? name : 'arcs';

  switch (key) {
    case 'bolt':
    case 'lightning': {
      const gw = w * 0.78, gh = h * 0.6;
      layers.push({ id: `${idp}_glow`, type: 'ellipse', z: z++, x: R(cx - gw / 2), y: R(cy - gh / 2), width: R(gw), height: R(gh), fill: { type: 'solid', color: a }, opacity: 0.1 } as unknown as Layer);
      const bx = x + w * 0.5;
      const bolt = poly([
        [bx + w * 0.10, y + h * 0.03], [bx - w * 0.14, y + h * 0.46], [bx + w * 0.02, y + h * 0.46],
        [bx - w * 0.20, y + h * 0.97], [bx + w * 0.16, y + h * 0.42], [bx - w * 0.01, y + h * 0.42],
      ]) + ' Z';
      layers.push({ id: `${idp}_bolt`, type: 'path', z: z++, x, y, width: w, height: h, d: bolt, fill: { type: 'solid', color: a }, opacity: 0.92 } as unknown as Layer);
      const fork = poly([[bx + w * 0.02, y + h * 0.46], [bx + w * 0.24, y + h * 0.64]]);
      layers.push({ id: `${idp}_fork`, type: 'path', z: z++, x, y, width: w, height: h, d: fork, stroke: { color: a, width: Math.max(3, R(w * 0.02)) }, opacity: 0.65 } as unknown as Layer);
      break;
    }
    case 'arcs': {
      const n = 5, max = Math.min(w, h) * 0.98, ox = x + w, oy = y + h * 0.08;
      for (let i = 0; i < n; i++) {
        const r = max * (0.26 + 0.74 * (i / (n - 1)));
        const d = `M${R(ox - r)} ${R(oy)} A ${R(r)} ${R(r)} 0 0 1 ${R(ox)} ${R(oy + r)}`;
        layers.push({ id: `${idp}_arc${i}`, type: 'path', z: z++, x, y, width: w, height: h, d, stroke: { color: a, width: Math.max(2, R(w * 0.012)) }, opacity: op(0.22 + 0.58 * (i / (n - 1))) } as unknown as Layer);
      }
      break;
    }
    case 'waves': {
      const n = 5, amp = h * 0.055, step = h / (n + 1), seg = 18;
      for (let i = 0; i < n; i++) {
        const baseY = y + step * (i + 1), pts: number[][] = [];
        for (let s = 0; s <= seg; s++) pts.push([x + (w * s) / seg, baseY + Math.sin((s / seg) * Math.PI * 3 + i * 0.6) * amp]);
        layers.push({ id: `${idp}_wave${i}`, type: 'path', z: z++, x, y, width: w, height: h, d: poly(pts), stroke: { color: a, width: Math.max(2, R(w * 0.01)) }, opacity: op(0.3 + 0.5 * (i / (n - 1))) } as unknown as Layer);
      }
      break;
    }
    case 'orbit':
    case 'rings': {
      const n = 3, max = Math.min(w, h) * 0.92;
      for (let i = 0; i < n; i++) {
        const r = (max * (0.42 + 0.58 * (i / (n - 1)))) / 2;
        layers.push({ id: `${idp}_ring${i}`, type: 'ellipse', z: z++, x: R(cx - r), y: R(cy - r), width: R(r * 2), height: R(r * 2), stroke: { color: a, width: Math.max(2, R(w * 0.01)) }, opacity: op(0.3 + 0.35 * (i / (n - 1))) } as unknown as Layer);
        const ang = -0.6 + i * 1.7, nx = cx + Math.cos(ang) * r, ny = cy + Math.sin(ang) * r, ds = Math.max(6, w * 0.035);
        layers.push({ id: `${idp}_node${i}`, type: 'ellipse', z: z++, x: R(nx - ds / 2), y: R(ny - ds / 2), width: R(ds), height: R(ds), fill: { type: 'solid', color: a }, opacity: 0.9 } as unknown as Layer);
      }
      const cs = Math.max(8, w * 0.05);
      layers.push({ id: `${idp}_core`, type: 'ellipse', z: z++, x: R(cx - cs / 2), y: R(cy - cs / 2), width: R(cs), height: R(cs), fill: { type: 'solid', color: a }, opacity: 1 } as unknown as Layer);
      break;
    }
    case 'rays':
    case 'sunburst': {
      const n = 12, rad = Math.min(w, h) * 0.52, cs = Math.max(8, w * 0.06);
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * Math.PI * 2;
        layers.push({ id: `${idp}_ray${i}`, type: 'path', z: z++, x, y, width: w, height: h, d: poly([[cx, cy], [cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad]]), stroke: { color: a, width: Math.max(2, R(w * 0.012)) }, opacity: op(i % 2 ? 0.35 : 0.7) } as unknown as Layer);
      }
      layers.push({ id: `${idp}_hub`, type: 'ellipse', z: z++, x: R(cx - cs / 2), y: R(cy - cs / 2), width: R(cs), height: R(cs), fill: { type: 'solid', color: a }, opacity: 1 } as unknown as Layer);
      break;
    }
    case 'grid':
    case 'dots': {
      const cols = 6, rows = Math.min(14, Math.max(3, Math.round((6 * h) / w)));
      const ds = Math.max(4, Math.min(w / cols, h / rows) * 0.26);
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const px = x + ((c + 0.5) / cols) * w, py = y + ((r + 0.5) / rows) * h;
        layers.push({ id: `${idp}_dot${r}_${c}`, type: 'ellipse', z: z++, x: R(px - ds / 2), y: R(py - ds / 2), width: R(ds), height: R(ds), fill: { type: 'solid', color: a }, opacity: op(0.2 + 0.6 * (c / (cols - 1))) } as unknown as Layer);
      }
      break;
    }
    case 'peaks':
    case 'mountains': {
      const ranges = 3;
      for (let i = 0; i < ranges; i++) {
        const baseY = y + h * (0.55 + 0.15 * i), peakY = y + h * (0.2 + 0.18 * i), midX = x + w * (0.3 + 0.2 * i);
        const d = poly([[x, baseY], [midX, peakY], [x + w, baseY], [x + w, y + h], [x, y + h]]) + ' Z';
        layers.push({ id: `${idp}_peak${i}`, type: 'path', z: z++, x, y, width: w, height: h, d, fill: { type: 'solid', color: a }, opacity: op(0.18 + 0.22 * i) } as unknown as Layer);
      }
      break;
    }
    case 'circuit': {
      const lines = 5;
      for (let i = 0; i < lines; i++) {
        const sy = y + h * ((i + 0.5) / lines), midX = x + w * (0.35 + 0.12 * (i % 3)), turnY = sy + (i % 2 ? -h * 0.08 : h * 0.08);
        layers.push({ id: `${idp}_trace${i}`, type: 'path', z: z++, x, y, width: w, height: h, d: poly([[x, sy], [midX, sy], [midX, turnY], [x + w, turnY]]), stroke: { color: a, width: Math.max(2, R(w * 0.01)) }, opacity: op(0.3 + 0.4 * (i / (lines - 1))) } as unknown as Layer);
        const ds = Math.max(6, w * 0.03);
        layers.push({ id: `${idp}_jn${i}`, type: 'ellipse', z: z++, x: R(midX - ds / 2), y: R(turnY - ds / 2), width: R(ds), height: R(ds), fill: { type: 'solid', color: a }, opacity: 0.85 } as unknown as Layer);
      }
      break;
    }
  }
  return layers;
}

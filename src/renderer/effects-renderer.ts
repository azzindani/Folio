import type { Effects, Duotone } from '../schema/types';
import { createSVGElement, defIdFor, appendDefOnce, getOrCreateDefs } from './svg-utils';

// sRGB luminance weights — route color → grayscale for duotone/grain.
const LUMA = '0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0.2126 0.7152 0.0722 0 0 0 0 0 1 0';

function hexToRgb01(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0.5, 0.5, 0.5];
  let h = m[1];
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255];
}

const fx = (v: number): string => String(Number(v.toFixed(2)));

/** A smear's filter region: its box grown by half the travel each way, plus the usual 40% for shadows. */
function smearBox(mb: NonNullable<Effects['motion_blur']>): Record<string, string> {
  const px = Math.abs(mb.dx) / 2 + 0.4 * mb.box.width, py = Math.abs(mb.dy) / 2 + 0.4 * mb.box.height;
  return { x: fx(mb.box.x - px), y: fx(mb.box.y - py), width: fx(mb.box.width + 2 * px), height: fx(mb.box.height + 2 * py) };
}

function feFunc(tag: 'feFuncR' | 'feFuncG' | 'feFuncB', type: string, tableValues: string): SVGElement {
  return createSVGElement(tag, { type, tableValues });
}

export function applyEffects(
  element: SVGElement,
  effects: Effects,
  svg: SVGSVGElement,
): void {
  const defs = getOrCreateDefs(svg);
  const prims: SVGElement[] = [];
  let cur = 'SourceGraphic';
  let n = 0;
  // Append a primitive that consumes `cur` and (optionally) names its output.
  const step = (el: SVGElement, named = true): void => {
    el.setAttribute('in', cur);
    if (named) { const r = `e${++n}`; el.setAttribute('result', r); cur = r; }
    prims.push(el);
  };

  // 1. Saturation (0 = grayscale, >1 = punchy).
  if (effects.saturate !== undefined && effects.saturate !== 1) {
    step(createSVGElement('feColorMatrix', { type: 'saturate', values: String(Math.max(0, effects.saturate)) }));
  }

  // 2. Duotone — luminance → two-color ramp.
  if (effects.duotone) {
    step(createSVGElement('feColorMatrix', { type: 'matrix', values: LUMA }));
    const d: Duotone = effects.duotone;
    const [sr, sg, sb] = hexToRgb01(d.shadow);
    const [hr, hg, hb] = hexToRgb01(d.highlight);
    const ct = createSVGElement('feComponentTransfer', {});
    ct.appendChild(feFunc('feFuncR', 'table', `${sr.toFixed(3)} ${hr.toFixed(3)}`));
    ct.appendChild(feFunc('feFuncG', 'table', `${sg.toFixed(3)} ${hg.toFixed(3)}`));
    ct.appendChild(feFunc('feFuncB', 'table', `${sb.toFixed(3)} ${hb.toFixed(3)}`));
    step(ct);
  }

  // 3. Posterize — quantize each channel to N tonal levels.
  if (effects.posterize && effects.posterize >= 2) {
    const lv = Math.min(8, Math.round(effects.posterize));
    const tv = Array.from({ length: lv }, (_, i) => (i / (lv - 1)).toFixed(3)).join(' ');
    const ct = createSVGElement('feComponentTransfer', {});
    ct.appendChild(feFunc('feFuncR', 'discrete', tv));
    ct.appendChild(feFunc('feFuncG', 'discrete', tv));
    ct.appendChild(feFunc('feFuncB', 'discrete', tv));
    step(ct);
  }

  // 4. Foreground blur.
  if (effects.blur) {
    step(createSVGElement('feGaussianBlur', { stdDeviation: effects.blur }));
  }

  // 5. Film/paper grain — speckle the styled graphic, clipped to its alpha.
  if (effects.grain && effects.grain > 0) {
    const k = Math.min(1, effects.grain);
    const turb = createSVGElement('feTurbulence', {
      type: 'fractalNoise', baseFrequency: '0.9', numOctaves: '2', stitchTiles: 'stitch', result: 'grainRaw',
    });
    prims.push(turb);
    const a = (0.5 * k).toFixed(3);
    const gm = createSVGElement('feColorMatrix', {
      in: 'grainRaw', type: 'matrix',
      values: `0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 ${a} ${a} ${a} 0 0`, result: 'grainA',
    });
    prims.push(gm);
    const clip = createSVGElement('feComposite', { in: 'grainA', in2: cur, operator: 'in', result: 'grainClip' });
    prims.push(clip);
    const blend = createSVGElement('feBlend', { in: cur, in2: 'grainClip', mode: 'multiply', result: `e${++n}` });
    cur = `e${n}`;
    prims.push(blend);
  }

  // 6. Drop shadows (stacked, cast from the styled graphic).
  if (effects.shadows?.length) {
    for (const shadow of effects.shadows) {
      if (shadow.spread && shadow.spread > 0) {
        const r = `e${++n}`;
        prims.push(createSVGElement('feMorphology', { in: 'SourceAlpha', operator: 'dilate', radius: shadow.spread, result: 'spread' }));
        prims.push(createSVGElement('feGaussianBlur', { in: 'spread', stdDeviation: shadow.blur / 2, result: 'blurred' }));
        prims.push(createSVGElement('feOffset', { in: 'blurred', dx: shadow.x, dy: shadow.y, result: 'offset' }));
        prims.push(createSVGElement('feFlood', { 'flood-color': shadow.color, 'flood-opacity': '1', result: 'color' }));
        prims.push(createSVGElement('feComposite', { in: 'color', in2: 'offset', operator: 'in', result: 'shadow' }));
        const merge = createSVGElement('feMerge', { result: r });
        merge.appendChild(createSVGElement('feMergeNode', { in: 'shadow' }));
        merge.appendChild(createSVGElement('feMergeNode', { in: cur }));
        prims.push(merge);
        cur = r;
      } else {
        const ds = createSVGElement('feDropShadow', {
          dx: shadow.x, dy: shadow.y, stdDeviation: shadow.blur / 2,
          'flood-color': shadow.color, 'flood-opacity': '1',
        });
        step(ds);
      }
    }
  }

  // 7. Motion blur — the styled graphic at N points along its travel over the
  // shutter, averaged in premultiplied colour: the exact mean of N sub-frames
  // of a move (export/motion-blur.ts). Averaged pairwise, ½ + ½ per level:
  // resvg keeps each result in 8 bits, and 24 sums of 1/24 came to 94%.
  const mb = effects.motion_blur;
  if (mb && mb.samples >= 2) {
    const src = cur;
    let level = Array.from({ length: mb.samples }, (_, i) => {
      const f = i / (mb.samples - 1) - 0.5;
      prims.push(createSVGElement('feOffset', { in: src, dx: fx(mb.dx * f), dy: fx(mb.dy * f), result: `mb${i}` }));
      return `mb${i}`;
    });
    while (level.length > 1) {
      const next: string[] = [];
      for (let i = 0; i + 1 < level.length; i += 2) {
        const r = `e${++n}`;
        prims.push(createSVGElement('feComposite', { in: level[i] ?? '', in2: level[i + 1] ?? '', operator: 'arithmetic', k1: '0', k2: '0.5', k3: '0.5', k4: '0', result: r }));
        next.push(r);
      }
      level = next;
    }
    cur = level[0] ?? src;
    // Past the copy cap the copies stand apart; a blur the length of one gap, along the travel, closes them.
    const gx = Math.abs(mb.dx) / (mb.samples - 1), gy = Math.abs(mb.dy) / (mb.samples - 1);
    if (Math.hypot(gx, gy) > 3) step(createSVGElement('feGaussianBlur', { stdDeviation: `${fx(gx / 2)} ${fx(gy / 2)}` }));
  }

  if (prims.length > 0) {
    const filterId = defIdFor('fx', effects);
    // A smear reaches past the usual 40% margin: its region is measured in the layer's own units.
    const region = mb && mb.samples >= 2
      ? { filterUnits: 'userSpaceOnUse', ...smearBox(mb) }
      : { x: '-40%', y: '-40%', width: '180%', height: '180%' };
    const filter = createSVGElement('filter', {
      id: filterId, ...region,
      'color-interpolation-filters': 'sRGB',
    });
    for (const prim of prims) filter.appendChild(prim);
    appendDefOnce(defs, filter);
    element.setAttribute('filter', `url(#${filterId})`);
  }

  if (effects.opacity !== undefined) {
    element.setAttribute('opacity', String(effects.opacity));
  }

  if (effects.blend_mode) {
    element.style.mixBlendMode = effects.blend_mode;
  }

  // Glassmorphism — only honored in HTML/live contexts (no SVG backdrop in resvg).
  if (effects.backdrop_blur) {
    element.style.backdropFilter = `blur(${effects.backdrop_blur}px)`;
    (element.style as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter = `blur(${effects.backdrop_blur}px)`;
  }
}

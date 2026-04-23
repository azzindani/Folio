import type { Fill, LinearGradientFill, RadialGradientFill, ConicGradientFill, NoiseFill, ColorOrGradient } from '../schema/types';
import { createSVGElement, uniqueDefId, getOrCreateDefs } from './svg-utils';

export interface FillResult {
  fill: string;
  opacity?: number;
  extraElements?: SVGElement[];
}

export function resolveColorOrGradient(color: ColorOrGradient, defs: SVGDefsElement): string {
  if (typeof color === 'string') return color;
  if (color.type === 'linear') return renderLinearGradient(color, defs);
  return renderRadialGradient(color, defs);
}

function renderLinearGradient(
  fill: LinearGradientFill,
  defs: SVGDefsElement,
): string {
  const id = uniqueDefId('lg');
  const radians = ((fill.angle - 90) * Math.PI) / 180;
  const x1 = 50 - Math.cos(radians) * 50;
  const y1 = 50 - Math.sin(radians) * 50;
  const x2 = 50 + Math.cos(radians) * 50;
  const y2 = 50 + Math.sin(radians) * 50;

  const gradient = createSVGElement('linearGradient', {
    id,
    x1: `${x1}%`,
    y1: `${y1}%`,
    x2: `${x2}%`,
    y2: `${y2}%`,
  });

  for (const stop of fill.stops) {
    gradient.appendChild(
      createSVGElement('stop', {
        offset: `${stop.position}%`,
        'stop-color': stop.color,
      }),
    );
  }

  defs.appendChild(gradient);
  return `url(#${id})`;
}

function renderRadialGradient(
  fill: RadialGradientFill,
  defs: SVGDefsElement,
): string {
  const id = uniqueDefId('rg');
  const gradient = createSVGElement('radialGradient', {
    id,
    cx: `${fill.cx}%`,
    cy: `${fill.cy}%`,
    r: `${fill.radius}%`,
  });

  for (const stop of fill.stops) {
    gradient.appendChild(
      createSVGElement('stop', {
        offset: `${stop.position}%`,
        'stop-color': stop.color,
      }),
    );
  }

  defs.appendChild(gradient);
  return `url(#${id})`;
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = hex.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

function lerpColor(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex(
    Math.round(ar + (br - ar) * t),
    Math.round(ag + (bg - ag) * t),
    Math.round(ab + (bb - ab) * t),
  );
}

function interpolateStopColor(stops: { position: number; color: string }[], t: number): string {
  if (stops.length === 0) return '#000000';
  if (t <= stops[0].position) return stops[0].color;
  if (t >= stops[stops.length - 1].position) return stops[stops.length - 1].color;
  for (let i = 0; i < stops.length - 1; i++) {
    const s0 = stops[i];
    const s1 = stops[i + 1];
    if (t >= s0.position && t <= s1.position) {
      const ratio = (t - s0.position) / (s1.position - s0.position);
      return lerpColor(s0.color, s1.color, ratio);
    }
  }
  return stops[stops.length - 1].color;
}

function renderConicGradient(
  fill: ConicGradientFill,
  defs: SVGDefsElement,
  bounds: { width: number; height: number },
): string {
  const { width: w, height: h } = bounds;
  const cx = (fill.cx / 100) * w;
  const cy = (fill.cy / 100) * h;
  const r = Math.sqrt(w * w + h * h);

  const id = uniqueDefId('cg');
  const pattern = createSVGElement('pattern', {
    id,
    x: '0', y: '0',
    width: String(w), height: String(h),
    patternUnits: 'userSpaceOnUse',
  });

  const N = 60;
  const sorted = fill.stops.slice().sort((a, b) => a.position - b.position);
  const startDeg = -90;

  for (let i = 0; i < N; i++) {
    const t0 = (i / N) * 100;
    const t1 = ((i + 1) / N) * 100;
    const tmid = (t0 + t1) / 2;
    const color = interpolateStopColor(sorted, tmid);

    const a0 = toRad(startDeg + (t0 / 100) * 360);
    const a1 = toRad(startDeg + (t1 / 100) * 360);

    const x0 = cx + Math.cos(a0) * r;
    const y0 = cy + Math.sin(a0) * r;
    const x1 = cx + Math.cos(a1) * r;
    const y1 = cy + Math.sin(a1) * r;

    const d = `M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 0 1 ${x1} ${y1} Z`;
    pattern.appendChild(createSVGElement('path', { d, fill: color }));
  }

  defs.appendChild(pattern);
  return `url(#${id})`;
}

function renderNoiseFilter(
  fill: NoiseFill,
  defs: SVGDefsElement,
  width: number,
  height: number,
): SVGElement {
  const filterId = uniqueDefId('noise');
  const filter = createSVGElement('filter', {
    id: filterId,
    x: '0',
    y: '0',
    width: '100%',
    height: '100%',
  });

  filter.appendChild(
    createSVGElement('feTurbulence', {
      type: 'fractalNoise',
      baseFrequency: String(fill.frequency),
      numOctaves: String(fill.octaves),
      stitchTiles: 'stitch',
    }),
  );

  defs.appendChild(filter);

  const noiseRect = createSVGElement('rect', {
    x: '0',
    y: '0',
    width: String(width),
    height: String(height),
    filter: `url(#${filterId})`,
    opacity: String(fill.opacity),
  });

  return noiseRect;
}

export function applyFill(
  fill: Fill,
  svg: SVGSVGElement,
  bounds: { width: number; height: number },
): FillResult {
  const defs = getOrCreateDefs(svg);

  switch (fill.type) {
    case 'solid':
      return {
        fill: fill.color,
        opacity: fill.opacity,
      };

    case 'linear':
      return { fill: renderLinearGradient(fill, defs) };

    case 'radial':
      return { fill: renderRadialGradient(fill, defs) };

    case 'conic':
      return { fill: renderConicGradient(fill, defs, bounds) };

    case 'noise':
      return {
        fill: 'none',
        extraElements: [renderNoiseFilter(fill, defs, bounds.width, bounds.height)],
      };

    case 'multi': {
      const extras: SVGElement[] = [];
      let primaryFill = 'none';
      for (const sublayer of fill.layers) {
        const result = applyFill(sublayer, svg, bounds);
        if (result.fill !== 'none' && primaryFill === 'none') {
          primaryFill = result.fill;
        }
        if (result.extraElements) {
          extras.push(...result.extraElements);
        }
      }
      return { fill: primaryFill, extraElements: extras.length ? extras : undefined };
    }

    case 'none':
      return { fill: 'none' };
  }
}

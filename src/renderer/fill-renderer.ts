import type { Fill, LinearGradientFill, RadialGradientFill, ConicGradientFill, NoiseFill, ImageFill, ColorOrGradient } from '../schema/types';
import { createSVGElement, uniqueDefId, getOrCreateDefs } from './svg-utils';
import { renderPattern } from './pattern-renderer';
import { resolveAssetUrl } from './render-context';

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
  // cx/cy/radius default to 50% (centered, full bounds) when omitted —
  // makes hand-written YAML templates terser without crashing the SVG
  // with `"undefined%"`.
  const cx = fill.cx ?? 50;
  const cy = fill.cy ?? 50;
  const r  = fill.radius ?? 50;
  const gradient = createSVGElement('radialGradient', {
    id,
    cx: `${cx}%`,
    cy: `${cy}%`,
    r:  `${r}%`,
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


function renderConicGradient(
  fill: ConicGradientFill,
  defs: SVGDefsElement,
  _bounds: { width: number; height: number },
): string {
  const id = uniqueDefId('cg');
  const sorted = fill.stops.slice().sort((a, b) => a.position - b.position);

  const cx = fill.cx ?? 50;
  const cy = fill.cy ?? 50;
  const gradient = createSVGElement('radialGradient', {
    id,
    cx: `${cx}%`,
    cy: `${cy}%`,
    r: '50%',
    fx: `${cx}%`,
    fy: `${cy}%`,
    gradientUnits: 'objectBoundingBox',
  });

  for (const stop of sorted) {
    const s = createSVGElement('stop', {
      offset: `${stop.position}%`,
    });
    s.style.stopColor = stop.color;
    gradient.appendChild(s);
  }

  defs.appendChild(gradient);
  return `url(#${id})`;
}

/**
 * A noise fill paints nothing itself — it returns a SIBLING rect carrying the
 * turbulence filter, which the caller must append. That rect has to sit on the
 * layer's box, so the origin is passed in: built at 0,0 it painted the grain
 * over the top-left of the canvas instead of over the layer that asked for it.
 */
function renderNoiseFilter(
  fill: NoiseFill,
  defs: SVGDefsElement,
  width: number,
  height: number,
  originX = 0,
  originY = 0,
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
    x: String(originX),
    y: String(originY),
    width: String(width),
    height: String(height),
    filter: `url(#${filterId})`,
    opacity: String(fill.opacity),
  });

  return noiseRect;
}

// Image / photo-texture fill via an SVG <pattern>. mode='tile' repeats the
// source at tile_size; cover/contain fit one image to the shape bounds. Uses
// userSpaceOnUse, so it aligns to the canvas grid (ideal for full-canvas bgs).
function renderImageFill(
  fill: ImageFill,
  defs: SVGDefsElement,
  bounds: { width: number; height: number },
): string {
  const id = uniqueDefId('img');
  const mode = fill.mode ?? 'cover';
  const tile = mode === 'tile' ? Math.max(4, fill.tile_size ?? 96) : 0;
  const w = mode === 'tile' ? tile : Math.max(1, bounds.width);
  const h = mode === 'tile' ? tile : Math.max(1, bounds.height);
  const pattern = createSVGElement('pattern', {
    id, patternUnits: 'userSpaceOnUse', width: w, height: h,
  });
  const preserve = mode === 'contain' ? 'xMidYMid meet'
    : mode === 'tile' ? 'xMidYMid slice' : 'xMidYMid slice';
  const image = createSVGElement('image', {
    x: 0, y: 0, width: w, height: h,
    preserveAspectRatio: preserve,
    opacity: fill.opacity !== undefined ? String(fill.opacity) : undefined,
  });
  const fillHref = resolveAssetUrl(fill.src);
  image.setAttribute('href', fillHref);
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', fillHref);
  pattern.appendChild(image);
  defs.appendChild(pattern);
  return `url(#${id})`;
}

export function applyFill(
  fill: Fill,
  svg: SVGSVGElement,
  bounds: { width: number; height: number; x?: number; y?: number },
): FillResult {
  // Robustness: a bare color string (e.g. `fill: '#0A0A0A'` or `fill: '$accent'`)
  // is a common shorthand a model emits on a complete-mode layer. Without this
  // guard it falls through the type switch, returns undefined, and the caller
  // crashes on `.fill` → the layer renders as an error placeholder (an invisible
  // or white block). Treat any string as a solid fill.
  if (typeof fill === 'string') {
    return { fill };
  }

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

    case 'pattern':
      return { fill: renderPattern(fill, defs), opacity: undefined };

    case 'image':
      return { fill: renderImageFill(fill, defs, bounds) };

    case 'noise':
      return {
        fill: 'none',
        extraElements: [renderNoiseFilter(fill, defs, bounds.width, bounds.height, bounds.x ?? 0, bounds.y ?? 0)],
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

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

function renderConicGradient(
  fill: ConicGradientFill,
  defs: SVGDefsElement,
): string {
  // SVG doesn't natively support conic gradients.
  // Approximate with a radial gradient as fallback.
  const id = uniqueDefId('cg');
  const gradient = createSVGElement('radialGradient', {
    id,
    cx: `${fill.cx}%`,
    cy: `${fill.cy}%`,
    r: '50%',
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
      return { fill: renderConicGradient(fill, defs) };

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

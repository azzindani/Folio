import type { Effects } from '../schema/types';
import { createSVGElement, uniqueDefId, getOrCreateDefs } from './svg-utils';

export function applyEffects(
  element: SVGElement,
  effects: Effects,
  svg: SVGSVGElement,
): void {
  const defs = getOrCreateDefs(svg);
  const filterPrimitives: SVGElement[] = [];

  if (effects.shadows?.length) {
    for (const shadow of effects.shadows) {
      filterPrimitives.push(
        createSVGElement('feDropShadow', {
          dx: shadow.x,
          dy: shadow.y,
          stdDeviation: shadow.blur / 2,
          'flood-color': shadow.color,
          'flood-opacity': '1',
        }),
      );
    }
  }

  if (effects.blur) {
    filterPrimitives.push(
      createSVGElement('feGaussianBlur', {
        in: 'SourceGraphic',
        stdDeviation: effects.blur,
      }),
    );
  }

  if (filterPrimitives.length > 0) {
    const filterId = uniqueDefId('fx');
    const filter = createSVGElement('filter', {
      id: filterId,
      x: '-20%',
      y: '-20%',
      width: '140%',
      height: '140%',
    });
    for (const prim of filterPrimitives) {
      filter.appendChild(prim);
    }
    defs.appendChild(filter);
    element.setAttribute('filter', `url(#${filterId})`);
  }

  if (effects.opacity !== undefined) {
    element.setAttribute('opacity', String(effects.opacity));
  }

  if (effects.blend_mode) {
    element.style.mixBlendMode = effects.blend_mode;
  }
}

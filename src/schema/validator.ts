import type { Layer, DesignSpec, Fill, BaseLayer } from './types';

export interface ValidationError {
  severity: 'error' | 'warning';
  path: string;
  message: string;
}

const VALID_LAYER_TYPES = new Set([
  'rect', 'circle', 'path', 'polygon', 'line',
  'text', 'image', 'icon', 'component', 'component_list',
  'mermaid', 'chart', 'code', 'math', 'group',
  'qrcode', 'auto_layout',
  'interactive_chart', 'interactive_table', 'rich_text',
  'kpi_card', 'map', 'embed_code', 'popup',
]);

const VALID_FILL_TYPES = new Set([
  'solid', 'linear', 'radial', 'conic', 'noise', 'multi', 'none',
]);

export function validateLayer(layer: Partial<BaseLayer>, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!layer.id) {
    errors.push({ severity: 'error', path: `${path}.id`, message: 'Layer id is required' });
  }

  if (!layer.type) {
    errors.push({ severity: 'error', path: `${path}.type`, message: 'Layer type is required' });
  } else if (!VALID_LAYER_TYPES.has(layer.type)) {
    errors.push({ severity: 'error', path: `${path}.type`, message: `Unknown layer type: "${layer.type}"` });
  }

  if (layer.z === undefined || layer.z === null) {
    errors.push({ severity: 'error', path: `${path}.z`, message: 'Layer z-index is required' });
  }

  // Validate pos shorthand array length
  if (layer.pos && Array.isArray(layer.pos) && layer.pos.length !== 4) {
    errors.push({ severity: 'error', path: `${path}.pos`, message: `pos array must have exactly 4 values [x, y, w, h], got ${layer.pos.length}` });
  }

  // Check text layer has content
  if (layer.type === 'text') {
    const textLayer = layer as unknown as { content?: { type: string; value?: string } };
    if (!textLayer.content) {
      errors.push({ severity: 'error', path: `${path}.content`, message: 'Text layer requires content' });
    }
  }

  // Check component layer has ref
  if (layer.type === 'component') {
    const compLayer = layer as unknown as { ref?: string };
    if (!compLayer.ref) {
      errors.push({ severity: 'error', path: `${path}.ref`, message: 'Component layer requires ref' });
    }
  }

  // Check line layer has coordinates
  if (layer.type === 'line') {
    const lineLayer = layer as unknown as { x1?: number; y1?: number; x2?: number; y2?: number };
    if (lineLayer.x1 === undefined || lineLayer.y1 === undefined || lineLayer.x2 === undefined || lineLayer.y2 === undefined) {
      errors.push({ severity: 'warning', path: `${path}`, message: 'Line layer should have x1, y1, x2, y2' });
    }
  }

  return errors;
}

export function validateFill(fill: Partial<Fill>, path: string): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!fill.type) {
    errors.push({ severity: 'error', path: `${path}.type`, message: 'Fill type is required' });
    return errors;
  }

  if (!VALID_FILL_TYPES.has(fill.type)) {
    errors.push({ severity: 'error', path: `${path}.type`, message: `Unknown fill type: "${fill.type}"` });
    return errors;
  }

  if (fill.type === 'solid') {
    if (!('color' in fill) || !fill.color) {
      errors.push({ severity: 'error', path: `${path}.color`, message: 'Solid fill requires a color' });
    }
  }

  if (fill.type === 'linear' || fill.type === 'radial' || fill.type === 'conic') {
    const gradFill = fill as { stops?: unknown[] };
    if (!gradFill.stops || !Array.isArray(gradFill.stops) || gradFill.stops.length < 2) {
      errors.push({ severity: 'error', path: `${path}.stops`, message: 'Gradient requires at least 2 stops' });
    }
  }

  return errors;
}

export function validateDesignLayers(layers: Layer[], basePath: string): ValidationError[] {
  const errors: ValidationError[] = [];
  const ids = new Set<string>();
  const zValues = new Set<number>();

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const layerPath = `${basePath}[${i}]`;

    errors.push(...validateLayer(layer, layerPath));

    // Check duplicate IDs
    if (layer.id) {
      if (ids.has(layer.id)) {
        errors.push({ severity: 'error', path: `${layerPath}.id`, message: `Duplicate layer id: "${layer.id}"` });
      }
      ids.add(layer.id);
    }

    // Check duplicate z-index
    if (layer.z !== undefined) {
      if (zValues.has(layer.z)) {
        errors.push({ severity: 'warning', path: `${layerPath}.z`, message: `Duplicate z-index: ${layer.z}` });
      }
      zValues.add(layer.z);
    }

    // Validate fill if present
    const fillLayer = layer as { fill?: Fill };
    if (fillLayer.fill && fillLayer.fill.type) {
      errors.push(...validateFill(fillLayer.fill, `${layerPath}.fill`));
    }

    // Validate group children recursively
    if (layer.type === 'group' && 'layers' in layer) {
      errors.push(...validateDesignLayers(layer.layers, `${layerPath}.layers`));
    }
  }

  return errors;
}

export function validateDesignSpec(spec: Partial<DesignSpec>): ValidationError[] {
  const errors: ValidationError[] = [];

  if (spec._protocol !== 'design/v1') {
    errors.push({ severity: 'error', path: '_protocol', message: `Expected "design/v1", got "${spec._protocol}"` });
  }

  if (!spec.meta) {
    errors.push({ severity: 'error', path: 'meta', message: 'Design meta is required' });
  } else {
    if (!spec.meta.id) errors.push({ severity: 'error', path: 'meta.id', message: 'Meta id is required' });
    if (!spec.meta.name) errors.push({ severity: 'error', path: 'meta.name', message: 'Meta name is required' });
    if (!spec.meta.type) errors.push({ severity: 'error', path: 'meta.type', message: 'Meta type is required' });
  }

  if (!spec.document) {
    errors.push({ severity: 'error', path: 'document', message: 'Document dimensions are required' });
  } else {
    if (!spec.document.width || spec.document.width <= 0) {
      errors.push({ severity: 'error', path: 'document.width', message: 'Document width must be positive' });
    }
    if (!spec.document.height || spec.document.height <= 0) {
      errors.push({ severity: 'error', path: 'document.height', message: 'Document height must be positive' });
    }
  }

  if (spec.layers) {
    errors.push(...validateDesignLayers(spec.layers, 'layers'));
  }

  if (spec.pages) {
    for (let i = 0; i < spec.pages.length; i++) {
      const page = spec.pages[i];
      if (!page.id) {
        errors.push({ severity: 'error', path: `pages[${i}].id`, message: 'Page id is required' });
      }
      if (page.layers) {
        errors.push(...validateDesignLayers(page.layers, `pages[${i}].layers`));
      }
    }
  }

  return errors;
}

export function expandPositionShorthand(layer: BaseLayer): BaseLayer {
  if (layer.pos) {
    if (Array.isArray(layer.pos)) {
      const [x, y, width, height] = layer.pos;
      return { ...layer, x, y, width, height, pos: undefined };
    }
    // Grid mode would be expanded by grid calculator
  }
  return layer;
}

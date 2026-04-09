import type { ComponentSpec, TemplateSpec, Layer, Page } from '../schema/types';

const COMPONENT_PROP_REGEX = /\{\{(\w+)\}\}/g;

export interface ComponentRegistry {
  components: Map<string, ComponentSpec>;
  templates: Map<string, TemplateSpec>;
}

export function createRegistry(): ComponentRegistry {
  return {
    components: new Map(),
    templates: new Map(),
  };
}

function resolveComponentProps(value: string, props: Record<string, unknown>): string {
  return value.replace(COMPONENT_PROP_REGEX, (_, propName: string) => {
    const val = props[propName];
    return val !== undefined ? String(val) : `{{${propName}}}`;
  });
}

function resolveLayerProps(layer: Layer, props: Record<string, unknown>): Layer {
  const resolved = { ...layer } as Record<string, unknown>;

  for (const [key, value] of Object.entries(resolved)) {
    if (typeof value === 'string' && value.includes('{{')) {
      resolved[key] = resolveComponentProps(value, props);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      const obj = value as Record<string, unknown>;
      const resolvedObj = { ...obj };
      for (const [k, v] of Object.entries(resolvedObj)) {
        if (typeof v === 'string' && v.includes('{{')) {
          resolvedObj[k] = resolveComponentProps(v, props);
        }
      }
      resolved[key] = resolvedObj;
    }
  }

  // Recurse into content for text layers
  if (resolved['content'] && typeof resolved['content'] === 'object') {
    const content = resolved['content'] as Record<string, unknown>;
    if (typeof content['value'] === 'string' && content['value'].includes('{{')) {
      resolved['content'] = {
        ...content,
        value: resolveComponentProps(content['value'] as string, props),
      };
    }
  }

  return resolved as unknown as Layer;
}

export function resolveComponent(
  componentSpec: ComponentSpec,
  slots: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
): Layer[] {
  // Merge defaults with provided slots
  const props: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(componentSpec.props)) {
    props[key] = slots[key] ?? def.default ?? '';
  }

  // Apply overrides
  for (const [key, value] of Object.entries(overrides)) {
    props[key] = value;
  }

  return componentSpec.layers.map(layer => resolveLayerProps(layer, props));
}

export function resolveTemplate(
  templateSpec: TemplateSpec,
  slots: Record<string, unknown>,
): Page {
  // Merge defaults with provided slots
  const props: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(templateSpec.slots)) {
    props[key] = slots[key] ?? def.default ?? '';
  }

  const resolvedLayers = templateSpec.layers.map(layer => resolveLayerProps(layer, props));

  return {
    id: `page-${Date.now()}`,
    layers: resolvedLayers,
  };
}

export function validateComponentSlots(
  spec: ComponentSpec,
  slots: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const [key, def] of Object.entries(spec.props)) {
    if (slots[key] === undefined && def.default === undefined) {
      errors.push(`Missing required prop: "${key}"`);
    }
  }

  return errors;
}

export function validateTemplateSlots(
  spec: TemplateSpec,
  slots: Record<string, unknown>,
): string[] {
  const errors: string[] = [];

  for (const [key, def] of Object.entries(spec.slots)) {
    if (def.required && slots[key] === undefined && def.default === undefined) {
      errors.push(`Missing required slot: "${key}"`);
    }
  }

  return errors;
}

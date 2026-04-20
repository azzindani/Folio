import type { DesignSpec, Layer } from './types';

// ── Template Types ───────────────────────────────────────────

export interface TemplateSlot {
  id: string;
  path: string;       // dot-notation path into DesignSpec, e.g. "layers[0].content.value"
  type: 'text' | 'image' | 'color' | 'number';
  hint?: string;      // human-readable label for the AI
  default?: unknown;  // placeholder value shown in template
}

export interface TemplateSpec {
  _protocol: 'template/v1';
  meta: DesignSpec['meta'];
  document: DesignSpec['document'];
  theme?: DesignSpec['theme'];
  layers?: Layer[];
  pages?: DesignSpec['pages'];
  slots: TemplateSlot[];
}

// ── Path Utilities ───────────────────────────────────────────

function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = parsePath(path);
  let cur: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (typeof cur !== 'object' || cur === null) return;
    cur = (cur as Record<string, unknown>)[p];
  }
  if (typeof cur === 'object' && cur !== null) {
    (cur as Record<string, unknown>)[parts[parts.length - 1]] = value;
  }
}

function getByPath(obj: unknown, path: string): unknown {
  const parts = parsePath(path);
  let cur = obj;
  for (const p of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
}

function parsePath(path: string): string[] {
  // Split "layers[0].content.value" → ["layers", "0", "content", "value"]
  return path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
}

// ── Slot Extraction ──────────────────────────────────────────

function extractLayerSlots(layer: Layer, prefix: string, slots: TemplateSlot[]): void {
  const l = layer as unknown as Record<string, unknown>;

  // Text content
  if (layer.type === 'text') {
    const content = l['content'] as Record<string, unknown> | undefined;
    if (content && 'value' in content) {
      slots.push({
        id: `${layer.id}_text`,
        path: `${prefix}.content.value`,
        type: 'text',
        hint: `Text content for layer "${layer.id}"`,
        default: content['value'],
      });
    }
  }

  // Image src
  if (layer.type === 'image') {
    slots.push({
      id: `${layer.id}_src`,
      path: `${prefix}.src`,
      type: 'image',
      hint: `Image source for layer "${layer.id}"`,
      default: l['src'],
    });
  }

  // Nested layers (group, auto_layout)
  if ((layer.type === 'group' || layer.type === 'auto_layout') && Array.isArray(l['layers'])) {
    const children = l['layers'] as Layer[];
    children.forEach((child, i) => {
      extractLayerSlots(child, `${prefix}.layers[${i}]`, slots);
    });
  }
}

function buildLayerPrefix(spec: DesignSpec, layerIndex: number, pageIndex?: number): string {
  if (pageIndex !== undefined) {
    return `pages[${pageIndex}].layers[${layerIndex}]`;
  }
  return `layers[${layerIndex}]`;
}

// ── Export ───────────────────────────────────────────────────

export function exportAsTemplate(spec: DesignSpec): TemplateSpec {
  const slots: TemplateSlot[] = [];

  if (spec.layers) {
    spec.layers.forEach((layer, i) => {
      extractLayerSlots(layer, buildLayerPrefix(spec, i), slots);
    });
  }

  if (spec.pages) {
    spec.pages.forEach((page, pi) => {
      (page.layers ?? []).forEach((layer, li) => {
        extractLayerSlots(layer, buildLayerPrefix(spec, li, pi), slots);
      });
    });
  }

  const template: TemplateSpec = {
    _protocol: 'template/v1',
    meta: { ...spec.meta },
    document: { ...spec.document },
    slots,
  };
  if (spec.theme) template.theme = spec.theme;
  if (spec.layers) template.layers = JSON.parse(JSON.stringify(spec.layers)) as Layer[];
  if (spec.pages) template.pages = JSON.parse(JSON.stringify(spec.pages)) as DesignSpec['pages'];

  return template;
}

// ── Inject ───────────────────────────────────────────────────

export function injectIntoTemplate(
  template: TemplateSpec,
  slotValues: Record<string, unknown>,
): DesignSpec {
  const spec: Record<string, unknown> = {
    _protocol: 'design/v1',
    meta: { ...template.meta },
    document: { ...template.document },
  };
  if (template.theme) spec['theme'] = template.theme;
  if (template.layers) spec['layers'] = JSON.parse(JSON.stringify(template.layers));
  if (template.pages) spec['pages'] = JSON.parse(JSON.stringify(template.pages));

  for (const slot of template.slots) {
    const value = slot.id in slotValues ? slotValues[slot.id] : slotValues[slot.path] ?? slot.default;
    if (value !== undefined) {
      setByPath(spec, slot.path, value);
    }
  }

  return spec as unknown as DesignSpec;
}

// ── List Slots ───────────────────────────────────────────────

export function listSlots(template: TemplateSpec): TemplateSlot[] {
  return template.slots;
}

export { getByPath, setByPath };

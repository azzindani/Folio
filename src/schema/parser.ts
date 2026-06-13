import yaml from 'js-yaml';
import type { DesignSpec, ThemeSpec, ComponentSpec, TemplateSpec } from './types';

export class ParseError extends Error {
  constructor(message: string, public line?: number, public column?: number) {
    super(message);
    this.name = 'ParseError';
  }
}

export function parseYAML<T = unknown>(source: string): T {
  try {
    return yaml.load(source) as T;
  } catch (err) {
    const yamlErr = err as { mark?: { line?: number; column?: number }; message?: string };
    throw new ParseError(
      yamlErr.message ?? 'YAML parse error',
      yamlErr.mark?.line,
      yamlErr.mark?.column,
    );
  }
}

export function serializeYAML(data: unknown): string {
  return yaml.dump(data, {
    indent: 2,
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
}

// A weak model (via patch_design) sometimes writes `layers` as a SINGLE object
// instead of a list — `layers: {type: rect, …}` not `layers: [ … ]`. Everything
// downstream calls `layers.map(...)`, so that one bad write crashed render /
// export / diagnose with "layers.map is not a function" (g_summit). Coerce a
// lone-object layers container back to a one-element array so a malformed design
// still renders its single layer instead of throwing.
function coerceLayersArray(spec: DesignSpec): DesignSpec {
  const fix = (c: { layers?: unknown }): void => {
    if (c.layers != null && !Array.isArray(c.layers) && typeof c.layers === 'object') {
      c.layers = [c.layers] as never;
    }
  };
  if (spec && typeof spec === 'object') {
    fix(spec as { layers?: unknown });
    if (Array.isArray(spec.pages)) for (const p of spec.pages) fix(p as { layers?: unknown });
  }
  return spec;
}

export function parseDesign(source: string): DesignSpec {
  return coerceLayersArray(parseYAML<DesignSpec>(source));
}

export function parseTheme(source: string): ThemeSpec {
  return parseYAML<ThemeSpec>(source);
}

export function parseComponent(source: string): ComponentSpec {
  return parseYAML<ComponentSpec>(source);
}

export function parseTemplate(source: string): TemplateSpec {
  return parseYAML<TemplateSpec>(source);
}

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

export function parseDesign(source: string): DesignSpec {
  return parseYAML<DesignSpec>(source);
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

import { load as parseYAML } from 'js-yaml';
import type { TemplateSpec } from '../schema/template';

// Vite bundles every .template.yaml under builtin/ as raw text at build time.
// `eager: true` because the picker dialog needs the metadata to render cards;
// the YAML strings are small (< 30 KB total across the starter pack).
const rawTemplates = import.meta.glob<string>('./builtin/*.template.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface BuiltinTemplate {
  id: string;
  spec: TemplateSpec;
}

let cache: BuiltinTemplate[] | null = null;

export function loadBuiltinTemplates(): BuiltinTemplate[] {
  if (cache) return cache;
  const out: BuiltinTemplate[] = [];
  for (const [path, raw] of Object.entries(rawTemplates)) {
    try {
      const spec = parseYAML(raw) as TemplateSpec;
      if (!spec || spec._protocol !== 'template/v1') continue;
      const id = path.replace(/^.*\//, '').replace(/\.template\.yaml$/, '');
      out.push({ id, spec });
    } catch {
      // Skip malformed templates rather than crashing the whole picker.
    }
  }
  out.sort((a, b) => a.spec.meta.name.localeCompare(b.spec.meta.name));
  cache = out;
  return out;
}

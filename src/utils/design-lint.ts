import type { Layer } from '../schema/types';

export interface LintIssue {
  layerId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
}

export function lintDesign(layers: Layer[]): LintIssue[] {
  const issues: LintIssue[] = [];

  for (const layer of layers) {
    const l = layer as unknown as Record<string, unknown>;
    const id = layer.id;

    // Missing dimensions
    if (l['width'] === undefined && layer.type !== 'line' && layer.type !== 'path') {
      issues.push({ layerId: id, severity: 'warning', message: 'Missing width' });
    }
    if (l['height'] === undefined && layer.type !== 'line' && layer.type !== 'path') {
      issues.push({ layerId: id, severity: 'warning', message: 'Missing height' });
    }

    // Near-zero opacity (invisible)
    const opacity = layer.opacity ?? 1;
    if (opacity < 0.05 && opacity > 0) {
      issues.push({ layerId: id, severity: 'info', message: `Opacity ${opacity} — nearly invisible` });
    }

    // Text with no content
    if (layer.type === 'text') {
      const content = (layer as unknown as { content?: { value?: string } }).content;
      if (!content?.value?.trim()) {
        issues.push({ layerId: id, severity: 'warning', message: 'Empty text layer' });
      }
    }

    // Image with no src
    if (layer.type === 'image') {
      const src = (layer as unknown as { src?: string }).src;
      if (!src) {
        issues.push({ layerId: id, severity: 'error', message: 'Image layer has no src' });
      }
    }

    // Overlapping z-index check (against all other layers)
    const zCount = layers.filter(other => other.id !== id && other.z === layer.z);
    if (zCount.length > 0) {
      issues.push({ layerId: id, severity: 'info', message: `Duplicate z-index ${layer.z} shared with ${zCount.length} layer(s)` });
    }

    // Negative dimensions
    const w = l['width'];
    const h = l['height'];
    if (typeof w === 'number' && w <= 0) {
      issues.push({ layerId: id, severity: 'error', message: `Invalid width: ${w}` });
    }
    if (typeof h === 'number' && h <= 0) {
      issues.push({ layerId: id, severity: 'error', message: `Invalid height: ${h}` });
    }

    // Rotation sanity
    if (typeof layer.rotation === 'number' && (layer.rotation < -360 || layer.rotation > 360)) {
      issues.push({ layerId: id, severity: 'info', message: `Rotation ${layer.rotation}° outside -360–360 range` });
    }

    // Recurse into group / auto_layout children
    if ('layers' in layer && Array.isArray((layer as unknown as { layers: Layer[] }).layers)) {
      issues.push(...lintDesign((layer as unknown as { layers: Layer[] }).layers));
    }
  }

  return issues;
}

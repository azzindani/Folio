import { describe, it, expect } from 'vitest';
import { lintDesign } from './design-lint';
import type { Layer } from '../schema/types';

function rect(id: string, extra: Record<string, unknown> = {}): Layer {
  return { id, type: 'rect', z: 1, width: 100, height: 100, ...extra } as unknown as Layer;
}

describe('lintDesign', () => {
  it('returns empty array for valid layers', () => {
    expect(lintDesign([rect('l1'), rect('l2', { z: 2 })])).toEqual([]);
  });

  it('warns on missing width (non-line/path)', () => {
    const layer = { id: 'l1', type: 'rect', z: 1, height: 100 } as unknown as Layer;
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.message === 'Missing width')).toBe(true);
  });

  it('warns on missing height (non-line/path)', () => {
    const layer = { id: 'l1', type: 'rect', z: 1, width: 100 } as unknown as Layer;
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.message === 'Missing height')).toBe(true);
  });

  it('does not warn on missing width for line layer', () => {
    const layer = { id: 'l1', type: 'line', z: 1 } as unknown as Layer;
    expect(lintDesign([layer]).filter(i => i.message === 'Missing width')).toHaveLength(0);
  });

  it('does not warn on missing width for path layer', () => {
    const layer = { id: 'l1', type: 'path', z: 1 } as unknown as Layer;
    expect(lintDesign([layer]).filter(i => i.message === 'Missing width')).toHaveLength(0);
  });

  it('reports near-zero opacity as info', () => {
    const layer = rect('l1', { opacity: 0.02 });
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.severity === 'info' && i.message.includes('nearly invisible'))).toBe(true);
  });

  it('does not report opacity 0 (fully hidden, not near-zero issue)', () => {
    const layer = rect('l1', { opacity: 0 });
    const issues = lintDesign([layer]);
    expect(issues.filter(i => i.message.includes('nearly invisible'))).toHaveLength(0);
  });

  it('warns on empty text content', () => {
    const layer = { id: 'l1', type: 'text', z: 1, width: 100, height: 30, content: { value: '  ' } } as unknown as Layer;
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.message === 'Empty text layer')).toBe(true);
  });

  it('does not warn on non-empty text content', () => {
    const layer = { id: 'l1', type: 'text', z: 1, width: 100, height: 30, content: { value: 'Hello' } } as unknown as Layer;
    expect(lintDesign([layer]).filter(i => i.message === 'Empty text layer')).toHaveLength(0);
  });

  it('errors on image with no src', () => {
    const layer = { id: 'l1', type: 'image', z: 1, width: 100, height: 100 } as unknown as Layer;
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.severity === 'error' && i.message === 'Image layer has no src')).toBe(true);
  });

  it('does not error on image with valid src', () => {
    const layer = { id: 'l1', type: 'image', z: 1, width: 100, height: 100, src: '/img.png' } as unknown as Layer;
    expect(lintDesign([layer]).filter(i => i.message === 'Image layer has no src')).toHaveLength(0);
  });

  it('reports duplicate z-index as info', () => {
    const layers = [rect('l1', { z: 5 }), rect('l2', { z: 5 })];
    const issues = lintDesign(layers);
    expect(issues.some(i => i.message.includes('Duplicate z-index'))).toBe(true);
  });

  it('errors on non-positive width', () => {
    const layer = rect('l1', { width: -10 });
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.severity === 'error' && i.message.includes('Invalid width'))).toBe(true);
  });

  it('errors on zero height', () => {
    const layer = rect('l1', { height: 0 });
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.message.includes('Invalid height'))).toBe(true);
  });

  it('reports out-of-range rotation as info', () => {
    const layer = rect('l1', { rotation: 400 });
    const issues = lintDesign([layer]);
    expect(issues.some(i => i.message.includes('Rotation') && i.severity === 'info')).toBe(true);
  });

  it('does not report rotation of 360', () => {
    const layer = rect('l1', { rotation: 360 });
    expect(lintDesign([layer]).filter(i => i.message.includes('Rotation'))).toHaveLength(0);
  });

  it('recurses into group children', () => {
    const child = { id: 'c1', type: 'text', z: 1, width: 100, height: 30, content: { value: '' } } as unknown as Layer;
    const group = { id: 'g1', type: 'group', z: 1, width: 200, height: 200, layers: [child] } as unknown as Layer;
    const issues = lintDesign([group]);
    expect(issues.some(i => i.layerId === 'c1')).toBe(true);
  });

  it('returns empty for empty input', () => {
    expect(lintDesign([])).toEqual([]);
  });
});

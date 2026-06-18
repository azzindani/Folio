import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { batchCreate } from './engine-export-tools';
import { writeYAML, readYAML } from './engine/utils';
import type { DesignSpec } from '../schema/types';

// batch_create used to ignore template_id and call createDesign with no size →
// every variant came out a blank 1080×1080 default square, losing the source's
// custom dimensions, theme, and layout (the "can't generate a proper poster with
// custom dimension" report). It must clone the named template/design instead.

function project(): { dir: string; projectPath: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-'));
  const projectPath = path.join(dir, 'proj');
  fs.mkdirSync(path.join(projectPath, 'designs'), { recursive: true });
  const source = {
    _protocol: 'design/v1', _mode: 'complete',
    meta: { id: 'src', name: 'src', type: 'poster', created: '2026-06-18', modified: '2026-06-18', generator: 'mcp' },
    document: { width: 1080, height: 2000, unit: 'px', dpi: 96 }, // CUSTOM, non-square dims
    theme: { ref: 'bold-poster' },
    layers: [
      { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 2000, fill: { type: 'solid', color: '#0A0A0A' } },
      { id: 's_kick', type: 'text', z: 1, x: 80, y: 80, width: 900, height: 60, content: { type: 'plain', value: 'ORIGINAL KICKER' }, style: { font_size: 28 } },
      { id: 's_title', type: 'text', z: 2, x: 80, y: 160, width: 900, height: 200, content: { type: 'plain', value: 'Original Title' }, style: { font_size: 90 } },
      { id: 's_sub', type: 'text', z: 3, x: 80, y: 400, width: 900, height: 120, content: { type: 'plain', value: 'Original subtitle' }, style: { font_size: 32 } },
    ],
  } as unknown as DesignSpec;
  writeYAML(path.join(projectPath, 'designs/source.design.yaml'), source);
  return { dir, projectPath };
}

describe('batch_create clones the template instead of making blank squares', () => {
  it('every variant keeps the source 1080×2000 dims + theme (not a 1080×1080 square)', () => {
    const { dir, projectPath } = project();
    try {
      const res = batchCreate({
        project_path: projectPath, template_id: 'source',
        slots_array: [
          { name: 'v1', title: 'Variant One', kicker: 'AI', subtitle: 'first' },
          { name: 'v2', title: 'Variant Two', kicker: 'AI', subtitle: 'second' },
        ],
      });
      expect((res as { success?: boolean }).success).not.toBe(false);
      const created = (res as unknown as { created: { path: string }[] }).created;
      expect(created).toHaveLength(2);
      for (const c of created) {
        const spec = readYAML<DesignSpec>(c.path);
        expect([spec.document.width, spec.document.height]).toEqual([1080, 2000]); // NOT a square
        expect(spec.theme).toEqual({ ref: 'bold-poster' });                       // theme preserved
        expect(spec.layers?.length).toBe(4);                                      // layout preserved
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fills the title/kicker/subtitle slots via friendly-key matching', () => {
    const { dir, projectPath } = project();
    try {
      const res = batchCreate({
        project_path: projectPath, template_id: 'source',
        slots_array: [{ name: 'filled', title: 'Brand New Title', kicker: 'NEW KICKER', subtitle: 'new sub' }],
      });
      const c = (res as unknown as { created: { path: string }[] }).created[0];
      const spec = readYAML<DesignSpec>(c.path);
      const text = (id: string): string => {
        const l = spec.layers?.find(x => x.id === id) as unknown as { content?: { value?: string } } | undefined;
        return l?.content?.value ?? '';
      };
      expect(text('s_title')).toBe('Brand New Title');
      expect(text('s_kick')).toBe('NEW KICKER');
      expect(text('s_sub')).toBe('new sub');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('errors clearly when the template_id resolves to nothing', () => {
    const { dir, projectPath } = project();
    try {
      const res = batchCreate({ project_path: projectPath, template_id: 'does-not-exist', slots_array: [{ title: 'x' }] });
      expect((res as { success?: boolean }).success).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

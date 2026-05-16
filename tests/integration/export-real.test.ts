// Real end-to-end export through playwright + chromium.
// Skipped unless FOLIO_EXPORT_E2E=1 — slow (~5s per format) and requires the
// chromium binary to be present.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync, statSync, rmSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createProject, createDesign, exportDesign } from '../../src/mcp/engine';

const enabled = process.env['FOLIO_EXPORT_E2E'] === '1';

describe.skipIf(!enabled)('MCP exportDesign — real chromium', () => {
  it('writes a non-trivial file for each supported format', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'folio-export-real-'));
    try {
      createProject({ name: 'E2E', path: join(dir, 'proj') });
      createDesign({ project_path: join(dir, 'proj'), name: 'E2E Design' });
      const designPath = join(dir, 'proj', 'designs/e2e-design.design.yaml');

      for (const format of ['svg', 'html', 'png', 'pdf'] as const) {
        const r = await exportDesign({ design_path: designPath, format });
        expect(r.success, `${format} export failed: ${r.error}`).toBe(true);
        const out = r['output_path'] as string;
        expect(existsSync(out), `${format} file should exist at ${out}`).toBe(true);
        expect(statSync(out).size).toBeGreaterThan(100);
        if (format === 'png') {
          const buf = readFileSync(out);
          expect(buf.slice(0, 4).toString('hex')).toBe('89504e47'); // PNG signature
        }
        if (format === 'pdf') {
          const buf = readFileSync(out);
          expect(buf.slice(0, 4).toString()).toBe('%PDF');
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

// Report-lab harness: export a .design.yaml report → HTML via the real assembler.
// Run: npx vitest run tools/report-lab/export-demo.test.ts
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { assembleReportHTML } from '../../src/export/html-assembler';
import type { DesignSpec } from '../../src/schema/types';
import type { LoadedDataset } from '../../src/report/data-loader';

const SRC = process.env.REPORT_SRC || 'examples/interactive-report-demo.design.yaml';
const OUT = process.env.REPORT_OUT || 'tools/report-lab/out/demo.report.html';
const THEME = (process.env.REPORT_THEME as 'light' | 'dark') || 'dark';

function buildDatasets(spec: DesignSpec): Map<string, LoadedDataset> {
  const m = new Map<string, LoadedDataset>();
  const sources = (spec.report?.data?.sources ?? []) as { id: string; rows?: Record<string, unknown>[] }[];
  for (const s of sources) if (s.rows) m.set(s.id, { id: s.id, rows: s.rows });
  return m;
}

// Screenshot/eyeball harness — only runs when REPORT_LAB is set (writes artifacts).
describe.skipIf(!process.env.REPORT_LAB)('report-lab export', () => {
  it('exports a report design to HTML', () => {
    const raw = fs.readFileSync(path.resolve(SRC), 'utf-8');
    const spec = yaml.load(raw) as DesignSpec;
    const datasets = buildDatasets(spec);
    const html = assembleReportHTML(spec, datasets, { theme: THEME });
    fs.mkdirSync(path.dirname(path.resolve(OUT)), { recursive: true });
    fs.writeFileSync(path.resolve(OUT), html, 'utf-8');
    // eslint-disable-next-line no-console
    console.log(`WROTE ${OUT} (${html.length} bytes), datasets=${[...datasets.keys()].join(',')}`);
    expect(html).toContain('<!DOCTYPE html>');
  });
});

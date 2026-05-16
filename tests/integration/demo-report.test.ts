import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { assembleReportHTML } from '../../src/export/html-assembler';
import type { DesignSpec } from '../../src/schema/types';

describe('interactive-report-demo fixture', () => {
  it('assembles into a complete interactive HTML report', () => {
    const ymlText = readFileSync('examples/interactive-report-demo.design.yaml', 'utf8');
    const spec = yaml.load(ymlText) as DesignSpec & {
      report?: { data?: { sources?: { id: string; rows?: Record<string, unknown>[] }[] } };
    };

    const datasets = new Map<string, { id: string; rows: Record<string, unknown>[] }>();
    for (const src of spec.report?.data?.sources ?? []) {
      if (src.rows) datasets.set(src.id, { id: src.id, rows: src.rows });
    }

    const html = assembleReportHTML(spec, datasets, { theme: 'dark' });

    expect(html).toContain('chart.umd.min.js');
    expect(html).toContain('fonts.googleapis.com');
    expect(html).toContain('class="ic-kpi"');
    expect(html.match(/<canvas id="chart-/g)).toHaveLength(2);
    expect(html.match(/__folioTables\["/g)).toHaveLength(1);
    expect(html).toContain('class="ic-table"');
  });
});

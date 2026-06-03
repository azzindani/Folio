// End-to-end test of the REPORT MCP TOOLS (not the assembler directly):
// generate_report(flow) → bind_data → add_layers(span) → export_report.
// Proves the tool surface an LLM/user actually calls can produce a flow report.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateReport, bindData, addLayers, exportReport } from '../../src/mcp/engine';
import type { Layer } from '../../src/schema/types';

function val(res: unknown): Record<string, unknown> {
  const r = res as { ok?: boolean; data?: Record<string, unknown>; error?: unknown } & Record<string, unknown>;
  if (r.ok === false) throw new Error('tool failed: ' + JSON.stringify(r.error ?? r));
  return (r.data ?? r) as Record<string, unknown>;
}

describe('report MCP tools — flow e2e', () => {
  it('builds and exports a flow report via the tool chain', () => {
    const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-rep-'));

    // 1) generate_report (flow + editorial options + inline data)
    const gen = val(generateReport({
      project_path: proj,
      name: 'MCP Flow Test',
      layout: 'flow',
      accent: '#f5c842',
      font_heading: 'Playfair Display',
      font_body: 'Inter',
      max_width: 1200,
      pages: [{ id: 'overview', label: 'Overview' }],
      data_sources: [{
        id: 'rev', type: 'inline',
        rows: [
          { month: 'Jan', total: 142000 }, { month: 'Feb', total: 156000 },
          { month: 'Mar', total: 178000 }, { month: 'Apr', total: 165000 },
        ],
      }],
    }));
    const designPath = gen.design_path as string;
    expect(fs.existsSync(designPath)).toBe(true);

    // 2) bind_data (a second dataset added after scaffold)
    val(bindData({
      design_path: designPath,
      datasets: [{ id: 'rows', rows: [
        { name: 'Alpha', region: 'NA', value: 142000, yoy: 18.5 },
        { name: 'Beta', region: 'EU', value: 98000, yoy: -2.1 },
        { name: 'Gamma', region: 'APAC', value: 256000, yoy: 24.7 },
      ] }],
    }));

    // 3) add_layers — flow layers positioned by span (NO width/height)
    const layers = [
      { id: 'hero', type: 'rich_text', span: 12, format: 'markdown',
        font_family: 'Playfair Display', font_size: 42, content: '**Quarterly Review**' },
      { id: 'k1', type: 'kpi_card', span: 4, label: 'Revenue', value: 396000, format: 'currency', currency: 'USD', delta: 12.4 },
      { id: 'k2', type: 'kpi_card', span: 4, label: 'Accounts', value: 3, format: 'number', delta: 50 },
      { id: 'k3', type: 'kpi_card', span: 4, label: 'Avg YoY', value: 13.7, format: 'percent', delta: 3.1 },
      { id: 'c1', type: 'interactive_chart', span: 12, height: 320, chart_type: 'line',
        data_ref: 'rev', x_field: 'month', y_field: 'total', title: 'Revenue Trend' },
      { id: 't1', type: 'interactive_table', span: 12, data_ref: 'rows', filterable: true, exportable: true,
        columns: [
          { field: 'name', title: 'Account', sortable: true },
          { field: 'region', title: 'Region', formatter: 'badge' },
          { field: 'value', title: 'Value', formatter: 'currency', align: 'right', sortable: true },
          { field: 'yoy', title: 'YoY', formatter: 'delta', align: 'right', sortable: true },
        ] },
    ] as unknown as Layer[];
    const added = val(addLayers({ design_path: designPath, page_id: 'overview', layers }));
    expect(added.added).toBe(6);

    // 4) export_report → HTML
    const exp = val(exportReport({ design_path: designPath, theme: 'dark' }));
    const out = exp.output_path as string;
    const html = fs.readFileSync(out, 'utf-8');

    // Assertions: flow markers, accent, fonts, widgets, Chart.js, no fixed canvas
    expect(html).toContain('layout-flow');
    expect(html).toContain('folio-flow-grid');
    expect(html).toContain('grid-column:span');
    expect(html).toContain('#f5c842');
    expect(html).toContain('Playfair+Display');
    expect(html).toContain('Chart.js');
    expect(html).toContain('ic-kpi');
    expect(html).toContain('__folioTables');
    expect(html).not.toContain('class="folio-page-stage"'); // not the fixed-canvas DOM path

    // copy to the lab out dir so it can be screenshotted
    fs.mkdirSync('tools/report-lab/out', { recursive: true });
    fs.copyFileSync(out, 'tools/report-lab/out/mcp-e2e.report.html');
    // eslint-disable-next-line no-console
    console.log('MCP_E2E_OUT tools/report-lab/out/mcp-e2e.report.html', html.length, 'bytes');
  });
});

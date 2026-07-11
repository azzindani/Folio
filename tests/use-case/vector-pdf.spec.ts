/**
 * WP-5.2 — editor-button vector PDF. Exporting a text design from the editor
 * fetches the bundled TTFs from /fonts and embeds them, so the PDF carries real
 * selectable glyphs (FontFile2), not a flat raster image.
 */
import { test, expect } from '@playwright/test';
import { loadYAMLIntoEditor, waitForFolioReady } from './_helpers';

const YAML = `
_protocol: design/v1
meta: { id: vpdf, name: Vector PDF, type: poster }
document: { width: 800, height: 600, unit: px }
layers:
  - { id: bg, type: rect, z: 0, x: 0, y: 0, width: 800, height: 600, fill: "#0A0A0A" }
  - { id: h, type: text, z: 1, x: 60, y: 200, width: 680,
      content: { type: plain, value: "Selectable Vector Text" },
      style: { font_size: 64, color: "#FFFFFF", font_family: "Space Grotesk", font_weight: 700 } }
`;

test('editor PDF export embeds real fonts (vector, not raster)', async ({ page }) => {
  await page.goto('/');
  await waitForFolioReady(page);
  expect((await loadYAMLIntoEditor(page, YAML)).ok).toBeTruthy();

  const pdfBytes: Uint8Array = await page.evaluate(async () => {
    const f = (window as unknown as { __folio: { getYAML(): string } }).__folio;
    // Runtime paths resolved by the Vite dev server (not by tsc).
    // @ts-expect-error browser-only module URL
    const { parseDesign } = await import('/src/schema/parser.ts');
    // @ts-expect-error browser-only module URL
    const { exportToPDF } = await import('/src/export/exporter.ts');
    const spec = parseDesign(f.getYAML());
    const blob = await exportToPDF(spec, { format: 'pdf', scale: 2 });
    return Array.from(new Uint8Array(await blob.arrayBuffer())) as unknown as Uint8Array;
  });

  const txt = Buffer.from(pdfBytes).toString('latin1');
  expect(txt.startsWith('%PDF')).toBe(true);
  // FontFile2 = an embedded TrueType font program → vector text path succeeded.
  expect(txt).toContain('FontFile2');
});

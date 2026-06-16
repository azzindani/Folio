import { test, expect } from '@playwright/test';

test.describe('Editor — vector PDF export', () => {
  test.setTimeout(60_000);

  test('Download PDF produces a vector PDF with embedded selectable fonts', async ({ page }) => {
    // Force the anchor-download path: headless Chromium exposes showSaveFilePicker,
    // which would otherwise capture the save and never emit a download event.
    await page.addInitScript(() => {
      try { delete (window as unknown as Record<string, unknown>)['showSaveFilePicker']; } catch { /* noop */ }
    });
    await page.goto('/');
    await page.waitForSelector('.canvas-area svg', { timeout: 15_000 });
    // Give web fonts a beat to settle before exporting.
    await page.waitForTimeout(1_000);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      (async () => {
        await page.locator('[data-action="export"]').click();
        await page.waitForSelector('[data-format="pdf"]', { timeout: 5_000 });
        await page.locator('[data-format="pdf"]').first().click();
      })(),
    ]);

    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const c of stream) chunks.push(c as Buffer);
    const buf = Buffer.concat(chunks);

    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const body = buf.toString('latin1');
    // Embedded TrueType font program → real vector glyphs (selectable + crisp at
    // any zoom). jsPDF embeds TTFs as Type0/CID composite fonts.
    expect(body).toContain('FontFile2');
    expect(body).toContain('Type0');
  });
});

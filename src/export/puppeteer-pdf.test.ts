import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { exportToPuppeteerPDF } from './puppeteer-pdf';
import type { PuppeteerPDFOptions } from './puppeteer-pdf';

// Puppeteer is not installed; tests cover fallback and mocked success paths.

describe('exportToPuppeteerPDF — fallback (not installed)', () => {
  it('returns ok:false with descriptive error when puppeteer not installed', async () => {
    const result = await exportToPuppeteerPDF('/tmp/dummy.html', '/tmp/dummy.pdf');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.outputPath).toBe('/tmp/dummy.pdf');
  });

  it('returns the output path in result regardless of success', async () => {
    const result = await exportToPuppeteerPDF('/tmp/x.html', '/tmp/x.pdf');
    expect(result.outputPath).toBe('/tmp/x.pdf');
  });

  it('result has no bytes on failure', async () => {
    const result = await exportToPuppeteerPDF('/tmp/a.html', '/tmp/a.pdf');
    expect(result.bytes).toBeUndefined();
  });
});

function makeFakePuppeteer(overrides: {
  pdfResult?: Uint8Array;
  launchThrows?: boolean;
  contentThrows?: boolean;
  pdfThrows?: boolean;
} = {}) {
  return () => ({
    launch: async () => {
      if (overrides.launchThrows) throw new Error('launch failed');
      return {
        newPage: async () => ({
          setContent: async () => {
            if (overrides.contentThrows) throw new Error('content failed');
          },
          setViewport: async () => undefined,
          pdf: async () => {
            if (overrides.pdfThrows) throw new Error('pdf failed');
            return overrides.pdfResult ?? new Uint8Array([1, 2, 3]);
          },
        }),
        close: async () => undefined,
      };
    },
  });
}

describe('exportToPuppeteerPDF — mocked success path', () => {
  let tmpDir: string;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'folio-pdf-test-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('returns ok:true and bytes on success', async () => {
    const htmlPath = path.join(tmpDir, 'test.html');
    fs.writeFileSync(htmlPath, '<html><body>test</body></html>');
    const outPath = path.join(tmpDir, 'out.pdf');
    const result = await exportToPuppeteerPDF(htmlPath, outPath, {}, makeFakePuppeteer());
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(3);
    expect(result.outputPath).toBe(outPath);
  });

  it('respects width/height options', async () => {
    const htmlPath = path.join(tmpDir, 'w.html');
    fs.writeFileSync(htmlPath, '<html></html>');
    const outPath = path.join(tmpDir, 'w.pdf');
    const opts: PuppeteerPDFOptions = { width: 800, height: 600, scale: 1 };
    const result = await exportToPuppeteerPDF(htmlPath, outPath, opts, makeFakePuppeteer());
    expect(result.ok).toBe(true);
  });

  it('returns ok:false when launch throws', async () => {
    const htmlPath = path.join(tmpDir, 'l.html');
    fs.writeFileSync(htmlPath, '<html></html>');
    const result = await exportToPuppeteerPDF(htmlPath, path.join(tmpDir, 'l.pdf'), {}, makeFakePuppeteer({ launchThrows: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('launch failed');
  });

  it('returns ok:false when pdf() throws', async () => {
    const htmlPath = path.join(tmpDir, 'p.html');
    fs.writeFileSync(htmlPath, '<html></html>');
    const result = await exportToPuppeteerPDF(htmlPath, path.join(tmpDir, 'p.pdf'), {}, makeFakePuppeteer({ pdfThrows: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('pdf failed');
  });

  it('handles non-Uint8Array pdf return (bytes = 0)', async () => {
    const htmlPath = path.join(tmpDir, 'b.html');
    fs.writeFileSync(htmlPath, '<html></html>');
    const result = await exportToPuppeteerPDF(htmlPath, path.join(tmpDir, 'b.pdf'), {},
      makeFakePuppeteer({ pdfResult: 'not-uint8array' as unknown as Uint8Array }));
    expect(result.ok).toBe(true);
    expect(result.bytes).toBe(0);
  });
});

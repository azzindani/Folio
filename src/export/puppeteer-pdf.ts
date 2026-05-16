export interface PuppeteerPDFOptions {
  /** Page width in px (default: design document width) */
  width?: number;
  /** Page height in px (default: design document height) */
  height?: number;
  /** Device scale factor for hi-dpi output (default: 2) */
  scale?: number;
  /** Print background colours/images (default: true) */
  printBackground?: boolean;
  /** Timeout in ms for page load (default: 30000) */
  timeout?: number;
}

export interface PuppeteerPDFResult {
  ok: boolean;
  outputPath: string;
  bytes?: number;
  error?: string;
}

/**
 * Exports an HTML file to a high-fidelity PDF using Puppeteer.
 * Puppeteer is a peer dependency — install `puppeteer` or `puppeteer-core` separately.
 * Falls back gracefully when Puppeteer is unavailable.
 */
export async function exportToPuppeteerPDF(
  htmlPath: string,
  outputPath: string,
  opts: PuppeteerPDFOptions = {},
  _factory?: () => PuppeteerModule,
): Promise<PuppeteerPDFResult> {
  let puppeteer: PuppeteerModule;
  try {
    puppeteer = _factory ? _factory() : importPuppeteer();
  } catch {
    return {
      ok: false,
      outputPath,
      error: 'Puppeteer not installed. Run: npm install puppeteer',
    };
  }

  let browser: BrowserLike | null = null;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const page = await browser.newPage();

    const { readFileSync } = await import('fs');
    const html = readFileSync(htmlPath, 'utf-8');

    await page.setContent(html, {
      waitUntil: 'networkidle0',
      timeout: opts.timeout ?? 30000,
    });

    const w = opts.width ?? 1080;
    const h = opts.height ?? 1080;
    await page.setViewport({ width: w, height: h, deviceScaleFactor: opts.scale ?? 2 });

    const pdfBuffer = await page.pdf({
      path: outputPath,
      width: `${w}px`,
      height: `${h}px`,
      printBackground: opts.printBackground ?? true,
    });

    const bytes = pdfBuffer instanceof Uint8Array ? pdfBuffer.length : 0;
    return { ok: true, outputPath, bytes };
  } catch (err) {
    return { ok: false, outputPath, error: (err as Error).message };
  } finally {
    await browser?.close();
  }
}

// ── Type stubs so we don't hard-depend on puppeteer types ─
interface BrowserLike {
  newPage(): Promise<PageLike>;
  close(): Promise<void>;
}
interface PageLike {
  setContent(html: string, opts?: unknown): Promise<void>;
  setViewport(opts: unknown): Promise<void>;
  pdf(opts: unknown): Promise<Uint8Array>;
}
interface PuppeteerModule {
  launch(opts?: unknown): Promise<BrowserLike>;
}

function importPuppeteer(): PuppeteerModule {
  // Use require so TS does not attempt to resolve optional peer dep at compile time
  const req = typeof require !== 'undefined' ? require : null;
  if (!req) throw new Error('require not available');
  try { return req('puppeteer') as PuppeteerModule; }
  catch { return req('puppeteer-core') as PuppeteerModule; }
}

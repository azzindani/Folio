// MCP-side export: writes design files to disk in svg/html/png/pdf.
// SVG/HTML use jsdom + the existing renderer; PNG/PDF use puppeteer.

import * as fs from 'fs';
import * as path from 'path';
import { JSDOM } from 'jsdom';
import { exportToSVG, exportToHTML } from '../../export/exporter';
import type { DesignSpec } from '../../schema/types';

export type ExportFormat = 'svg' | 'html' | 'png' | 'pdf';

export interface ExportArgs {
  spec: DesignSpec;
  format: ExportFormat;
  outPath: string;
  scale: number;
}

export interface ExportOutcome {
  bytes: number;
  format: ExportFormat;
}

// Single entry point used by engine.exportDesign.
export async function runExport(args: ExportArgs): Promise<ExportOutcome> {
  switch (args.format) {
    case 'svg':  return writeSVG(args);
    case 'html': return writeHTML(args);
    case 'png':  return writePNG(args);
    case 'pdf':  return writePDF(args);
  }
}

// Renderable strings — exported for puppeteer reuse and testability.
export function buildSVGString(spec: DesignSpec): string {
  ensureDOMGlobals();
  return exportToSVG(spec, { format: 'svg' });
}

export function buildHTMLString(spec: DesignSpec): string {
  ensureDOMGlobals();
  return exportToHTML(spec, { format: 'html' });
}

// ── Format-specific writers ──────────────────────────────────

function writeSVG(args: ExportArgs): ExportOutcome {
  const svg = buildSVGString(args.spec);
  ensureDir(args.outPath);
  fs.writeFileSync(args.outPath, svg, 'utf8');
  return { bytes: Buffer.byteLength(svg, 'utf8'), format: 'svg' };
}

function writeHTML(args: ExportArgs): ExportOutcome {
  const html = buildHTMLString(args.spec);
  ensureDir(args.outPath);
  fs.writeFileSync(args.outPath, html, 'utf8');
  return { bytes: Buffer.byteLength(html, 'utf8'), format: 'html' };
}

async function writePNG(args: ExportArgs): Promise<ExportOutcome> {
  const html = buildHTMLString(args.spec);
  const buf = await rasterize({ html, format: 'png', spec: args.spec, scale: args.scale });
  ensureDir(args.outPath);
  fs.writeFileSync(args.outPath, buf);
  return { bytes: buf.length, format: 'png' };
}

async function writePDF(args: ExportArgs): Promise<ExportOutcome> {
  const html = buildHTMLString(args.spec);
  const buf = await rasterize({ html, format: 'pdf', spec: args.spec, scale: args.scale });
  ensureDir(args.outPath);
  fs.writeFileSync(args.outPath, buf);
  return { bytes: buf.length, format: 'pdf' };
}

// ── Helpers ──────────────────────────────────────────────────

function ensureDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

let domReady = false;
function ensureDOMGlobals(): void {
  if (domReady) return;
  if (typeof globalThis.document !== 'undefined' && typeof globalThis.window !== 'undefined') {
    domReady = true;
    return;
  }
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
  const g = globalThis as unknown as Record<string, unknown>;
  g['window'] = dom.window;
  g['document'] = dom.window.document;
  g['XMLSerializer'] = dom.window.XMLSerializer;
  g['Image'] = dom.window.Image;
  g['HTMLElement'] = dom.window.HTMLElement;
  g['Element'] = dom.window.Element;
  g['Node'] = dom.window.Node;
  domReady = true;
}

interface RasterizeArgs {
  html: string;
  format: 'png' | 'pdf';
  spec: DesignSpec;
  scale: number;
}

// Puppeteer is loaded lazily so tests can substitute a fake rasterizer
// and avoid the chromium spin-up cost.
let customRasterizer: ((args: RasterizeArgs) => Promise<Buffer>) | null = null;
export function setRasterizer(fn: ((args: RasterizeArgs) => Promise<Buffer>) | null): void {
  customRasterizer = fn;
}

async function rasterize(args: RasterizeArgs): Promise<Buffer> {
  if (customRasterizer) return customRasterizer(args);
  return defaultRasterize(args);
}

async function defaultRasterize(args: RasterizeArgs): Promise<Buffer> {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true });
  try {
    const { width, height } = args.spec.document;
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: args.scale,
    });
    await page.setContent(args.html, { waitUntil: 'networkidle' });
    if (args.format === 'png') {
      return await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width, height } });
    }
    return await page.pdf({ width: `${width}px`, height: `${height}px`, printBackground: true, pageRanges: '1' });
  } finally {
    await browser.close();
  }
}

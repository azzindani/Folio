/**
 * Helpers for use-case scenarios: console capture, screenshot path,
 * note-collector shape.
 */
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Note {
  step: string;
  severity: 'error' | 'warn' | 'info';
  msg: string;
}

export interface ConsoleCapture {
  errors: string[];
  warnings: string[];
}

const IGNORE_PATTERNS: RegExp[] = [
  /Could not create web worker/i,
  /MonacoEnvironment\.getWorkerUrl/i,
];

function shouldIgnore(msg: string): boolean {
  return IGNORE_PATTERNS.some(rx => rx.test(msg));
}

export function attachConsoleCapture(page: Page): ConsoleCapture {
  const cap: ConsoleCapture = { errors: [], warnings: [] };
  page.on('pageerror', err => cap.errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => {
    const text = msg.text();
    if (shouldIgnore(text)) return;
    if (msg.type() === 'error') cap.errors.push(text);
    if (msg.type() === 'warning') cap.warnings.push(text);
  });
  return cap;
}

export function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

export function writeJSON(p: string, data: unknown): void {
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
}

export function safeName(s: string): string {
  return s.replace(/[^a-z0-9-]/gi, '-').slice(0, 60);
}

export const REPORT_ROOT = path.join(process.cwd(), 'tools', 'use-case-reports');

export async function waitForFolioReady(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForFunction(
    () => typeof (window as unknown as { __folio?: unknown }).__folio !== 'undefined',
    null,
    { timeout: timeoutMs }
  );
  await page.waitForSelector('.canvas-area svg', { timeout: timeoutMs });
}

export async function loadYAMLIntoEditor(page: Page, yaml: string): Promise<{ ok: boolean; error?: string }> {
  return await page.evaluate(async (src: string) => {
    try {
      const folio = (window as unknown as { __folio: { loadFromYAML(s: string): void } }).__folio;
      folio.loadFromYAML(src);
      // Yield to renderer.
      await new Promise(r => setTimeout(r, 60));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, yaml);
}

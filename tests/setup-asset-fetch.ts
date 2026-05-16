/**
 * Fetch polyfill for vitest. Vite's `?url` import returns a path like
 * `/src/templates/catalog-index.json` — a relative URL the test
 * environment's fetch can't resolve. This setup intercepts such URLs
 * and serves the file directly from disk.
 *
 * Only relative URLs (starting with `/`, `./`, or `../`) are handled
 * here. Real http(s) URLs pass through to whatever fetch already
 * exists (or fail as usual if undefined).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

type FetchInput = string | URL | Request;

const originalFetch = globalThis.fetch;

function isRelativePath(s: string): boolean {
  return s.startsWith('/') || s.startsWith('./') || s.startsWith('../');
}

function toFileSystemPath(urlPath: string): string {
  // Strip leading slash so resolve() treats it as project-relative.
  const cleaned = urlPath.replace(/^\//, '');
  return resolve(process.cwd(), cleaned);
}

globalThis.fetch = (async (input: FetchInput, init?: RequestInit): Promise<Response> => {
  let url: string;
  if (typeof input === 'string') url = input;
  else if (input instanceof URL) url = input.toString();
  else url = input.url;

  if (isRelativePath(url) && !url.startsWith('http')) {
    const filePath = toFileSystemPath(url);
    const body = readFileSync(filePath);
    return new Response(body);
  }

  if (originalFetch) return originalFetch(input as Parameters<typeof fetch>[0], init);
  throw new Error(`fetch polyfill: cannot resolve URL "${url}" and no upstream fetch is available`);
}) as typeof fetch;

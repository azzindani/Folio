/**
 * Commissioning harness — shared plumbing for "does the real engine actually
 * produce a correct artifact" checks.
 *
 * The distinction from the rest of the suite: unit tests assert on internals,
 * e2e tests assert that an export HAPPENED. These assert on what the user
 * receives — the pixels in the file. A PDF that starts with %PDF- and embeds a
 * font passes the old bar while missing every logo on the page.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import type { Page } from '@playwright/test';

// Playwright loads these as ES modules, where __dirname does not exist; the
// runner's cwd is the repo root.
export const REPO_ROOT = path.resolve(process.cwd());
export const FIXTURE_PROJECTS = path.join(REPO_ROOT, 'tests/commissioning/fixtures/projects');
export const FIXTURE_PROJECT = path.join(FIXTURE_PROJECTS, 'commissioning');
export const LIBRARY_DIR = path.join(FIXTURE_PROJECTS, '.library/assets');

export function designPath(name: string): string {
  return path.join(FIXTURE_PROJECT, 'designs', `${name}.design.yaml`);
}

/** A box on the page, expressed as fractions of the page — so one measurement
 *  works against any export format, scale or raster size. */
export interface Region {
  id: string;
  kind: 'image' | 'text';
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface InkStat {
  id: string;
  kind: string;
  /** Fraction of pixels differing from the artifact's background colour. */
  inkRatio: number;
  /** Distinct quantised colours seen. 1 ⇒ a flat, empty region. */
  colours: number;
  /** The region's dominant non-background colour as #rrggbb ('' if none) —
   *  enough to tell WHICH file won a lookup, not just that something painted. */
  dominant: string;
}

// ── server engine ────────────────────────────────────────────────────────────

export interface ServerExport {
  ok: boolean;
  files: string[];
  notes: string[];
  error?: string;
}

/**
 * Export through the REAL MCP engine, in a child process, exactly as the
 * deployed server runs it (bun executing TypeScript from src — no build step).
 */
export function serverExport(
  design: string, format: string, outPath: string,
  /** Project the design's relative srcs resolve against. Defaults to the main
   *  fixture project; a spec that writes into its own scratch project passes it. */
  projectPath: string = FIXTURE_PROJECT,
): ServerExport {
  const script = `
    import { exportDesign } from ${JSON.stringify(path.join(REPO_ROOT, 'src/mcp/engine-export-tools.ts'))};
    const res = exportDesign({
      design_path: ${JSON.stringify(design)},
      format: ${JSON.stringify(format)},
      output_path: ${JSON.stringify(outPath)},
      project_path: ${JSON.stringify(projectPath)},
    });
    process.stdout.write('@@' + JSON.stringify(res) + '@@');
  `;
  const run = spawnSync('bun', ['run', '-'], {
    input: script,
    cwd: REPO_ROOT,
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, FOLIO_PROJECTS_DIR: FIXTURE_PROJECTS, FOLIO_LIBRARY_DIR: LIBRARY_DIR },
  });
  const raw = run.stdout?.match(/@@([\s\S]*?)@@/)?.[1];
  if (!raw) {
    return { ok: false, files: [], notes: [], error: (run.stderr || run.stdout || 'no output').slice(0, 400) };
  }
  const res = JSON.parse(raw) as {
    success?: boolean; output_paths?: string[]; output_path?: string; notes?: string[];
  };
  const files = (res.output_paths ?? (res.output_path ? [res.output_path] : [])).filter(f => fs.existsSync(f));
  return { ok: res.success === true, files, notes: res.notes ?? [] };
}

export interface DiagnoseResult {
  ok: boolean;
  findings: Array<{ code: string; severity: string; message: string; layer_id?: string }>;
  error?: string;
}

/** Run diagnose_design through the real engine — the surface a model reads. */
export function serverDiagnose(design: string): DiagnoseResult {
  const script = `
    import { diagnoseDesign } from ${JSON.stringify(path.join(REPO_ROOT, 'src/mcp/engine-export-tools.ts'))};
    const res = diagnoseDesign({
      design_path: ${JSON.stringify(design)},
      project_path: ${JSON.stringify(FIXTURE_PROJECT)},
    });
    process.stdout.write('@@' + JSON.stringify(res) + '@@');
  `;
  const run = spawnSync('bun', ['run', '-'], {
    input: script, cwd: REPO_ROOT, encoding: 'utf8', timeout: 180_000,
    env: { ...process.env, FOLIO_PROJECTS_DIR: FIXTURE_PROJECTS, FOLIO_LIBRARY_DIR: LIBRARY_DIR },
  });
  const raw = run.stdout?.match(/@@([\s\S]*?)@@/)?.[1];
  if (!raw) return { ok: false, findings: [], error: (run.stderr || 'no output').slice(0, 400) };
  const res = JSON.parse(raw) as {
    success?: boolean;
    findings?: Array<{ code: string; severity: string; message: string; layer_id?: string }>;
    errors?: Array<{ code: string; severity: string; message: string; layer_id?: string }>;
    warnings?: Array<{ code: string; severity: string; message: string; layer_id?: string }>;
    suggestions?: Array<{ code: string; severity: string; message: string; layer_id?: string }>;
  };
  const findings = res.findings
    ?? [...(res.errors ?? []), ...(res.warnings ?? []), ...(res.suggestions ?? [])];
  return { ok: res.success === true, findings };
}

// ── editor engine ────────────────────────────────────────────────────────────

/** The editor gates /__project_files/* on a token in every environment, so the
 *  commissioning server is started with a known one rather than opened up. */
export const TEST_TOKEN = process.env['FOLIO_COMMISSIONING_TOKEN'] ?? 'commissioning-token';

/**
 * The editor auto-loads `?file=` ONLY for paths under the container's
 * /home/folio/projects (app.ts hard-codes that prefix and refuses anything
 * else, whatever FOLIO_PROJECTS_DIR says). The path is used purely to derive a
 * relative URL, so the suite passes a production-shaped path and the request
 * lands on its own server at /__project_files/<rel>.
 */
function editorFileParam(name: string): string {
  return `/home/folio/projects/commissioning/designs/${name}.design.yaml`;
}

/**
 * Open a fixture design in the real editor and wait for it to finish painting.
 *
 * Verifies the RIGHT design loaded. When auto-load fails the editor keeps its
 * built-in sample design on screen, which is full of layers and renders
 * perfectly — so a check that only waits for "some SVG" measures the sample
 * and reports success. That false pass is worse than no test.
 */
export async function openDesign(page: Page, name: string): Promise<void> {
  await page.goto(`/?file=${encodeURIComponent(editorFileParam(name))}&token=${TEST_TOKEN}`,
    { waitUntil: 'domcontentloaded' });
  const expected = FIXTURE_NAMES[name];
  if (!expected) throw new Error(`unknown commissioning fixture "${name}"`);
  await page.waitForFunction(
    (id: string) => Boolean(document.querySelector(`[data-layer-id="${id}"]`)),
    expected,
    { timeout: 45_000 },
  );
  // Fonts swap a frame late; a heavy display face otherwise measures as missing.
  await page.evaluate(() => document.fonts?.ready);
  await page.waitForTimeout(1200);
}

/** A layer id unique to each fixture — proof the fixture, not the sample, loaded. */
const FIXTURE_NAMES: Record<string, string> = {
  'poster-assets': 'mark-shared',
  'deck-pages': 'p1-mark',
  'flat-style': 'subtitle',
};

/**
 * The design SVG's layer boxes as page fractions, read from the RENDERED tree
 * rather than computed from the spec — group transforms and auto-layout move
 * things, and the rendered position is the one the export has to match.
 */
export async function collectRegions(page: Page): Promise<Region[]> {
  return page.evaluate(() => {
    let root: SVGSVGElement | null = null;
    let best = -1;
    for (const svg of document.querySelectorAll('svg')) {
      const n = svg.querySelectorAll('image, text').length;
      if (n > best) { best = n; root = svg as SVGSVGElement; }
    }
    if (!root) return [];
    const rootBox = root.getBoundingClientRect();
    if (!rootBox.width || !rootBox.height) return [];
    const out: Region[] = [];
    const push = (el: Element, kind: 'image' | 'text'): void => {
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) return;
      const id = el.closest('[data-layer-id]')?.getAttribute('data-layer-id')
        ?? `${kind}-${out.length}`;
      out.push({
        id, kind,
        x: (r.left - rootBox.left) / rootBox.width,
        y: (r.top - rootBox.top) / rootBox.height,
        w: r.width / rootBox.width,
        h: r.height / rootBox.height,
      });
    };
    // Image LAYERS: the <image> element carries its own box.
    root.querySelectorAll('image').forEach(el => {
      // …except one inside <defs>/<pattern>, which is a template and measures
      // 0×0. Those are covered below via the shape that references them.
      if (el.closest('defs, pattern')) return;
      push(el, 'image');
    });
    // Image FILLS: the artwork is a <pattern> in <defs>; the box belongs to the
    // shape painted with url(#id). Without this the fill path goes unchecked —
    // and it is a genuinely different code path from an image layer.
    for (const pattern of root.querySelectorAll('pattern')) {
      if (!pattern.querySelector('image')) continue;
      const id = pattern.getAttribute('id');
      if (!id) continue;
      root.querySelectorAll(`[fill="url(#${id})"]`).forEach(el => push(el, 'image'));
    }
    root.querySelectorAll('text').forEach(el => push(el, 'text'));
    return out;
  }) as Promise<Region[]>;
}

/**
 * Budget for a file-manager step that has to reach the server and come back.
 *
 * These waits were written as `{ timeout: 15_000 }`, which reads generous and
 * is not: the suite's own default is 20s, so an upload — the slowest thing
 * these tests do — was given LESS time than the pure-DOM assertions around it.
 *
 * NOTE what this is not. It was first raised believing a flaky folder test was
 * slow; at 45s it failed again after 49 attempts, which proved nothing was
 * slow. The real defect was a missing wait in newFolder (see either spec).
 * A budget chosen for the operation still beats a literal nobody chose, but a
 * timeout is not a synchronisation primitive, and reaching for one to settle a
 * flake hides the race instead of fixing it.
 */
export const UPLOAD_SETTLE = 45_000;

#!/usr/bin/env node
/**
 * MCP export sweep — Node + fetch only (no Playwright).
 *
 * For each MCP export tool we exercise at least 3 templates spanning the
 * supported design types:
 *   - export_design    (svg, html, png, pdf)  ×  3 templates
 *   - export_report    (html)                 ×  3 reports
 *   - export_presentation (html)              ×  3 presentations
 *   - export_animation (gif, mp4, webm)       ×  1 best-effort
 *   - export_template  (template.yaml)        ×  3
 *
 * Each scenario:
 *   1. create_project   (fresh dir under /tmp)
 *   2. inject_template  → .design.yaml
 *   3. export_<tool>    → captures file
 *   4. validate output (magic bytes + non-empty body)
 *
 * Output:
 *   /root/Folio/tools/use-case-reports/export-pipeline/results.json
 *   /root/Folio/tools/use-case-reports/export-pipeline/problems.json
 *   /root/Folio/tools/use-case-reports/export-mcp/outputs/*  (copies of artifacts)
 *
 * Usage:
 *   node tests/use-case/export-mcp.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '../..');

const MCP_URL   = process.env.FOLIO_MCP_URL || 'http://localhost:3334/mcp';
const MCP_TOKEN = process.env.FOLIO_MCP_TOKEN || 'sk-test';

const OUT_ROOT = path.join(REPO_ROOT, 'tools/use-case-reports');
const PIPE_DIR = path.join(OUT_ROOT, 'export-pipeline');
const FILE_DIR = path.join(OUT_ROOT, 'export-mcp/outputs');
fs.mkdirSync(PIPE_DIR, { recursive: true });
fs.mkdirSync(FILE_DIR, { recursive: true });

/* ── Template inventory (built-in YAMLs under public/templates/builtin) ── */
const BUILTIN_DIR = path.join(REPO_ROOT, 'public/templates/builtin');

const PICKS = {
  poster: [
    '01-simple-poster.template.yaml',
    '04-event-poster.template.yaml',
    '13-business-card.template.yaml',
  ],
  carousel: [
    '06-instagram-carousel.template.yaml',
    '113-conference-program.template.yaml',
    '167-childrens-book.template.yaml',
  ],
  report: [
    '08-sectioned-report.template.yaml',
    '131-annual-report-corporate.template.yaml',
    '07-kpi-dashboard.template.yaml',
  ],
  presentation: [
    '41-slide-content.template.yaml',
    '60-slide-agenda.template.yaml',
    '61-slide-quote.template.yaml',
  ],
};

/* ── JSON-RPC client over HTTP ─────────────────────────────────────────── */
let rpcId = 0;
async function callTool(name, args) {
  rpcId += 1;
  const t0 = Date.now();
  const body = {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'tools/call',
    params: { name, arguments: args },
  };
  let resp;
  let err;
  try {
    const r = await fetch(MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${MCP_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    resp = await r.json();
  } catch (e) {
    err = e?.message ?? String(e);
  }
  const ms = Date.now() - t0;
  return { name, args, resp, err, ms };
}

/** Parse MCP tool result envelope → engine ToolResult shape. */
function unwrap(call) {
  const r = call.resp;
  if (!r || !r.result) return null;
  // toMCPResult wraps the raw ToolResult into { content: [{type:text, text: JSON}], structuredContent? }
  const sc = r.result.structuredContent;
  if (sc && typeof sc === 'object') return sc;
  const content = r.result.content;
  if (Array.isArray(content) && content[0]?.type === 'text') {
    try { return JSON.parse(content[0].text); } catch { /* fallthrough */ }
  }
  return r.result;
}

/* ── Output validators ─────────────────────────────────────────────────── */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const PDF_MAGIC = Buffer.from('%PDF-', 'ascii');

function validateOutput(format, filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, reason: `Output file missing: ${filePath ?? '(none)'}` };
  }
  const buf = fs.readFileSync(filePath);
  const bytes = buf.length;
  if (bytes < 100) return { ok: false, reason: `Output too small (${bytes} bytes)`, bytes };

  if (format === 'svg') {
    const s = buf.toString('utf8');
    if (!/<svg[\s>]/i.test(s)) return { ok: false, reason: 'No <svg> root', bytes };
    const inner = s.replace(/^[\s\S]*?<svg\b[^>]*>/i, '').replace(/<\/svg>[\s\S]*$/i, '');
    if (!/<[a-z]/i.test(inner)) return { ok: false, reason: '<svg> has no children', bytes };
    return { ok: true, bytes };
  }
  if (format === 'html') {
    const s = buf.toString('utf8');
    if (!/<html[\s>]/i.test(s) && !/<!doctype html/i.test(s))
      return { ok: false, reason: 'No <html> root / DOCTYPE', bytes };
    if (!/<(svg|div|main|section|body)[\s>]/i.test(s))
      return { ok: false, reason: 'HTML has no body content', bytes };
    return { ok: true, bytes };
  }
  if (format === 'png') {
    if (!buf.subarray(0, 4).equals(PNG_MAGIC))
      return { ok: false, reason: `Bad PNG magic: ${buf.subarray(0,8).toString('hex')}`, bytes };
    return { ok: true, bytes };
  }
  if (format === 'pdf') {
    if (!buf.subarray(0, 5).equals(PDF_MAGIC))
      return { ok: false, reason: `Bad PDF magic: ${buf.subarray(0,8).toString('hex')}`, bytes };
    return { ok: true, bytes };
  }
  if (format === 'template.yaml') {
    const s = buf.toString('utf8');
    if (!/_protocol:\s*template\/v1/.test(s))
      return { ok: false, reason: 'Missing _protocol: template/v1', bytes };
    return { ok: true, bytes };
  }
  return { ok: false, reason: `Unknown format: ${format}`, bytes };
}

/* ── Per-template slot inference ───────────────────────────────────────── */
const yaml = await import('js-yaml');
function loadTemplate(file) {
  const p = path.join(BUILTIN_DIR, file);
  return { path: p, spec: yaml.load(fs.readFileSync(p, 'utf8')) };
}

function buildSlotValues(tmpl) {
  const out = {};
  for (const s of tmpl.slots ?? []) {
    // Synthesize visible placeholder text by slot type / hint.
    if (s.type === 'text' || s.type === 'markdown') {
      out[s.id] = `EXPORT-TEST ${s.id}`;
    } else if (s.type === 'number') {
      out[s.id] = 42;
    } else if (s.type === 'color') {
      out[s.id] = '#ff5722';
    } else if (s.type === 'image') {
      out[s.id] = 'https://placehold.co/600x400';
    } else {
      out[s.id] = s.default ?? `EXPORT-${s.id}`;
    }
  }
  return out;
}

/* ── Driver helpers ────────────────────────────────────────────────────── */
async function setupDesignFromTemplate(file) {
  // Each template gets a fresh project under /tmp so paths never collide.
  const slug = file.replace(/\.template\.yaml$/, '').replace(/^[0-9]+-/, '');
  const projectPath = path.join(os.tmpdir(), `folio-export-${slug}-${Date.now().toString(36)}`);
  const tmpl = loadTemplate(file);
  const slots = buildSlotValues(tmpl.spec);

  const cp = await callTool('create_project', { name: slug, path: projectPath, canvas: '1080x1080' });
  const cpResult = unwrap(cp);
  if (!cp.resp || !cpResult || cpResult.success === false) {
    return { ok: false, reason: `create_project failed: ${cpResult?.error ?? cp.err ?? 'unknown'}`, projectPath };
  }

  // Drop the template into the project's templates/ dir so inject_template
  // can use a path inside our home/tmp scope.
  const projTmplPath = path.join(projectPath, 'templates', path.basename(file));
  fs.copyFileSync(tmpl.path, projTmplPath);

  const designPath = path.join(projectPath, 'designs', `${slug}.design.yaml`);
  const inj = await callTool('inject_template', {
    template_path: projTmplPath,
    slots,
    output_path: designPath,
  });
  const injResult = unwrap(inj);
  if (!inj.resp || !injResult || injResult.success === false) {
    return { ok: false, reason: `inject_template failed: ${injResult?.error ?? inj.err ?? 'unknown'}`, projectPath };
  }
  return { ok: true, projectPath, designPath, calls: { create_project: cp, inject_template: inj } };
}

function copyArtifact(srcPath, scenarioId, ext) {
  if (!srcPath || !fs.existsSync(srcPath)) return null;
  const dst = path.join(FILE_DIR, `${scenarioId}.${ext}`);
  try {
    fs.copyFileSync(srcPath, dst);
    return dst;
  } catch {
    return null;
  }
}

/* ── Scenarios ─────────────────────────────────────────────────────────── */
const results = [];

async function runExportDesign(format) {
  const files = (format === 'pdf' || format === 'png') ? PICKS.poster : PICKS.poster;
  for (const file of files) {
    const id = `export_design.${format}.${file.replace(/\.template\.yaml$/, '')}`;
    const setup = await setupDesignFromTemplate(file);
    const row = { id, tool: 'export_design', format, template: file, ok: false, reason: '', output_path: null, bytes: 0, time_ms: 0, calls: [] };

    if (!setup.ok) {
      row.reason = setup.reason;
      results.push(row);
      continue;
    }
    row.calls.push({ tool: 'create_project',   resp: setup.calls.create_project.resp });
    row.calls.push({ tool: 'inject_template',  resp: setup.calls.inject_template.resp });

    const exp = await callTool('export_design', { design_path: setup.designPath, format });
    row.time_ms = exp.ms;
    row.calls.push({ tool: 'export_design', resp: exp.resp });
    const eResult = unwrap(exp);

    if (!exp.resp) {
      row.reason = `HTTP error: ${exp.err}`;
      results.push(row);
      continue;
    }

    if (!eResult || eResult.success === false) {
      row.reason = `export_design ok=false: ${eResult?.error ?? 'unknown'} | hint=${eResult?.hint ?? ''}`;
      results.push(row);
      continue;
    }

    const status = eResult.status;
    const outPath = eResult.output_path;

    if (format === 'pdf' && status === 'puppeteer_required') {
      row.ok = false;
      row.reason = `puppeteer_required (status=${status}). html_path=${eResult.html_path}`;
      row.note = 'Puppeteer required for PDF rasterisation; only HTML staging happened.';
      // Validate the staged HTML at least.
      if (eResult.html_path && fs.existsSync(eResult.html_path)) {
        const v = validateOutput('html', eResult.html_path);
        row.staged_html_ok = v.ok;
        row.staged_html_reason = v.reason;
        row.staged_html_bytes = v.bytes;
      }
      results.push(row);
      continue;
    }

    if (format === 'png' && eResult.status === 'unsupported') {
      row.reason = `Engine returned status=unsupported for PNG (no browser canvas in Node MCP). hint=${eResult.hint ?? ''}`;
      results.push(row);
      continue;
    }

    const v = validateOutput(format, outPath);
    row.bytes = v.bytes ?? 0;
    row.ok = v.ok;
    row.reason = v.reason ?? '';
    row.output_path = copyArtifact(outPath, `export_design.${format}.${file}`, format);
    results.push(row);
  }
}

async function runExportReport() {
  for (const file of PICKS.report) {
    const id = `export_report.html.${file.replace(/\.template\.yaml$/, '')}`;
    const setup = await setupDesignFromTemplate(file);
    const row = { id, tool: 'export_report', format: 'html', template: file, ok: false, reason: '', output_path: null, bytes: 0, time_ms: 0, calls: [] };
    if (!setup.ok) { row.reason = setup.reason; results.push(row); continue; }
    row.calls.push({ tool: 'inject_template',  resp: setup.calls.inject_template.resp });

    const exp = await callTool('export_report', { design_path: setup.designPath });
    row.time_ms = exp.ms;
    row.calls.push({ tool: 'export_report', resp: exp.resp });
    const eResult = unwrap(exp);
    if (!exp.resp || !eResult) { row.reason = `HTTP error: ${exp.err}`; results.push(row); continue; }
    if (eResult.success === false) {
      row.reason = `export_report ok=false: ${eResult.error ?? 'unknown'} | hint=${eResult.hint ?? ''}`;
      results.push(row);
      continue;
    }
    const v = validateOutput('html', eResult.output_path);
    row.bytes = v.bytes ?? 0;
    row.ok = v.ok;
    row.reason = v.reason ?? '';
    row.output_path = copyArtifact(eResult.output_path, id, 'html');
    results.push(row);
  }
}

async function runExportPresentation() {
  for (const file of PICKS.presentation) {
    const id = `export_presentation.html.${file.replace(/\.template\.yaml$/, '')}`;
    const setup = await setupDesignFromTemplate(file);
    const row = { id, tool: 'export_presentation', format: 'html', template: file, ok: false, reason: '', output_path: null, bytes: 0, time_ms: 0, calls: [] };
    if (!setup.ok) { row.reason = setup.reason; results.push(row); continue; }
    row.calls.push({ tool: 'inject_template',  resp: setup.calls.inject_template.resp });

    const exp = await callTool('export_presentation', { design_path: setup.designPath });
    row.time_ms = exp.ms;
    row.calls.push({ tool: 'export_presentation', resp: exp.resp });
    const eResult = unwrap(exp);
    if (!exp.resp || !eResult) { row.reason = `HTTP error: ${exp.err}`; results.push(row); continue; }
    if (eResult.success === false) {
      row.reason = `export_presentation ok=false: ${eResult.error ?? 'unknown'} | hint=${eResult.hint ?? ''}`;
      results.push(row);
      continue;
    }
    const v = validateOutput('html', eResult.output_path);
    row.bytes = v.bytes ?? 0;
    row.ok = v.ok;
    row.reason = v.reason ?? '';
    row.output_path = copyArtifact(eResult.output_path, id, 'html');
    results.push(row);
  }
}

async function runExportTemplate() {
  for (const file of PICKS.poster.slice(0, 3)) {
    const id = `export_template.yaml.${file.replace(/\.template\.yaml$/, '')}`;
    const setup = await setupDesignFromTemplate(file);
    const row = { id, tool: 'export_template', format: 'template.yaml', template: file, ok: false, reason: '', output_path: null, bytes: 0, time_ms: 0, calls: [] };
    if (!setup.ok) { row.reason = setup.reason; results.push(row); continue; }
    row.calls.push({ tool: 'inject_template',  resp: setup.calls.inject_template.resp });

    const exp = await callTool('export_template', { design_path: setup.designPath });
    row.time_ms = exp.ms;
    row.calls.push({ tool: 'export_template', resp: exp.resp });
    const eResult = unwrap(exp);
    if (!exp.resp || !eResult) { row.reason = `HTTP error: ${exp.err}`; results.push(row); continue; }
    if (eResult.success === false) {
      row.reason = `export_template ok=false: ${eResult.error ?? 'unknown'} | hint=${eResult.hint ?? ''}`;
      results.push(row);
      continue;
    }
    const v = validateOutput('template.yaml', eResult.template_path);
    row.bytes = v.bytes ?? 0;
    row.ok = v.ok;
    row.reason = v.reason ?? '';
    row.output_path = copyArtifact(eResult.template_path, id, 'template.yaml');
    results.push(row);
  }
}

async function runEdgeCases() {
  // Edge case 1: export_design against a missing path (reproduces ok=false from docker logs).
  const ec1 = await callTool('export_design', { design_path: '/tmp/folio-nope/missing.design.yaml', format: 'svg' });
  results.push({
    id: 'edge.export_design.missing_path',
    tool: 'export_design',
    format: 'svg',
    template: '(synthetic)',
    ok: false,
    reason: `Expected ok=false; got: ${JSON.stringify(unwrap(ec1) ?? {}).slice(0, 300)}`,
    time_ms: ec1.ms,
    note: 'Edge case: invalid design_path. Records what export_design returns for this scenario.',
    calls: [{ tool: 'export_design', resp: ec1.resp }],
  });

  // Edge case 2: export_design against a design with validation errors.
  const projDir = path.join(os.tmpdir(), `folio-edge-${Date.now().toString(36)}`);
  const cp = await callTool('create_project', { name: 'edge', path: projDir, canvas: '600x600' });
  const designsDir = path.join(projDir, 'designs');
  fs.mkdirSync(designsDir, { recursive: true });
  const brokenPath = path.join(designsDir, 'broken.design.yaml');
  fs.writeFileSync(brokenPath, [
    '_protocol: design/v1',
    'meta: { id: broken, name: Broken, type: poster }',
    'document: { width: 600, height: 600 }',
    'layers:',
    '  - id: bad',
    '    type: text',
    '    z: 1',
    // intentionally no `content`
  ].join('\n'));
  const ec2 = await callTool('export_design', { design_path: brokenPath, format: 'svg' });
  const ec2Result = unwrap(ec2);
  results.push({
    id: 'edge.export_design.validation_error',
    tool: 'export_design',
    format: 'svg',
    template: '(synthetic)',
    ok: false,
    reason: `Expected ok=false; engine returned: ${ec2Result?.error ?? '(no error msg)'}`,
    time_ms: ec2.ms,
    note: 'Edge case: design with validation errors. Reproduces "export_design ok=false" from docker logs.',
    calls: [{ tool: 'create_project', resp: cp.resp }, { tool: 'export_design', resp: ec2.resp }],
  });

  // Edge case 3: export_report against a non-report design.
  const posterFile = PICKS.poster[0];
  const posterSetup = await setupDesignFromTemplate(posterFile);
  if (posterSetup.ok) {
    const ec3 = await callTool('export_report', { design_path: posterSetup.designPath });
    const ec3Result = unwrap(ec3);
    results.push({
      id: 'edge.export_report.non_report_type',
      tool: 'export_report',
      format: 'html',
      template: posterFile,
      ok: false,
      reason: `Engine returned: ${ec3Result?.error ?? '(no error msg)'}`,
      time_ms: ec3.ms,
      note: 'Edge case: feeding a poster design to export_report should return a clear type error.',
      calls: [{ tool: 'export_report', resp: ec3.resp }],
    });
  }

  // Edge case 4: export_design with format=jpg (not in enum).
  const validPosterSetup = await setupDesignFromTemplate(PICKS.poster[1]);
  if (validPosterSetup.ok) {
    const ec4 = await callTool('export_design', { design_path: validPosterSetup.designPath, format: 'jpg' });
    const ec4Result = unwrap(ec4);
    results.push({
      id: 'edge.export_design.bogus_format',
      tool: 'export_design',
      format: 'jpg',
      template: PICKS.poster[1],
      ok: false,
      reason: `Engine returned status=${ec4Result?.status ?? '?'} error=${ec4Result?.error ?? '(none)'}`,
      time_ms: ec4.ms,
      note: 'Edge case: unsupported format. Engine should reject with success=false; currently returns success=true status=unsupported.',
      calls: [{ tool: 'export_design', resp: ec4.resp }],
    });
  }
}

async function runExportAnimation() {
  // Best-effort: animations need ffmpeg + puppeteer to actually render frames.
  // The MCP tool only returns instructions when these are missing.
  const file = PICKS.presentation[0]; // 41-slide-content
  for (const type of ['gif', 'mp4', 'webm']) {
    const id = `export_animation.${type}.${file.replace(/\.template\.yaml$/, '')}`;
    const setup = await setupDesignFromTemplate(file);
    const row = { id, tool: 'export_animation', format: type, template: file, ok: false, reason: '', output_path: null, bytes: 0, time_ms: 0, calls: [] };
    if (!setup.ok) { row.reason = setup.reason; results.push(row); continue; }
    row.calls.push({ tool: 'inject_template',  resp: setup.calls.inject_template.resp });

    const exp = await callTool('export_animation', { design_path: setup.designPath, type });
    row.time_ms = exp.ms;
    row.calls.push({ tool: 'export_animation', resp: exp.resp });
    const eResult = unwrap(exp);
    if (!exp.resp || !eResult) { row.reason = `HTTP error: ${exp.err}`; results.push(row); continue; }
    if (eResult.success === false) {
      row.reason = `export_animation ok=false: ${eResult.error ?? 'unknown'} | hint=${eResult.hint ?? ''}`;
      results.push(row);
      continue;
    }
    // The animation tool returns instructions, not a file. Capture the meta.
    row.ok = false; // Cannot validate a real artifact in this run.
    row.note = 'Animation tool returned instructions only — no file written. ' +
      (eResult.ffmpeg_available ? 'ffmpeg available' : 'ffmpeg MISSING') +
      `; output_path=${eResult.output_path}; hint=${eResult.hint ?? ''}`;
    row.reason = row.note;
    row.ffmpeg_available = eResult.ffmpeg_available ?? null;
    results.push(row);
  }
}

/* ── Main ──────────────────────────────────────────────────────────────── */
async function main() {
  // Health probe first.
  try {
    const h = await fetch(MCP_URL.replace(/\/mcp$/, '/health'));
    if (!h.ok) throw new Error(`health HTTP ${h.status}`);
  } catch (e) {
    console.error(`MCP not reachable at ${MCP_URL}: ${e.message}`);
    process.exit(2);
  }

  for (const fmt of ['svg', 'html', 'png', 'pdf']) {
    await runExportDesign(fmt);
  }
  await runExportReport();
  await runExportPresentation();
  await runExportTemplate();
  await runExportAnimation();
  await runEdgeCases();

  const pass = results.filter(r => r.ok).length;
  const fail = results.filter(r => !r.ok).length;
  const summary = { count: results.length, pass, fail, results };
  fs.writeFileSync(path.join(PIPE_DIR, 'results.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(PIPE_DIR, 'problems.json'), JSON.stringify({
    count: fail,
    problems: results.filter(r => !r.ok),
  }, null, 2));

  // Console digest.
  console.log(`\n== MCP export sweep ==`);
  console.log(`total: ${results.length}   pass: ${pass}   fail: ${fail}`);
  const byFmt = {};
  for (const r of results) {
    const k = `${r.tool}.${r.format}`;
    byFmt[k] = byFmt[k] || { pass: 0, fail: 0 };
    byFmt[k][r.ok ? 'pass' : 'fail']++;
  }
  console.log('breakdown by tool.format:', byFmt);
  for (const r of results.filter(r => !r.ok)) {
    console.log(` - ${r.id} :: ${r.reason}`);
  }
}

await main().catch(err => {
  console.error('Unhandled error:', err);
  process.exit(1);
});

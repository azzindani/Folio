// MCP HTTP end-to-end scenarios — simulates an LLM agent driving Folio MCP tools.
// Run: node /root/Folio/tests/use-case/mcp-flows.mjs > /tmp/mcp-flows.out 2>&1
//
// Output: /root/Folio/tools/use-case-reports/mcp-flows/{results.json, problems.json, mcp-server-log-tail.txt}

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const BASE = 'http://localhost:3334';
const TOKEN = 'sk-test';
const PROJECTS_ROOT = '/root/Folio/folio-projects/test-mcp';
const REPORT_DIR = '/root/Folio/tools/use-case-reports/mcp-flows';
const ISSUES_FILE = '/root/Folio/tools/use-case-reports/issues.md';
const TEMPLATES_DIR = '/root/Folio/public/templates/builtin';

await fsp.mkdir(PROJECTS_ROOT, { recursive: true });
await fsp.mkdir(REPORT_DIR, { recursive: true });

const results = [];
let scenarioId = 0;
let bugCounter = 150;
const newBugs = [];

let nextRpcId = 1;
async function rpc(name, args = {}) {
  const id = nextRpcId++;
  const r = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await r.json();
  // unwrap MCP content envelope
  let inner = null;
  try {
    if (json?.result?.content?.[0]?.text) inner = JSON.parse(json.result.content[0].text);
  } catch { /* ignore */ }
  return { http: r.status, raw: json, inner };
}

async function runScenario(label, tool, args, validator) {
  scenarioId++;
  const id = `S${String(scenarioId).padStart(3, '0')}`;
  const t0 = Date.now();
  let res, ok = false, error = null;
  try {
    res = await rpc(tool, args);
    if (validator) {
      const v = validator(res);
      if (v === true) ok = true;
      else { ok = false; error = String(v); }
    } else {
      ok = !!res.inner?.success;
      if (!ok) error = res.inner?.error || res.raw?.error?.message || 'no success flag';
    }
  } catch (e) {
    ok = false;
    error = e?.message || String(e);
  }
  const durationMs = Date.now() - t0;
  const entry = { id, label, tool, ok, args, durationMs };
  if (!ok) entry.error = error;
  results.push(entry);
  const tag = ok ? 'PASS' : 'FAIL';
  console.log(`${tag} ${id} ${tool.padEnd(26)} ${label}${ok ? '' : ' :: ' + error}`);
  return res;
}

function recordBug(sev, area, scenarioLabel, description) {
  bugCounter++;
  newBugs.push({ id: `BUG-${bugCounter}`, sev, area, scenarioLabel, description });
}

// ── Helpers ───────────────────────────────────────────────────────────
const PROJ = (name) => path.join(PROJECTS_ROOT, name);
const DESIGN_PATH = (proj, file) => path.join(PROJ(proj), 'designs', file);

// ═══════════════════════════════════════════════════════════════════════
// SECTION 1: Engine guide
// ═══════════════════════════════════════════════════════════════════════
for (const section of ['quick_ref', 'shorthand', 'layers', 'workflow']) {
  await runScenario(`engine guide / ${section}`, 'get_engine_guide', { section });
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 2: Project lifecycle (5 scenarios)
// ═══════════════════════════════════════════════════════════════════════
const projLife = 'lifecycle';
await runScenario('create_project lifecycle', 'create_project', { name: 'lifecycle', path: PROJ(projLife), theme: 'dark-tech', canvas: '1080x1080' });
await runScenario('list_designs empty', 'list_designs', { project_path: PROJ(projLife) });
const cdRes = await runScenario('create_design poster', 'create_design', { project_path: PROJ(projLife), name: 'lifecycle-poster', type: 'poster' });
const lifeDesignPath = cdRes?.inner?.path;
await runScenario('inspect_design after create', 'inspect_design', { design_path: lifeDesignPath });
await runScenario('seal_design lifecycle', 'seal_design', { design_path: lifeDesignPath });

// ═══════════════════════════════════════════════════════════════════════
// SECTION 3: Layer ops (8 scenarios)
// ═══════════════════════════════════════════════════════════════════════
const proj3 = 'layer-ops';
await runScenario('create project layer-ops', 'create_project', { name: 'layer-ops', path: PROJ(proj3) });
const layerDesignRes = await runScenario('create design for layer ops', 'create_design', { project_path: PROJ(proj3), name: 'layers-design', type: 'poster' });
const layerDesignPath = layerDesignRes?.inner?.path;

await runScenario('add rect layer', 'add_layer', {
  design_path: layerDesignPath,
  layer: { id: 'bg', type: 'rect', z: 0, x: 0, y: 0, width: 1080, height: 1080, fill: { type: 'solid', color: '#0e1116' } },
});
await runScenario('add circle layer', 'add_layer', {
  design_path: layerDesignPath,
  layer: { id: 'orb', type: 'circle', z: 5, cx: 540, cy: 400, rx: 180, ry: 180, fill: { type: 'solid', color: '#3b82f6' } },
});
await runScenario('add text layer', 'add_layer', {
  design_path: layerDesignPath,
  layer: { id: 'title', type: 'text', z: 10, x: 80, y: 700, width: 920, height: 0, content: { type: 'plain', value: 'Hello Folio' }, style: { font_family: '$heading', font_size: 96, font_weight: 700, color: '#ffffff' } },
});
await runScenario('add image layer', 'add_layer', {
  design_path: layerDesignPath,
  layer: { id: 'photo', type: 'image', z: 8, x: 100, y: 100, width: 320, height: 200, src: 'https://placehold.co/320x200' },
});
await runScenario('add path layer', 'add_layer', {
  design_path: layerDesignPath,
  layer: { id: 'flourish', type: 'path', z: 12, x: 0, y: 0, width: 1080, height: 1080, d: 'M 100 100 L 980 100 L 980 980 L 100 980 Z', stroke: { color: '#ffffff', width: 2 } },
});
await runScenario('inspect after 5 layers', 'inspect_design', { design_path: layerDesignPath }, (r) => {
  if (!r.inner?.success) return r.inner?.error || 'fail';
  const text = JSON.stringify(r.inner);
  // Heuristic: inspect should list layer IDs
  if (!/bg|orb|title/.test(text)) return 'expected to see layer ids in inspect output';
  return true;
});
await runScenario('update_layer move + recolor', 'update_layer', {
  design_path: layerDesignPath,
  layer_id: 'orb',
  props: { cx: 200, cy: 200, fill: { type: 'solid', color: '#f97316' } },
});
await runScenario('remove_layer photo', 'remove_layer', {
  design_path: layerDesignPath,
  layer_id: 'photo',
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 4: add_layers shorthand (4 scenarios)
// ═══════════════════════════════════════════════════════════════════════
const proj4 = 'shorthand';
await runScenario('create project shorthand', 'create_project', { name: 'shorthand', path: PROJ(proj4) });
const sd1Res = await runScenario('create design for shorthand', 'create_design', { project_path: PROJ(proj4), name: 'sh1', type: 'poster' });
const sdPath = sd1Res?.inner?.path;

await runScenario('add_layers shorthand text+shape', 'add_layers', {
  design_path: sdPath,
  layers_shorthand: [
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#111827' },
    { id: 'accent', type: 'circle', z: 5, cx: 800, cy: 200, rx: 160, ry: 160, fill: '#22d3ee', opacity: 0.6 },
    { id: 'title', type: 'text', z: 10, pos: [80, 400, 920, 0], text: 'Real Use Case', size: 96, weight: 800, color: '#ffffff' },
    { id: 'sub', type: 'text', z: 11, pos: [80, 540, 920, 0], text: 'Driven by the MCP HTTP server.', size: 32, color: '#9ca3af' },
  ],
});

await runScenario('inspect shorthand result', 'inspect_design', { design_path: sdPath }, (r) => {
  if (!r.inner?.success) return r.inner?.error || 'fail';
  const text = JSON.stringify(r.inner);
  if (!/accent|title|sub/.test(text)) return 'shorthand layers missing in inspect';
  return true;
});

// 5-layer group payload
const sd2Res = await runScenario('create design sh2 for group', 'create_design', { project_path: PROJ(proj4), name: 'sh2', type: 'poster' });
const sdPath2 = sd2Res?.inner?.path;
await runScenario('add_layers shorthand group-of-5', 'add_layers', {
  design_path: sdPath2,
  layers_shorthand: [
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#0e1116' },
    { id: 'c1', type: 'circle', z: 1, cx: 200, cy: 200, rx: 60, ry: 60, fill: '#f43f5e' },
    { id: 'c2', type: 'circle', z: 2, cx: 400, cy: 200, rx: 60, ry: 60, fill: '#eab308' },
    { id: 'c3', type: 'circle', z: 3, cx: 600, cy: 200, rx: 60, ry: 60, fill: '#22c55e' },
    { id: 'c4', type: 'circle', z: 4, cx: 800, cy: 200, rx: 60, ry: 60, fill: '#3b82f6' },
    { id: 'c5', type: 'circle', z: 5, cx: 1000, cy: 200, rx: 60, ry: 60, fill: '#a855f7' },
  ],
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 5: Theme application (5 scenarios)
// ═══════════════════════════════════════════════════════════════════════
const proj5 = 'themes';
await runScenario('create project themes', 'create_project', { name: 'themes', path: PROJ(proj5) });
await runScenario('list_themes', 'list_themes', { project_path: PROJ(proj5) });
const themesToTry = ['dark-tech', 'light-clean', 'ocean-blue', 'neon-bloom', 'sunset-glow'];
for (const t of themesToTry) {
  await runScenario(`apply_theme ${t}`, 'apply_theme', { project_path: PROJ(proj5), theme_id: t });
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 6: Templates (3 scenarios)
// ═══════════════════════════════════════════════════════════════════════
const proj6 = 'tmpls';
await runScenario('create project tmpls', 'create_project', { name: 'tmpls', path: PROJ(proj6) });

const allTemplates = (await fsp.readdir(TEMPLATES_DIR)).filter(f => f.endsWith('.template.yaml'));
// Deterministic picks: simple poster, quote card, stats card
const picks = [
  '01-simple-poster.template.yaml',
  '02-quote-card.template.yaml',
  '03-stats-card.template.yaml',
].filter(f => allTemplates.includes(f));

let tmplIdx = 0;
for (const t of picks) {
  tmplIdx++;
  const tpath = path.join(TEMPLATES_DIR, t);
  const slotsRes = await runScenario(`list_template_slots ${t}`, 'list_template_slots', { template_path: tpath });
  // Build slot map from declared slots
  const slotList = slotsRes?.inner?.slots || [];
  const slots = {};
  for (const s of slotList) {
    if (s.type === 'text' || !s.type) slots[s.id] = `Use Case Test ${tmplIdx}`;
    else if (s.type === 'number') slots[s.id] = 42;
    else if (s.type === 'color') slots[s.id] = '#3b82f6';
    else slots[s.id] = s.default || `Sample ${s.id}`;
  }
  const injectedOut = path.join(PROJ(proj6), 'designs', `injected-${tmplIdx}.design.yaml`);
  const injRes = await runScenario(`inject_template ${t}`, 'inject_template', { template_path: tpath, slots, output_path: injectedOut });
  if (injRes?.inner?.success) {
    await runScenario(`inspect injected ${tmplIdx}`, 'inspect_design', { design_path: injRes.inner.path || injectedOut });
  }
}

// ═══════════════════════════════════════════════════════════════════════
// SECTION 7: Carousel multi-step (1 scenario, multi-call)
// ═══════════════════════════════════════════════════════════════════════
const proj7 = 'carousel';
await runScenario('create project carousel', 'create_project', { name: 'carousel', path: PROJ(proj7) });
const ctRes = await runScenario('create_task carousel 4-page', 'create_task', {
  project_path: PROJ(proj7),
  task_name: 'release-notes',
  brief: 'Carousel announcing v2.5.0 release with 4 pages.',
  pages: [
    { id: 'cover', label: 'Cover', hints: 'big headline with version' },
    { id: 'whats-new', label: "What's New", hints: '3 bullet highlights' },
    { id: 'how-to', label: 'How to use', hints: 'quick steps' },
    { id: 'cta', label: 'CTA', hints: 'call to action footer' },
  ],
});
const taskPath = ctRes?.inner?.task_path || ctRes?.inner?.path;
const carouselDesignPath = ctRes?.inner?.design_path;
await runScenario('resume_task carousel', 'resume_task', { task_path: taskPath });

// Append 4 pages
const pages = [
  { id: 'cover', layers: [
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#0e1116' },
    { id: 'title', type: 'text', z: 10, pos: [80, 400, 920, 0], text: 'Folio v2.5.0', size: 112, weight: 800, color: '#ffffff' },
    { id: 'sub', type: 'text', z: 11, pos: [80, 560, 920, 0], text: 'LLM-first graphic design engine', size: 32, color: '#9ca3af' },
  ]},
  { id: 'whats-new', layers: [
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#0e1116' },
    { id: 'h', type: 'text', z: 10, pos: [80, 120, 920, 0], text: "What's New", size: 72, weight: 700, color: '#ffffff' },
    { id: 'b1', type: 'text', z: 11, pos: [80, 320, 920, 0], text: '• Lottie + GIF + MP4 export', size: 36, color: '#e5e7eb' },
    { id: 'b2', type: 'text', z: 12, pos: [80, 420, 920, 0], text: '• Page transitions (17 types)', size: 36, color: '#e5e7eb' },
    { id: 'b3', type: 'text', z: 13, pos: [80, 520, 920, 0], text: '• Formula bindings + scripting', size: 36, color: '#e5e7eb' },
  ]},
  { id: 'how-to', layers: [
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#0e1116' },
    { id: 'h', type: 'text', z: 10, pos: [80, 120, 920, 0], text: 'How to use', size: 72, weight: 700, color: '#ffffff' },
    { id: 's1', type: 'text', z: 11, pos: [80, 320, 920, 0], text: '1. Create project via MCP', size: 36, color: '#e5e7eb' },
    { id: 's2', type: 'text', z: 12, pos: [80, 420, 920, 0], text: '2. add_layers with shorthand', size: 36, color: '#e5e7eb' },
    { id: 's3', type: 'text', z: 13, pos: [80, 520, 920, 0], text: '3. seal_design + export', size: 36, color: '#e5e7eb' },
  ]},
  { id: 'cta', layers: [
    { id: 'bg', type: 'rect', z: 0, pos: [0, 0, 1080, 1080], fill: '#0e1116' },
    { id: 'h', type: 'text', z: 10, pos: [80, 400, 920, 0], text: 'Try it now', size: 96, weight: 800, color: '#22d3ee' },
    { id: 'f', type: 'text', z: 11, pos: [80, 560, 920, 0], text: 'folio.example.com', size: 32, color: '#9ca3af' },
  ]},
];
for (const p of pages) {
  await runScenario(`append_page ${p.id}`, 'append_page', {
    design_path: carouselDesignPath,
    page_id: p.id,
    layers_shorthand: p.layers,
    task_path: taskPath,
  });
}
await runScenario('seal carousel', 'seal_design', { design_path: carouselDesignPath });
await runScenario('export carousel svg', 'export_design', { design_path: carouselDesignPath, format: 'svg' });

// ═══════════════════════════════════════════════════════════════════════
// SECTION 8: Report (1 scenario, multi-call)
// ═══════════════════════════════════════════════════════════════════════
const proj8 = 'report';
await runScenario('create project report', 'create_project', { name: 'report', path: PROJ(proj8) });
const grRes = await runScenario('generate_report sidebar 4 pages', 'generate_report', {
  project_path: PROJ(proj8),
  name: 'q1-report',
  layout: 'sidebar',
  nav_type: 'sidebar',
  pages: [
    { id: 'summary', label: 'Summary' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'users', label: 'Users' },
    { id: 'next', label: 'Next Steps' },
  ],
});
const reportDesignPath = grRes?.inner?.path || grRes?.inner?.design_path;
await runScenario('bind_data sample dataset', 'bind_data', {
  design_path: reportDesignPath,
  datasets: [
    { id: 'kpi', rows: [
      { month: 'Jan', revenue: 12000, users: 320 },
      { month: 'Feb', revenue: 14500, users: 360 },
      { month: 'Mar', revenue: 17200, users: 410 },
    ]},
  ],
});
await runScenario('export_report html', 'export_report', { design_path: reportDesignPath, theme: 'dark' });

// ═══════════════════════════════════════════════════════════════════════
// SECTION 9: Presentation (1 scenario, multi-call)
// ═══════════════════════════════════════════════════════════════════════
const proj9 = 'pres';
await runScenario('create project pres', 'create_project', { name: 'pres', path: PROJ(proj9) });
const cpRes = await runScenario('create_presentation 3 slides fade', 'create_presentation', {
  project_path: PROJ(proj9),
  name: 'kickoff',
  transition: 'fade',
  pages: [
    { id: 'intro', label: 'Intro', notes: 'welcome' },
    { id: 'goals', label: 'Goals', notes: 'q2 targets' },
    { id: 'thanks', label: 'Thanks', notes: 'questions?' },
  ],
});
const presDesignPath = cpRes?.inner?.path || cpRes?.inner?.design_path;
await runScenario('export_presentation html', 'export_presentation', { design_path: presDesignPath, theme: 'dark' });

// ═══════════════════════════════════════════════════════════════════════
// SECTION 10: Export formats from finished design (4 attempts)
// ═══════════════════════════════════════════════════════════════════════
// reuse the sealed lifecycle design
await runScenario('export svg lifecycle', 'export_design', { design_path: lifeDesignPath, format: 'svg' });
await runScenario('export html lifecycle', 'export_design', { design_path: lifeDesignPath, format: 'html' });
await runScenario('export png lifecycle (may need puppeteer)', 'export_design', { design_path: lifeDesignPath, format: 'png' });
await runScenario('export pdf lifecycle (may need puppeteer)', 'export_design', { design_path: lifeDesignPath, format: 'pdf' });

// ═══════════════════════════════════════════════════════════════════════
// SECTION 11: Formulas (4 scenarios)
// ═══════════════════════════════════════════════════════════════════════
await runScenario('set_formula_context', 'set_formula_context', {
  design_path: lifeDesignPath,
  state: { x: 10, y: 20, active: true, name: 'folio' },
  data: { items: [1, 2, 3] },
});
await runScenario('debug_formula SUM', 'debug_formula', {
  formula: '=SUM(state.x, state.y)',
  state: { x: 10, y: 20 },
});
await runScenario('debug_formula IF', 'debug_formula', {
  formula: '=IF(state.active, "on", "off")',
  state: { active: true },
});
await runScenario('debug_formula concat', 'debug_formula', {
  formula: '=CONCAT("hello ", state.name)',
  state: { name: 'world' },
});

// ═══════════════════════════════════════════════════════════════════════
// SECTION 12: Edge cases (should fail gracefully)
// ═══════════════════════════════════════════════════════════════════════
// Each "graceful failure" expects success:false, no HTTP crash
function expectGracefulFail(r) {
  if (r.http !== 200) return `HTTP ${r.http} (expected 200 with success:false)`;
  if (r.inner?.success === true) return 'expected success:false, got success:true';
  return true; // success:false or error envelope is what we want
}

await runScenario('edge: inspect non-existent design', 'inspect_design', {
  design_path: '/tmp/does-not-exist.design.yaml',
}, expectGracefulFail);

await runScenario('edge: create_design missing name', 'create_design', {
  project_path: PROJ(proj3),
  // name missing
  type: 'poster',
}, expectGracefulFail);

await runScenario('edge: add_layer bad type', 'add_layer', {
  design_path: layerDesignPath,
  layer: { id: 'wat', type: 'frobozz', z: 99 },
}, expectGracefulFail);

// Malformed slot inject
await runScenario('edge: inject_template bad template path', 'inject_template', {
  template_path: '/tmp/nope.template.yaml',
  slots: { title: 'x' },
}, expectGracefulFail);

// Duplicate design_id (use same name twice in same project)
await runScenario('edge: duplicate design name', 'create_design', {
  project_path: PROJ(projLife),
  name: 'lifecycle-poster',
  type: 'poster',
}, (r) => {
  // either success (auto-rename) or graceful fail — bug only if it crashes (HTTP !=200)
  if (r.http !== 200) return `HTTP ${r.http}`;
  return true;
});

await runScenario('edge: apply_theme unknown', 'apply_theme', {
  project_path: PROJ(proj5),
  theme_id: 'totally-fake-theme',
}, expectGracefulFail);

await runScenario('edge: missing required arg (create_project no path)', 'create_project', {
  name: 'noPath',
}, expectGracefulFail);

// ═══════════════════════════════════════════════════════════════════════
// Summary, write artefacts, capture mcp.log tail
// ═══════════════════════════════════════════════════════════════════════
const pass = results.filter(r => r.ok).length;
const fail = results.filter(r => !r.ok).length;
const total = results.length;
console.log(`\n── SUMMARY ────────────────────────────`);
console.log(`Scenarios: ${total}   Pass: ${pass}   Fail: ${fail}`);
console.log(`Pass rate: ${((pass / total) * 100).toFixed(1)}%`);

await fsp.writeFile(path.join(REPORT_DIR, 'results.json'), JSON.stringify({
  ts: new Date().toISOString(),
  base: BASE,
  total, pass, fail,
  results,
}, null, 2));

const problems = results.filter(r => !r.ok);
await fsp.writeFile(path.join(REPORT_DIR, 'problems.json'), JSON.stringify({
  ts: new Date().toISOString(),
  count: problems.length,
  problems,
}, null, 2));

// Build issues entries from non-edge-case failures
const failuresExcludingEdges = results.filter(r => !r.ok && !r.label.startsWith('edge:'));
for (const f of failuresExcludingEdges) {
  recordBug('S2', `mcp/${f.tool}`, f.label, `Tool returned ok=false: ${f.error || 'unknown'}`);
}

// Append to issues.md
if (newBugs.length > 0) {
  const existing = fs.existsSync(ISSUES_FILE) ? await fsp.readFile(ISSUES_FILE, 'utf8') : '';
  const block = newBugs.map(b =>
    `| ${b.id} | ${b.sev} | ${b.area} | ${b.scenarioLabel} | ${b.description.replace(/\n/g, ' ')} | open |`
  ).join('\n') + '\n';
  // Insert under "## Active" table — append to the table block
  let updated;
  if (existing.includes('## Active')) {
    // Append after the last existing pipe-row in active section
    const lines = existing.split('\n');
    let activeIdx = lines.findIndex(l => l.trim() === '## Active');
    let insertAt = lines.length;
    for (let i = activeIdx + 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) { insertAt = i; break; }
    }
    // Walk back from insertAt to skip blank lines / find last table row
    let j = insertAt - 1;
    while (j > activeIdx && lines[j].trim() === '') j--;
    lines.splice(j + 1, 0, ...block.split('\n').filter(Boolean));
    updated = lines.join('\n');
  } else {
    updated = existing + '\n\n## Active\n\n' + block;
  }
  await fsp.writeFile(ISSUES_FILE, updated);
  console.log(`Appended ${newBugs.length} bug(s) to ${ISSUES_FILE}`);
}

// Snapshot last 50 lines of /tmp/mcp.log
try {
  const log = await fsp.readFile('/tmp/mcp.log', 'utf8');
  const tail = log.split('\n').slice(-50).join('\n');
  await fsp.writeFile(path.join(REPORT_DIR, 'mcp-server-log-tail.txt'), tail);
  console.log('Captured mcp-server-log-tail.txt');
} catch (e) {
  console.log('Could not read /tmp/mcp.log:', e.message);
}

console.log(`\nReport dir: ${REPORT_DIR}`);
process.exit(fail > 0 ? 1 : 0);

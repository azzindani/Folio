// manage_design {op:"icon_search"} — find a real icon name before drawing one.
//
// An unknown icon name renders as a blank fallback circle: the design looks
// finished and is quietly missing its glyphs, and the model cannot see it. The
// only recourse was to guess, read the warning, and guess again — a loop per
// icon. This op turns guessing into a lookup: search the bundled set, get ranked
// names back, and confirm whether a name you already have resolves.
//
// Pure — no I/O. Ranking is exact > prefix > word-boundary > substring > token
// overlap, so "shopping" surfaces shopping-cart before workshop.
import type { ToolResult } from '../types';
import { ALL_ICON_NAMES, resolveIconName } from '../../renderer/lucide-icons';
import { okResult, pOk, buildContext } from './utils';

/** A representative slice of the set, for a model with no query in mind. */
const STARTER_KINDS: Record<string, string[]> = {
  ui: ['check', 'x', 'plus', 'minus', 'search', 'settings', 'menu', 'filter'],
  arrows: ['arrow-right', 'arrow-up', 'chevron-right', 'trending-up', 'refresh-cw'],
  people: ['user', 'users', 'user-check', 'heart', 'smile'],
  comms: ['mail', 'phone', 'message-circle', 'send', 'bell'],
  data: ['bar-chart', 'pie-chart', 'activity', 'database', 'target'],
  time: ['clock', 'calendar', 'timer', 'history'],
  place: ['map-pin', 'globe', 'compass', 'home', 'building'],
  commerce: ['shopping-cart', 'credit-card', 'tag', 'package', 'truck'],
  status: ['alert-triangle', 'info', 'shield', 'lock', 'zap', 'star', 'award'],
  files: ['file-text', 'folder', 'download', 'upload', 'link', 'image'],
};

// Concept → glyphs. A model searches for the IDEA ("cargo", "revenue",
// "security"); the set is named for the OBJECT (package, trending-up, shield).
// Without this bridge a reasonable query returns nothing and the model is back
// to guessing, which is the failure this op exists to remove.
const CONCEPTS: Record<string, string[]> = {
  cargo: ['package', 'truck', 'ship', 'plane', 'box', 'warehouse'],
  freight: ['truck', 'package', 'ship', 'train'],
  logistics: ['truck', 'package', 'map-pin', 'route', 'warehouse'],
  shipping: ['ship', 'truck', 'package', 'anchor'],
  revenue: ['trending-up', 'dollar-sign', 'bar-chart', 'wallet'],
  growth: ['trending-up', 'bar-chart', 'arrow-up', 'sprout'],
  decline: ['trending-down', 'arrow-down'],
  money: ['dollar-sign', 'credit-card', 'wallet', 'coins', 'banknote'],
  cost: ['dollar-sign', 'receipt', 'calculator'],
  risk: ['alert-triangle', 'shield', 'activity'],
  security: ['shield', 'lock', 'key', 'fingerprint'],
  speed: ['zap', 'gauge', 'timer', 'rocket'],
  quality: ['award', 'star', 'check-circle', 'badge-check'],
  team: ['users', 'user', 'handshake'],
  customer: ['user', 'users', 'heart', 'smile'],
  insight: ['lightbulb', 'eye', 'search', 'brain'],
  strategy: ['target', 'compass', 'map', 'flag'],
  process: ['workflow', 'git-branch', 'repeat', 'settings'],
  data: ['database', 'bar-chart', 'table', 'file-text'],
  report: ['file-text', 'clipboard', 'bar-chart'],
  cloud: ['cloud', 'server', 'database'],
  energy: ['zap', 'battery', 'flame', 'sun'],
  climate: ['leaf', 'sun', 'cloud-rain', 'thermometer'],
  health: ['heart', 'activity', 'stethoscope', 'pill'],
  education: ['book', 'graduation-cap', 'school'],
  factory: ['factory', 'settings', 'wrench', 'hammer'],
  ai: ['brain', 'cpu', 'sparkles', 'bot'],
};

function conceptHits(q: string): string[] {
  const set = new Set(ALL_ICON_NAMES);
  const out: string[] = [];
  for (const [concept, glyphs] of Object.entries(CONCEPTS)) {
    if (!q.includes(concept) && !concept.includes(q)) continue;
    for (const g of glyphs) if (set.has(g)) out.push(g);
  }
  return [...new Set(out)];
}

function score(name: string, q: string): number {
  if (name === q) return 100;
  if (name.startsWith(q)) return 80 - name.length * 0.1;
  if (name.includes(`-${q}`) || name.includes(`${q}-`)) return 60 - name.length * 0.1;
  if (name.includes(q)) return 40 - name.length * 0.1;
  const qt = q.split(/[\s-]+/).filter(Boolean);
  const nt = new Set(name.split('-'));
  const shared = qt.filter(t => nt.has(t)).length;
  return shared ? 20 + shared * 5 : 0;
}

/** Search the bundled icon set by name. */
export function iconSearch(a: { query?: string; limit?: number } = {}): ToolResult {
  const op = 'icon_search';
  const names = ALL_ICON_NAMES;
  const limit = Math.max(1, Math.min(a.limit ?? 30, 120));
  const q = (a.query ?? '').trim().toLowerCase();

  if (!q) {
    return okResult(op, {
      total: names.length,
      by_kind: STARTER_KINDS,
      usage: 'manage_design {op:"icon_search", query:"cargo"} ranks matching names. Icons inherit the layer `color` (default currentColor) — set it to your accent on a dark canvas.',
      progress: [pOk(`${names.length} icons bundled`, 'lucide set')],
      context: buildContext(op, `Icon catalog — ${names.length} names`),
    });
  }

  // The name the model already has: say whether it renders, and to what.
  const resolved = resolveIconName(q);
  const ranked = names
    .map(n => ({ name: n, s: score(n, q) }))
    .filter(r => r.s > 0)
    .sort((x, y) => y.s - x.s)
    .slice(0, limit)
    .map(r => r.name);

  const concepts = conceptHits(q);
  const merged = [...new Set([...(resolved ? [resolved] : []), ...ranked, ...concepts])].slice(0, limit);
  // Never answer with an empty list: a dead end sends the model back to guessing,
  // which is the loop this op removes. Fall back to the starter set.
  const matches = merged.length ? merged : Object.values(STARTER_KINDS).flat();
  return okResult(op, {
    query: q,
    resolves_to: resolved ?? null,
    total: matches.length,
    icons: matches,
    ...(concepts.length ? { by_concept: concepts } : {}),
    ...(resolved
      ? {}
      : { note: `"${q}" is not itself a bundled icon — that name would render as a blank fallback circle. Pick one of the names above${merged.length ? '' : ' (nothing matched, so these are the common ones)'}. Icons take the layer \`color\` (currentColor by default) — set it explicitly on a dark canvas.` }),
    progress: [pOk(`${matches.length} match(es) for "${q}"`, resolved ? `"${q}" resolves to "${resolved}"` : 'no direct resolution')],
    context: buildContext(op, `Icon search "${q}" — ${matches.length} match(es)`),
  });
}

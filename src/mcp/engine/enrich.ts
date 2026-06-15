// enrich_brief — turn a THIN prompt ("a poster about remote work") into a rich
// content PLAN so a vision-less model doesn't ship sparse designs. The engine is
// deterministic (no LLM/web), so it injects STRUCTURE + a research DIRECTIVE: it
// infers the best preset, a dense block outline, a topic-matched bg_style/palette,
// and — when the topic is factual — the web-research queries the model should run
// FIRST (so figures are real, not invented). The model does the research + writing.
import type { ToolResult, ProgressItem } from '../types';
import { okResult, pOk, pInfo, buildContext, buildHandover } from './utils';
import { pickMoodVariant, proceduralBgStyle, isDarkHex, type Mood } from './mood-bank';


// Per-preset rich outline + recommended canvas. Each entry the model fills with
// researched, specific content — the counts are the "richness floor".
const OUTLINES: Record<string, { canvas: [number, number]; blocks?: string[]; fields?: string[]; preset?: string }> = {
  sections: { canvas: [1080, 2000], blocks: [
    'stats — a row of 4 key figures {value,label} (REAL researched numbers)',
    'heading + text — sub-theme #1, heading + 2-3 sentences',
    'heading + text — sub-theme #2, heading + 2-3 sentences',
    'heading + text — sub-theme #3, heading + 2-3 sentences',
    'a data viz — pick what the data IS: bars {label,value} for a ranking, donut {label,value} for a share/breakdown (parts of a whole, %), or line {x,y} for a trend over time (all rasterize)',
    'callout {label,text} — the single key takeaway',
    'source — cite the research source' ] },
  // A PROCESS / WORKFLOW / "how X moves through Y" poster — still a sections preset,
  // but its spine is a flow block the engine draws as numbered nodes joined by arrows
  // (never a plain list, never hand-placed circles/boxes that overlap).
  process: { canvas: [1080, 1920], preset: 'sections', blocks: [
    'a flow block {kind:"flow", items:[{title, desc}]} — 4-7 SEQUENTIAL steps, each a 1-3 word title + a one-sentence desc; the engine draws numbered nodes connected by arrows so steps never collide',
    'callout {label,text} — why the flow matters or the single key insight' ] },
  feature_grid: { canvas: [1080, 1080], fields: ['title', 'subtitle (one line)', 'items — 4-5 cards {icon, title, 1-line desc}'] },
  stat: { canvas: [1080, 1350], fields: ['kicker — short eyebrow label', 'stat — the ONE big figure (researched, e.g. "$37B" / "9.4 hrs")', 'caption — a FULL sentence of context, 12-25 words (NOT a 2-3 word fragment)', 'footer — REQUIRED: cite a real source'] },
  list: { canvas: [1080, 1350], fields: ['kicker', 'title', 'items — 5-8 {title, desc}', 'footer'] },
  event: { canvas: [1080, 1350], fields: ['kicker', 'title', 'details — [date, venue, time]', 'footer'] },
  split: { canvas: [1200, 800], fields: ['panel_label', 'kicker', 'title (headline)', 'subtitle (deck)'] },
  editorial: { canvas: [1080, 1350], fields: ['kicker', 'title', 'subtitle (deck)', 'body — supporting paragraph', 'footer'] },
};

function inferType(p: string): string {
  if (/\b(\d+|five|six|seven|eight|nine|ten)\s+(tips|steps|ways|reasons|rules|habits|lessons|principles|mistakes|tactics)\b/i.test(p)) return 'list';
  // A PROCESS / sequence — render as a connected flow diagram, not a bullet list.
  if (/\b(process|workflow|pipeline|life\s?cycle|journey|funnel|roadmap|stages?\b|how (?:a|an|the|it)\b.*\b(?:works?|flows?|moves?|happens?|goes?)|step.?by.?step|from .{2,40}? to .{2,40}?\b)\b/i.test(p)) return 'process';
  // A product/app/tool poster is a FEATURE grid, even when phrased as a "launch"
  // — don't let the ambiguous word "launch" route it to the EVENT preset (which
  // then ships a placeholder "EVENT" title when the model gives no event title).
  const hasProduct = /\b(product|app|tool|platform|saas|software|feature|features|extension|plugin|widget|library|framework)\b/i.test(p);
  if (!hasProduct && /\b(event|flyer|launch|party|gig|concert|webinar|meetup|conference|festival|workshop|summit|expo|gala|ceremony|fundraiser|gathering)\b/i.test(p)) return 'event';
  if (/\b(vs\.?|versus|comparison|compare|case study|before and after)\b/i.test(p)) return 'split';
  if (/\b(feature|features|product|app|tool|platform|benefits|capabilities|why choose|launch)\b/i.test(p)) return 'feature_grid';
  if (/\b(\d+%|one (stat|number|figure)|single (stat|number))\b/i.test(p) && !/\b(report|trends|state of|overview)\b/i.test(p)) return 'stat';
  if (/\b(report|state of|trends|overview|infographic|landscape|guide to|breakdown|analysis|deep dive|annual)\b/i.test(p)) return 'sections';
  return 'sections';
}

// Strip framing verbs/nouns to get the bare subject for research queries.
function subjectOf(p: string): string {
  return p.replace(/\b(make|create|design|build|generate|produce|draft)\b/gi, '')
    .replace(/\b(an?|the|a)\b/gi, ' ')
    .replace(/\b(poster|infographic|report|flyer|design|graphic|slide|deck|page|about|on|for|titled?)\b/gi, ' ')
    .replace(/["'.]/g, ' ').replace(/\s+/g, ' ').trim() || p.trim();
}

function needsResearch(p: string, type: string): boolean {
  if (type === 'event') return false; // flyers carry their own given details
  if (type === 'stat') return true;   // a stat poster is nothing without a real figure
  // Otherwise research only when the topic genuinely calls for live facts — NOT
  // every sections poster. Forcing research on "history of neon signs" produced
  // the nonsense "…market size growth data" query; let knowledge topics write
  // from knowledge and reserve web lookups for data/trend/report topics.
  return /\b(20\d\d|state of|trends?|statistic|data|market|report|study|survey|industry|growth|adoption|landscape|forecast|index|benchmark|rate|percent|%|how many|number of|spending|impact|comparison)\b/i.test(p);
}

// Sensible, topic-agnostic research queries. The old set hard-coded "market size
// growth data", which read as nonsense for non-market topics; these fit any
// subject while still steering toward real, sourced facts.
function researchQueries(subject: string): string[] {
  return [
    `${subject} key facts and figures`,
    `${subject} recent statistics 2026`,
    `${subject} notable examples and details`,
    `${subject} expert sources and reports`,
  ];
}

// ── Carousel / multi-page deck planning ─────────────────────
function isCarousel(p: string, type?: string): boolean {
  if (type === 'carousel') return true;
  return /\b(carousel|deck|slides?|slideshow|presentation|multi-?page|story|thread|onboarding|walkthrough|step-by-step|series|\d+\s*(slides?|pages?|cards?))\b/i.test(p);
}
function parsePageCount(p: string): number {
  const m = p.match(/\b(\d+)\s*(slides?|pages?|cards?|parts?)\b/i) ?? p.match(/\b(\d+)[- ]?(slide|page|part)\b/i);
  const n = m ? parseInt(m[1], 10) : NaN;
  return Number.isFinite(n) ? Math.max(3, Math.min(10, n)) : 5;
}
// A social "carousel" reads portrait; a "presentation/deck/slideshow" reads
// landscape. "carousel" wins when both appear (e.g. "6-slide carousel").
function carouselCanvas(p: string): [number, number] {
  if (/\b(carousel|instagram|linkedin|social|tiktok|story)\b/i.test(p)) return [1080, 1350];
  if (/\b(presentation|slideshow|deck|keynote|slides?)\b/i.test(p)) return [1920, 1080];
  return [1080, 1350];
}

interface PageSpec { role: string; label: string; preset: string; hints: string; }
// A cohesive deck arc: cover → context → N focused content slides → data/proof
// → takeaway/CTA. Each page is ONE preset layer (a slide = one clear message,
// NOT a dense infographic). Presets vary by role; the mood stays constant.
function planPages(subject: string, count: number, mood: Mood): PageSpec[] {
  // EVERY page = ONE engine preset layer (editorial or sections). Never hand-place
  // text/stats/charts on a slide — that is the #1 carousel failure (icons over
  // words, bar values overflowing, weak hierarchy). Presets own the layout.
  // Bake the shared style INTO every hint so the model copies bg_style verbatim
  // onto each page (a thin model otherwise drops bg_style and ships flat slides).
  const STYLE = `Set bg_style:"${mood.bg_style}", bg:"${mood.bg}", accent:"${mood.accent}", text_color:"${mood.text_color}" on this layer — IDENTICAL on every page for a cohesive deck.`;
  const ONE = `Build this slide as ONE preset layer — do NOT hand-place any text, stat, icon or chart (they collide and the hierarchy goes flat). ${STYLE}`;
  const pages: PageSpec[] = [];
  pages.push({ role: 'cover', label: 'Cover', preset: 'editorial', hints: `editorial preset (ONE layer): a kicker, a BOLD title naming the topic ("${subject}"), a one-line deck. ${ONE}` });
  const middle = count - 2; // reserve cover + closing
  const hasData = middle >= 3;
  const contentSlots = hasData ? middle - 1 : middle;
  if (count >= 4) pages.push({ role: 'context', label: 'Why it matters', preset: 'editorial', hints: `editorial preset (ONE layer): one big title + a 2-3 sentence deck framing why this matters now. ${ONE}` });
  const bodySlots = Math.max(1, contentSlots - (count >= 4 ? 1 : 0));
  for (let i = 0; i < bodySlots; i++) {
    pages.push({ role: 'content', label: `Key point ${i + 1}`, preset: 'sections',
      hints: `ONE sections layer, FOCUSED (2-4 blocks): a {kind:heading} + a {kind:text} of 2-3 sentences, optionally ONE {kind:callout}. One idea per slide — don't overfill. ${ONE}` });
  }
  if (hasData) pages.push({ role: 'data', label: 'By the numbers', preset: 'sections',
    hints: `ONE sections layer: a {kind:stats} row of 3-4 REAL figures (keep each value SHORT like "55%" or "15M"; put the words in the label, e.g. value:"55%" label:"of China car sales") + a {kind:bars} ranked comparison (numeric values). ${ONE}` });
  pages.push({ role: 'closing', label: 'Takeaway', preset: 'sections',
    hints: `ONE sections layer: a {kind:stats} row of the 2-3 headline projections (SHORT values) + a {kind:callout} with the takeaway/CTA, and a {kind:source} credit. ${ONE}` });
  return pages.slice(0, count);
}

export function enrichBrief(args: { prompt?: string; type?: string; variant?: number }): ToolResult {
  const op = 'enrich_brief';
  const progress: ProgressItem[] = [];
  const prompt = (args.prompt ?? '').trim();
  if (!prompt) {
    return okResult(op, { error_hint: 'Pass a prompt (a short topic/intent).', progress: [pInfo('No prompt given')] });
  }
  // variant N ⇒ the Nth DISTINCT art-direction of the SAME topic — for "give me
  // N options". 0 = the topic-apt default (unchanged); >0 rotates palette +
  // treatment + (via the variant-salted seed) background geometry.
  const variant = Math.max(0, Math.floor(Number(args.variant) || 0));
  const vSeed = (s: string): string => (variant ? `${s}#v${variant}` : s);
  // Multi-page deck / carousel → a per-page plan instead of one design.
  if (isCarousel(prompt, args.type)) {
    const subject = subjectOf(prompt);
    const cBase = pickMoodVariant(prompt, subject, variant);
    // One procedural recipe seeded by the subject, shared across all pages.
    const mood: Mood = { ...cBase, bg_style: proceduralBgStyle(vSeed(subject), isDarkHex(cBase.bg)) };
    const count = parsePageCount(prompt);
    const [cw, ch] = carouselCanvas(prompt);
    const research = needsResearch(prompt, 'sections');
    const research_queries = research ? researchQueries(subject) : [];
    const pages = planPages(subject, count, mood);
    const research_instruction = research
      ? 'Factual topic: FIRST run the research_queries with your web tools for REAL figures. Do NOT invent statistics.'
      : 'No external research needed — use the details in the prompt.';
    const instruction = `${research_instruction} Build a ${count}-page CAROUSEL. Put the SAME bg_style:"${mood.bg_style}", bg:"${mood.bg}", accent:"${mood.accent}", text_color:"${mood.text_color}", palette:${JSON.stringify(mood.palette)} on EVERY page (set them on each page's preset layer) for a cohesive deck. Flow: create_task with width:${cw}, height:${ch} and the pages below (label + hints), then append_page per page passing layers_shorthand as a real JSON ARRAY of ONE preset object (editorial or sections) per its hints — NEVER hand-place text/stats/icons/charts on a slide (they collide). Each page's preset MUST carry the bg_style/bg/accent/text_color above. Keep stat VALUES short ("55%", "15M"); put descriptions in the label. One clear message per slide. Then run diagnose_design on the WHOLE design; if ANY page reports errors, replace that page's layers with a single preset layer and re-diagnose. Do NOT seal_design until EVERY page is error-free.`;
    progress.push(pOk(`Planned a ${count}-page carousel`, research ? `${research_queries.length} research queries` : 'no research needed'));
    const context = buildContext(op, `Enriched brief → ${count}-page carousel`);
    const handover = buildHandover('DESIGN', {}, { type: 'carousel' });
    return okResult(op, {
      output_type: 'carousel', topic: subject, page_count: count, variant,
      needs_research: research, research_queries, research_instruction,
      pages, suggested: { ...mood, width: cw, height: ch }, canvas: { width: cw, height: ch },
      instruction, progress, context, handover,
    });
  }
  const design_type = (args.type && OUTLINES[args.type]) ? args.type : inferType(prompt);
  const outline = OUTLINES[design_type] ?? OUTLINES.sections;
  const subject = subjectOf(prompt);
  const base = pickMoodVariant(prompt, subject, variant);
  // Procedural geometry seeded by the topic (+variant) — keeps a curated colour
  // but varies the background so two posters in the same colour mood, or two
  // variants of one topic, don't look alike.
  const mood: Mood = { ...base, bg_style: proceduralBgStyle(vSeed(subject || prompt), isDarkHex(base.bg)) };
  const research = needsResearch(prompt, design_type);
  const research_queries = research ? researchQueries(subject) : [];
  const [width, height] = outline.canvas;

  const research_instruction = research
    ? 'This topic is factual: FIRST run the research_queries with your web tools to gather REAL figures and specifics. Do NOT invent statistics. Then compose.'
    : 'No external research needed — use the details in the prompt.';
  const presetType = outline.preset ?? design_type;
  const fill = outline.blocks
    ? `Add ONE layer — layers_shorthand:[{type:"${presetType}", kicker:"<a 1-3 word eyebrow label>", title:"<a punchy ≤6-word HEADLINE naming the topic>", subtitle:"<a 2-sentence intro deck>", …, blocks:[…]}]. The kicker + title + subtitle go on the LAYER ITSELF (a titleless deck looks unfinished); then a blocks array covering: ${outline.blocks.join(' · ')}. Emit EVERY block listed — a thin 1-2 block deck is the exact "sparse / dead space" failure to avoid. NEVER hand-place separate text/stat/icon layers (they collide and you loop).`
    : `Add ONE layer — layers_shorthand:[{type:"${presetType}", …}] supplying: ${(outline.fields ?? []).join(' · ')}. NEVER hand-place separate title/body/text layers — the preset auto-sizes every block so text never collides.`;
  const instruction = `${research_instruction} ${fill} Create the design at EXACTLY ${width}×${height}px (use these dimensions — do not default to a square). Set bg_style:"${mood.bg_style}", bg:"${mood.bg}", accent:"${mood.accent}", text_color:"${mood.text_color}", font:"${mood.font}", headline_style:"${mood.headline}", palette:${JSON.stringify(mood.palette)} (bg_style is a GEOMETRIC recipe — copy it verbatim; font is the display face; headline_style is the title treatment — highlight/underline/mega/rotate/rule). Fill EVERY slot with specific, dense content — this is the richness floor, add more blocks if the topic warrants. A thin fragment where a full sentence belongs, or a missing source/footer, is the difference between a flat poster and a designed one — write real sentences and ALWAYS include the source. Then diagnose_design until clean and seal.`;

  progress.push(pOk(`Planned a "${design_type}" design`, research ? `${research_queries.length} research queries` : 'no research needed'));
  const context = buildContext(op, `Enriched brief → ${design_type}${research ? ' (research first)' : ''}`);
  const handover = buildHandover('DESIGN', {});
  return okResult(op, {
    output_type: 'poster', topic: subject, design_type, variant, needs_research: research, research_queries, research_instruction,
    outline: outline.blocks ?? outline.fields, suggested: { ...mood, width, height },
    canvas: { width, height }, instruction, progress, context, handover,
  });
}

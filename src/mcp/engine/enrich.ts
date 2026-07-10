// enrich_brief — turn a THIN prompt ("a poster about remote work") into a rich
// content PLAN so a vision-less model doesn't ship sparse designs. The engine is
// deterministic (no LLM/web), so it injects STRUCTURE + a research DIRECTIVE: it
// infers the best preset, a dense block outline, a topic-matched bg_style/palette,
// and — when the topic is factual — the web-research queries the model should run
// FIRST (so figures are real, not invented). The model does the research + writing.
import type { ToolResult, ProgressItem } from '../types';
import { okResult, pOk, pInfo, buildContext, buildHandover, resolveProjectPath } from './utils';
import { pickMoodVariant, proceduralBgStyle, isDarkHex, type Mood } from './mood-bank';
import { isMinimalGuidance } from '../guidance-mode';
import { readAssetManifest } from './assets';


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
  // PRICING — a sections preset whose body is a pricing block (even tier columns).
  pricing: { canvas: [1080, 1350], preset: 'sections', blocks: [
    'a pricing block {kind:"pricing", items:[{name, price, period, features:[...], highlight}]} — 2-4 tiers, each a name + a price + a period (e.g. "/mo") + 3-5 features, with highlight:true on the recommended tier; the engine lays out even columns',
    'callout {label,text} — which plan fits whom' ] },
  // A dated HISTORY — a sections preset whose spine is a timeline block (date column
  // + rail + node per milestone), never a plain list or hand-placed dots.
  timeline: { canvas: [1080, 1920], preset: 'sections', blocks: [
    'a timeline block {kind:"timeline", items:[{date, title, desc}]} — 5-7 dated milestones in order, each a date + a short title + a one-sentence desc; the engine draws a rail with a node per milestone',
    'callout {label,text} — where it is headed next, or the through-line' ] },
  // An "X vs Y" comparison — a sections preset whose spine is a versus block the
  // engine lays out as two columns + a divider (never a hand-placed colliding table).
  comparison: { canvas: [1080, 1350], preset: 'sections', blocks: [
    'a versus block {kind:"versus", a_label:"<option A>", b_label:"<option B>", rows:[{label:"<aspect>", a:"<A value>", b:"<B value>"}]} — compare 4-6 aspects side by side; the engine draws two columns + a center divider, measured so nothing collides',
    'callout {label,text} — the verdict: which to pick, and when' ] },
  process: { canvas: [1080, 1920], preset: 'sections', blocks: [
    'a flow block {kind:"flow", items:[{title, desc}]} — 4-7 SEQUENTIAL steps, each a 1-3 word title + a one-sentence desc; the engine draws numbered nodes connected by arrows so steps never collide',
    'callout {label,text} — why the flow matters or the single key insight' ] },
  feature_grid: { canvas: [1080, 1080], fields: ['title', 'subtitle (one line)', 'items — 4-5 cards {icon, title, 1-line desc}'] },
  // MIND MAP — a hub + branches; the engine draws the radial spokes or staggered
  // card chain + curved connectors + scattered doodles. NOT a flat list.
  mindmap: { canvas: [1080, 1400], preset: 'mindmap', fields: ['title — the CENTER topic', 'layout — "spokes" (radial hub) or "chain" (staggered cards)', 'items — 4-6 branches {title, desc (one sentence)}'] },
  // NEWSLETTER — bordered masthead + lead note + a masonry of section boxes + footer.
  newsletter: { canvas: [1080, 1530], preset: 'newsletter', fields: ['title (masthead)', 'subtitle', 'date', 'intro — a lead welcome note', 'sections — 4-6 boxes {title, desc OR bullets:[…]}; mark one wide:true', 'footer'] },
  // BRAND VALUES — big rotated margin numbers, heading + body, dashed dividers.
  value_list: { canvas: [1080, 1530], preset: 'value_list', fields: ['kicker (e.g. "these are our")', 'title', 'brand — a company tag (top-right)', 'items — 4-6 {title, desc}'] },
  stat: { canvas: [1080, 1350], fields: ['kicker — short eyebrow label', 'stat — the ONE big figure (researched, e.g. "$37B" / "9.4 hrs")', 'caption — a FULL sentence of context, 12-25 words (NOT a 2-3 word fragment)', 'footer — REQUIRED: cite a real source'] },
  list: { canvas: [1080, 1350], fields: ['kicker', 'title', 'items — 5-8 {title, desc}', 'footer'] },
  event: { canvas: [1080, 1350], fields: ['kicker', 'title', 'details — [date, venue, time]', 'footer'] },
  split: { canvas: [1200, 800], fields: ['panel_label', 'kicker', 'title (headline)', 'subtitle (deck)'] },
  editorial: { canvas: [1080, 1350], fields: ['kicker', 'title', 'subtitle (deck)', 'body — supporting paragraph', 'footer'] },
};

// When a brief routes to `sections` but is NOT data/research-driven (a personal
// note, a non-numeric explainer, anything that slipped past event/editorial
// routing), use a QUALITATIVE outline — prose blocks only, NO forced stats row,
// chart or "Source:" line. This is the safety net against fabrication: a "congrats
// on the new job" card must never sprout a donut chart of someone's "Humour 10%".
const SECTIONS_QUALITATIVE: string[] = [
  'intro — a 2-3 sentence framing of the topic',
  'heading + text — facet #1, a heading + 2-3 sentences',
  'heading + text — facet #2, a heading + 2-3 sentences',
  'heading + text — facet #3, a heading + 2-3 sentences',
  'callout {label,text} — the single warm takeaway (NO stats, NO chart, NO source)',
];

// Map a topic to a decorative motif that fits it, for filling negative space.
function motifForTopic(s: string): string {
  const t = s.toLowerCase();
  if (/lightning|storm|thunder|electric|energy|power|spark|volt|charge|battery/.test(t)) return 'bolt';
  if (/wave|ocean|water|sound|audio|music|fluid|flow|signal|radio|climate|tide/.test(t)) return 'waves';
  if (/space|planet|orbit|atom|science|physics|network|molecule|star|cosmos|astronom|chemistry/.test(t)) return 'orbit';
  if (/mountain|growth|climb|peak|summit|outdoor|hike|finance|revenue|increase|trend|invest|market/.test(t)) return 'peaks';
  if (/tech|circuit|chip|digital|computer|electronic|hardware|\bai\b|data|code|software|cyber|robot/.test(t)) return 'circuit';
  if (/\bsun\b|solar|shine|burst|launch|optimis|bright|spotlight|award/.test(t)) return 'rays';
  return 'arcs';
}

function inferType(p: string): string {
  // MIND MAP / brainstorm — a hub + branches (radial) or a linked card chain. Checked
  // first so "mind map of X" / "brainstorm" never falls through to a flat list.
  if (/\b(mind ?map|mindmap|brainstorm|concept ?map|idea map|spider ?(?:diagram|map)|web of ideas)\b/i.test(p)) return 'mindmap';
  // NEWSLETTER / bulletin — bordered masthead + masonry of section boxes.
  if (/\b(newsletter|bulletin|gazette|digest|community update|monthly update|news ?letter)\b/i.test(p)) return 'newsletter';
  // BRAND / company VALUES — a big-margin-number list (the "Brand Values" flyer).
  if (/\b(brand values|core values|company values|our values|guiding principles|code of conduct|mission and values)\b/i.test(p)) return 'value_list';
  if (/\b(\d+|five|six|seven|eight|nine|ten)\s+(tips|steps|ways|reasons|rules|habits|lessons|principles|mistakes|tactics)\b/i.test(p)) return 'list';
  // PRICING tiers — a sections preset with a pricing block (even tier columns).
  if (/\b(pricing|price table|pricing tiers?|subscription (?:plans?|tiers?)|plans? and pricing|tiers? and pricing)\b/i.test(p)) return 'pricing';
  // A dated HISTORY — render as a timeline (date column + rail), not a flow. Checked
  // BEFORE process so "roadmap"/"the journey of X" with dates routes here.
  if (/\b(timeline|milestones?|roadmap|history of|the (?:story|journey|history|evolution) of|over the years|through the years|chronology|evolution of|year by year|founded in)\b/i.test(p)) return 'timeline';
  // A PROCESS / sequence — render as a connected flow diagram, not a bullet list.
  if (/\b(process|workflow|pipeline|life\s?cycle|journey|funnel|roadmap|stages?\b|how (?:a|an|the|it)\b.*\b(?:works?|flows?|moves?|happens?|goes?)|step.?by.?step|from .{2,40}? to .{2,40}?\b)\b/i.test(p)) return 'process';
  // A product/app/tool poster is a FEATURE grid, even when phrased as a "launch"
  // — don't let the ambiguous word "launch" route it to the EVENT preset (which
  // then ships a placeholder "EVENT" title when the model gives no event title).
  const hasProduct = /\b(product|app|tool|platform|saas|software|feature|features|extension|plugin|widget|library|framework)\b/i.test(p);
  if (!hasProduct && /\b(event|flyer|launch|party|gig|concert|webinar|meetup|conference|festival|workshop|summit|expo|gala|ceremony|fundraiser|gathering|play|musical|recital|theatre|theater|drama|screening|premiere|matinee|showcase|exhibition|exhibit|ballet|opera|pantomime|cabaret|stand[- ]?up|open mic|talent show|variety show|comedy night|fashion show|art show|magic show|puppet show|fete|carnival|parade|reunion|rally)\b/i.test(p)) return 'event';
  // A real-world MARKET / FAIR / BAZAAR (craft/artisan/farmers/flea/night/holiday…)
  // is an event-POSTER, not a data infographic — but bare "market" is reserved for
  // finance/research (a "market report"), so require an event-flavoured qualifier.
  // Without this, "an artisan market poster" fell through to sections and the model
  // fabricated a stats row + a donut chart ("Plant Goods 60%") to fill the skeleton.
  if (/\b(?:(?:artisan|farmers?|flea|night|makers?|christmas|holiday|street|vintage|food|antique|sunday|weekend|pop[- ]?up|swap|record|plant|garden|vinyl)\s+(?:market|fair|bazaar|fayre)|craft\s+(?:market|fair|fayre)|street fair|county fair|village fair|fun ?fair|book fair|art fair|\bbazaar\b|\bfayre\b)\b/i.test(p)) return 'event';
  if (/\b(case study|before and after)\b/i.test(p)) return 'split';
  if (/\b(vs\.?|versus|comparison|compare|head[ -]?to[ -]?head|which is better|pros and cons)\b/i.test(p)) return 'comparison';
  if (/\b(feature|features|product|app|tool|platform|benefits|capabilities|why choose|launch)\b/i.test(p)) return 'feature_grid';
  if (/\b(\d+%|one (stat|number|figure)|single (stat|number))\b/i.test(p) && !/\b(report|trends|state of|overview)\b/i.test(p)) return 'stat';
  // An ANNOUNCEMENT / NOTICE / CELEBRATION / SIGN — a poster, NOT an infographic.
  // These carry their own details (a name, a date, a line), so route to the light
  // EVENT preset (kicker/title/details/footer). WITHOUT this they fell through to
  // sections and the model fabricated a stats row + a pie chart + a "Source:" line
  // to fill the dense skeleton (a save-the-date with a donut chart of "Love 40%").
  if (/\b(save[ -]the[ -]date|wedding|vow renewal|engagement|anniversary|birthday|happy \d+|\d+th|baby shower|graduation|christening|invite|invitation|rsvp|announc|now open|grand opening|opening|reopening|sold out|back in stock|now hiring|we'?re hiring|hiring|lost|missing|found|reward|garage sale|yard sale|\bsale\b|% off|promo|coupon|discount|vote|polling|congrat\w*|thank you|farewell|leaving|goodbye|good luck|bon voyage|retire|memorial|in memoriam|open day|open studio|sign|notice|menu|special of the day|greeting|\bcard\b|film club|book club|movie night|film night|cinema night|potluck|housewarming)\b/i.test(p)) return 'event';
  // An ESSAY / OPINION / QUOTE / COVER — a typographic editorial poster, not an
  // infographic. ("story" is omitted on purpose — an instagram STORY is a format,
  // not an essay, and would mis-route.)
  if (/\b(editorial|opinion|essay|manifesto|think[ -]?piece|standfirst|quote|lyric|slogan|poem|poetry|brand story|founder'?s letter|book cover|album cover|magazine cover|zine cover|teaser|cover reveal)\b/i.test(p)) return 'editorial';
  // Default: a content-DENSE explainer/report (the sections preset). Reserved for
  // genuinely informational topics now that announcements/celebrations route to
  // EVENT and essays/quotes/covers route to EDITORIAL above — so a save-the-date
  // or a bakery sign no longer fabricates a stats row + pie chart + "Source:" line.
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

export function enrichBrief(args: { prompt?: string; type?: string; variant?: number; project_path?: string }): ToolResult {
  const op = 'enrich_brief';
  const progress: ProgressItem[] = [];
  const prompt = (args.prompt ?? '').trim();
  if (!prompt) {
    return okResult(op, { error_hint: 'Pass a prompt (a short topic/intent).', progress: [pInfo('No prompt given')] });
  }
  // WP-1.4: when the target project already holds uploaded assets, say so UP
  // FRONT — a blind model won't discover them mid-composition, and a real
  // photo/logo beats any procedural background. Purely additive: no
  // project_path (the common "no project yet" case) changes nothing.
  let assetClause = '';
  let assetSummary: { images: number; icons: number; fonts: number } | undefined;
  if (args.project_path) {
    try {
      const manifest = readAssetManifest(resolveProjectPath(args.project_path));
      const n = (k: 'images' | 'icons' | 'fonts'): number => manifest[k]?.length ?? 0;
      if (n('images') + n('icons') + n('fonts') > 0) {
        assetSummary = { images: n('images'), icons: n('icons'), fonts: n('fonts') };
        const alts = (manifest.images ?? []).slice(0, 3).map(e => e.alt || e.path.split('/').pop()).join(', ');
        assetClause = ` The project already holds ${assetSummary.images} image(s)${assetSummary.icons ? ` + ${assetSummary.icons} icon(s)` : ''}${alts ? ` (${alts}${(manifest.images?.length ?? 0) > 3 ? ', …' : ''})` : ''} — run manage_design {op:"asset_list"} and PLACE the relevant ones (src:"assets/images/<name>", fit:"cover") instead of leaving the design photo-less.`;
        progress.push(pInfo(`Project has uploaded assets`, `${assetSummary.images} image(s), ${assetSummary.icons} icon(s), ${assetSummary.fonts} font(s)`));
      }
    } catch { /* unreadable project → no clause */ }
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
    const instruction = `${research_instruction} Build a ${count}-page CAROUSEL. Put the SAME bg_style:"${mood.bg_style}", bg:"${mood.bg}", accent:"${mood.accent}", text_color:"${mood.text_color}", palette:${JSON.stringify(mood.palette)} on EVERY page (set them on each page's preset layer) for a cohesive deck. Flow: create_task with width:${cw}, height:${ch} and the pages below (label + hints), then append_page per page passing layers_shorthand as a real JSON ARRAY of ONE preset object (editorial or sections) per its hints — NEVER hand-place text/stats/icons/charts on a slide (they collide). Each page's preset MUST carry the bg_style/bg/accent/text_color above. Keep stat VALUES short ("55%", "15M"); put descriptions in the label. One clear message per slide. Then run diagnose_design on the WHOLE design; if ANY page reports errors, replace that page's layers with a single preset layer and re-diagnose. Do NOT seal_design until EVERY page is error-free.${assetClause}`;
    progress.push(pOk(`Planned a ${count}-page carousel`, research ? `${research_queries.length} research queries` : 'no research needed'));
    const context = buildContext(op, `Enriched brief → ${count}-page carousel`);
    const handover = buildHandover('DESIGN', {}, { type: 'carousel' });
    return okResult(op, {
      output_type: 'carousel', topic: subject, page_count: count, variant,
      needs_research: research, research_queries, research_instruction,
      pages, suggested: { ...mood, width: cw, height: ch }, canvas: { width: cw, height: ch },
      ...(assetSummary ? { project_assets: assetSummary } : {}),
      instruction, progress, context, handover,
    });
  }
  const design_type = (args.type && OUTLINES[args.type]) ? args.type : inferType(prompt);
  let outline = OUTLINES[design_type] ?? OUTLINES.sections;
  const subject = subjectOf(prompt);
  const base = pickMoodVariant(prompt, subject, variant);
  // Procedural geometry seeded by the topic (+variant) — keeps a curated colour
  // but varies the background so two posters in the same colour mood, or two
  // variants of one topic, don't look alike.
  const mood: Mood = { ...base, bg_style: proceduralBgStyle(vSeed(subject || prompt), isDarkHex(base.bg)) };
  const research = needsResearch(prompt, design_type);
  // SAFETY NET: a non-data sections brief gets the qualitative outline (no forced
  // stats/chart/source) so nothing is fabricated even when routing mis-fires.
  if (design_type === 'sections' && !research && outline.blocks) {
    outline = { ...outline, blocks: SECTIONS_QUALITATIVE };
  }
  const research_queries = research ? researchQueries(subject) : [];
  const [width, height] = outline.canvas;

  const research_instruction = research
    ? 'This topic is factual: FIRST run the research_queries with your web tools to gather REAL figures and specifics. Do NOT invent statistics. Then compose.'
    : 'No external research needed — use the details in the prompt.';
  const presetType = outline.preset ?? design_type;
  const fill = outline.blocks
    ? `Add ONE layer — layers_shorthand:[{type:"${presetType}", kicker:"<a 1-3 word eyebrow label>", title:"<a punchy ≤6-word HEADLINE naming the topic>", subtitle:"<a 2-sentence intro deck>", …, blocks:[…]}]. The kicker + title + subtitle go on the LAYER ITSELF (a titleless deck looks unfinished); then a blocks array covering: ${outline.blocks.join(' · ')}. Emit EVERY block listed — a thin 1-2 block deck is the exact "sparse / dead space" failure to avoid. NEVER hand-place separate text/stat/icon layers (they collide and you loop).`
    : `Add ONE layer — layers_shorthand:[{type:"${presetType}", …}] supplying: ${(outline.fields ?? []).join(' · ')}. NEVER hand-place separate title/body/text layers — the preset auto-sizes every block so text never collides.`;
  // A content-dense (blocks-based) poster with LEFT-ANCHORED steps/rows reliably
  // leaves a wide blank column — the blind model won't decorate it on its own, so
  // DIRECT it to add a motif there (BEHIND the text at low z, a tinted illustration
  // that can't collide). But a FULL-WIDTH block layout — a versus table, a pricing
  // grid, a date-railed timeline — spans the whole canvas; directing a motif into
  // the right third drops it straight onto content (the engine then has to remove
  // it). For those, and for minimal/fields posters (editorial/event/stat) that live
  // on their whitespace, the motif stays CONDITIONAL: fill only a genuine gap.
  const motif = motifForTopic(subject);
  const fullWidthLayout = design_type === 'comparison' || design_type === 'pricing' || design_type === 'timeline';
  // DATA presets (a report, an explainer, a single big stat) legitimately cite a
  // source. POSTER presets (event/editorial/feature_grid/list) carry no figures —
  // they must NOT sprout a fabricated stats row / chart / "Source:" line.
  const isDataPreset = design_type === 'sections' || design_type === 'stat' || !!outline.blocks;
  const motifClause = (outline.blocks && !fullWidthLayout)
    ? `THEN add ONE decorative ${motif} motif to fill the open side space (these dense posters leave a wide blank column): append layers_shorthand:[{type:"motif", motif:"${motif}", pos:[${Math.round(width * 0.6)}, ${Math.round(height * 0.34)}, ${Math.round(width * 0.34)}, ${Math.round(height * 0.5)}], color:"${mood.accent}", z:1}] — a composed vector illustration on the right, BEHIND the text (low z) so it can never collide; resize its pos to whatever region the content actually left open.`
    : `IF the finished layout still leaves a large EMPTY band beside left-anchored content, add ONE ${motif} motif there to fill it — layers_shorthand:[{type:"motif", motif:"${motif}", pos:[x,y,w,h], color:"${mood.accent}", z:1}] — but NOT if the design is already full or deliberately minimal (whitespace is fine).`;
  const instruction = `${research_instruction} ${fill} Create the design at EXACTLY ${width}×${height}px (use these dimensions — do not default to a square). Set bg_style:"${mood.bg_style}", bg:"${mood.bg}", accent:"${mood.accent}", text_color:"${mood.text_color}", font:"${mood.font}", headline_style:"${mood.headline}", palette:${JSON.stringify(mood.palette)} (bg_style is a GEOMETRIC recipe — copy it verbatim; font is the display face; headline_style is the title treatment — highlight/underline/mega/rotate/rule). Fill EVERY slot with specific, dense content — this is the richness floor, add more blocks if the topic warrants. A thin fragment where a full sentence belongs is the difference between a flat poster and a designed one — write real sentences${isDataPreset ? ' and ALWAYS include the source.' : ' and fill the footer slot. This is a POSTER (no data) — do NOT add a stats row, a chart, or a "Source:" line; an event/announcement/invite lives on its headline + a few details, not invented figures.'} ${motifClause} Then diagnose_design until clean and seal.${isMinimalGuidance() ? ' [FREE-COMPOSE MODE: the bg_style/bg/accent/font/palette above are OPTIONAL suggestions for smaller models — design by your own judgment instead; choose whatever palette, type + composition you think best and the engine will measure + fit it.]' : ''}${assetClause}`;

  progress.push(pOk(`Planned a "${design_type}" design`, research ? `${research_queries.length} research queries` : 'no research needed'));
  const context = buildContext(op, `Enriched brief → ${design_type}${research ? ' (research first)' : ''}`);
  const handover = buildHandover('DESIGN', {});
  return okResult(op, {
    output_type: 'poster', topic: subject, design_type, variant, needs_research: research, research_queries, research_instruction,
    outline: outline.blocks ?? outline.fields, suggested: { ...mood, width, height },
    ...(assetSummary ? { project_assets: assetSummary } : {}),
    canvas: { width, height }, instruction, progress, context, handover,
  });
}

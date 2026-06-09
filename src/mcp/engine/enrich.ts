// enrich_brief — turn a THIN prompt ("a poster about remote work") into a rich
// content PLAN so a vision-less model doesn't ship sparse designs. The engine is
// deterministic (no LLM/web), so it injects STRUCTURE + a research DIRECTIVE: it
// infers the best preset, a dense block outline, a topic-matched bg_style/palette,
// and — when the topic is factual — the web-research queries the model should run
// FIRST (so figures are real, not invented). The model does the research + writing.
import type { ToolResult, ProgressItem } from '../types';
import { okResult, pOk, pInfo, buildContext, buildHandover } from './utils';

interface Mood { theme: string; bg: string; accent: string; text_color: string; palette: string[]; bg_style: string; }
const MOODS: { test: RegExp; mood: Mood }[] = [
  { test: /\b(ai|ml|tech|software|developer|saas|startup|crypto|web3|cyber|security|data|cloud|api|devops|engineering|robot)/i,
    mood: { theme: 'bold-poster', bg: '#0E0B14', accent: '#7C5CFF', text_color: '#F5F1EA', palette: ['#7C5CFF', '#27C2A0', '#F4B740'], bg_style: 'mesh + glow + grain' } },
  { test: /\b(finance|economy|market|invest|revenue|business|sales|growth|stock|fintech|bank|b2b|saas)/i,
    mood: { theme: 'editorial-cream', bg: '#FAF5EC', accent: '#B8543C', text_color: '#1A1A1A', palette: ['#E0A96D', '#9CAF88', '#6E8BB5'], bg_style: 'gradient + curve + dots' } },
  { test: /\b(health|wellness|medical|nature|climate|environment|sustain|green|food|nutrition|fitness|care)/i,
    mood: { theme: 'editorial-cream', bg: '#F2F0E6', accent: '#3E7C5A', text_color: '#1A1A1A', palette: ['#9CAF88', '#C8B88A', '#6E8BB5'], bg_style: 'gradient:vert + curve + grain' } },
  { test: /\b(art|music|culture|fashion|film|design|creative|festival|gallery|brand|photo)/i,
    mood: { theme: 'bold-poster', bg: '#0A0A0A', accent: '#FF3D00', text_color: '#FAFAFA', palette: ['#FF3D00', '#F4B740', '#3DD4C8'], bg_style: 'mesh + vignette + grain' } },
];
const DEFAULT_MOOD: Mood = { theme: 'editorial-cream', bg: '#FAF5EC', accent: '#B8543C', text_color: '#1A1A1A', palette: ['#E0A96D', '#9CAF88', '#6E8BB5'], bg_style: 'gradient + curve + dots' };

// Per-preset rich outline + recommended canvas. Each entry the model fills with
// researched, specific content — the counts are the "richness floor".
const OUTLINES: Record<string, { canvas: [number, number]; blocks?: string[]; fields?: string[] }> = {
  sections: { canvas: [1080, 2000], blocks: [
    'intro — 2 sentences framing the topic',
    'stats — a row of 4 key figures {value,label} (REAL researched numbers)',
    'heading + text — sub-theme #1, heading + 2-3 sentences',
    'heading + text — sub-theme #2, heading + 2-3 sentences',
    'heading + text — sub-theme #3, heading + 2-3 sentences',
    'bars — a ranked comparison of 4-5 items {label,value}',
    'callout {label,text} — the single key takeaway',
    'source — cite the research source' ] },
  feature_grid: { canvas: [1080, 1080], fields: ['title', 'subtitle (one line)', 'items — 4-5 cards {icon, title, 1-line desc}'] },
  stat: { canvas: [1080, 1350], fields: ['kicker', 'stat — the ONE big figure (researched)', 'caption — one line of context', 'footer — source'] },
  list: { canvas: [1080, 1350], fields: ['kicker', 'title', 'items — 5-8 {title, desc}', 'footer'] },
  event: { canvas: [1080, 1350], fields: ['kicker', 'title', 'details — [date, venue, time]', 'footer'] },
  split: { canvas: [1200, 800], fields: ['panel_label', 'kicker', 'title (headline)', 'subtitle (deck)'] },
  editorial: { canvas: [1080, 1350], fields: ['kicker', 'title', 'subtitle (deck)', 'body — supporting paragraph', 'footer'] },
};

function inferType(p: string): string {
  if (/\b(\d+|five|six|seven|eight|nine|ten)\s+(tips|steps|ways|reasons|rules|habits|lessons|principles|mistakes|tactics)\b/i.test(p)) return 'list';
  if (/\b(event|flyer|launch|party|gig|concert|webinar|meetup|conference|festival|workshop|summit)\b/i.test(p)) return 'event';
  if (/\b(vs\.?|versus|comparison|compare|case study|before and after)\b/i.test(p)) return 'split';
  if (/\b(feature|features|product|app|tool|platform|benefits|capabilities|why choose)\b/i.test(p)) return 'feature_grid';
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
  return /\b(20\d\d|state of|trends?|statistics?|data|market|report|study|survey|industry|growth|adoption|landscape|forecast|index|benchmark|rate|percent|%)\b/i.test(p)
    || type === 'sections' || type === 'stat';
}

export function enrichBrief(args: { prompt?: string; type?: string }): ToolResult {
  const op = 'enrich_brief';
  const progress: ProgressItem[] = [];
  const prompt = (args.prompt ?? '').trim();
  if (!prompt) {
    return okResult(op, { error_hint: 'Pass a prompt (a short topic/intent).', progress: [pInfo('No prompt given')] });
  }
  const design_type = (args.type && OUTLINES[args.type]) ? args.type : inferType(prompt);
  const outline = OUTLINES[design_type] ?? OUTLINES.sections;
  const mood = (MOODS.find(m => m.test.test(prompt))?.mood) ?? DEFAULT_MOOD;
  const research = needsResearch(prompt, design_type);
  const subject = subjectOf(prompt);
  const research_queries = research ? [
    `${subject} key statistics 2026`,
    `${subject} latest trends and figures`,
    `${subject} market size growth data`,
    `notable ${subject} facts and numbers`,
  ] : [];
  const [width, height] = outline.canvas;

  const research_instruction = research
    ? 'This topic is factual: FIRST run the research_queries with your web tools to gather REAL figures and specifics. Do NOT invent statistics. Then compose.'
    : 'No external research needed — use the details in the prompt.';
  const fill = outline.blocks
    ? `Use the "${design_type}" preset with a blocks:[…] array covering: ${outline.blocks.join(' · ')}.`
    : `Use the "${design_type}" preset, supplying: ${(outline.fields ?? []).join(' · ')}.`;
  const instruction = `${research_instruction} ${fill} Set bg_style:"${mood.bg_style}", bg:"${mood.bg}", accent:"${mood.accent}", text_color:"${mood.text_color}", palette:${JSON.stringify(mood.palette)}. Fill EVERY slot with specific, dense content — this is the richness floor, add more blocks if the topic warrants. Then diagnose_design until clean and seal.`;

  progress.push(pOk(`Planned a "${design_type}" design`, research ? `${research_queries.length} research queries` : 'no research needed'));
  const context = buildContext(op, `Enriched brief → ${design_type}${research ? ' (research first)' : ''}`);
  const handover = buildHandover('DESIGN', {});
  return okResult(op, {
    topic: subject, design_type, needs_research: research, research_queries, research_instruction,
    outline: outline.blocks ?? outline.fields, suggested: { ...mood, width, height },
    canvas: { width, height }, instruction, progress, context, handover,
  });
}

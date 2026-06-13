// Shared art-direction bank — the single source of "what does a topic look like".
//
// Used by BOTH enrich_brief (plan a design from a prompt) and the shorthand
// presets (decide a default when a vision-less model omits bg/accent/bg_style —
// which 30B-class models reliably do, collapsing every design onto one preset
// default = the "same template" complaint). Seeding the preset default from the
// design's own content keeps variety even when the model drops the colors.

export interface Mood { theme: string; bg: string; accent: string; text_color: string; palette: string[]; bg_style: string; }

// A diverse BANK of full art-directions (8 dark, 8 light). The mood (bg + accent
// + bg_style) is a design's dominant visual signature, so variety HERE is what
// makes two different topics actually LOOK different. Lanes map known domains to
// an apt entry; the long tail falls to a deterministic topic hash. Indexed.
export const MOOD_BANK: Mood[] = [
  /* 0  bold red     */ { theme: 'bold-poster', bg: '#0A0A0A', accent: '#FF3D00', text_color: '#FAFAFA', palette: ['#FF3D00', '#F4B740', '#3DD4C8'], bg_style: 'glow + grain' },
  /* 1  indigo tech  */ { theme: 'bold-poster', bg: '#0E0B14', accent: '#7C5CFF', text_color: '#F5F1EA', palette: ['#7C5CFF', '#27C2A0', '#F4B740'], bg_style: 'mesh + glow + grain' },
  /* 2  gold money   */ { theme: 'bold-poster', bg: '#0A0A0A', accent: '#F4B740', text_color: '#FAFAFA', palette: ['#F4B740', '#E0A96D', '#3DD4C8'], bg_style: 'glow + grain' },
  /* 3  teal ocean   */ { theme: 'bold-poster', bg: '#06141B', accent: '#2FD2C4', text_color: '#EAF6F4', palette: ['#2FD2C4', '#48A6C9', '#F2C66B'], bg_style: 'mesh + vignette + grain' },
  /* 4  midnight sky */ { theme: 'bold-poster', bg: '#0A0E1C', accent: '#5B8CFF', text_color: '#EAF0FF', palette: ['#5B8CFF', '#9B7CFF', '#F2C66B'], bg_style: 'mesh + glow + grain' },
  /* 5  plum night   */ { theme: 'bold-poster', bg: '#160A14', accent: '#FF5C8A', text_color: '#FDEFF3', palette: ['#FF5C8A', '#FFB347', '#7C5CFF'], bg_style: 'glow + vignette + grain' },
  /* 6  sepia past   */ { theme: 'bold-poster', bg: '#17120B', accent: '#E0A96D', text_color: '#F6EFE2', palette: ['#E0A96D', '#C66B4A', '#8FA37E'], bg_style: 'gradient:vert + vignette + grain' },
  /* 7  forest green */ { theme: 'bold-poster', bg: '#08140F', accent: '#34C77B', text_color: '#EAF5EE', palette: ['#34C77B', '#9CCB6A', '#E0B15E'], bg_style: 'mesh + grain' },
  /* 8  sage cream   */ { theme: 'editorial-cream', bg: '#F2F0E6', accent: '#3E7C5A', text_color: '#1A1A1A', palette: ['#9CAF88', '#C8B88A', '#6E8BB5'], bg_style: 'gradient:vert + curve + grain' },
  /* 9  terracotta   */ { theme: 'editorial-cream', bg: '#FAF5EC', accent: '#B8543C', text_color: '#1A1A1A', palette: ['#B8543C', '#E0A96D', '#6E8BB5'], bg_style: 'gradient:vert + curve + grain' },
  /* 10 swiss blue   */ { theme: 'swiss-international', bg: '#F4F1EA', accent: '#1F4FD8', text_color: '#111111', palette: ['#1F4FD8', '#E5342B', '#111111'], bg_style: 'band + grain' },
  /* 11 cool azure   */ { theme: 'editorial-cream', bg: '#EAF0F4', accent: '#1F6FB2', text_color: '#15202B', palette: ['#1F6FB2', '#3DB6C9', '#E08A3C'], bg_style: 'gradient:vert + curve + grain' },
  /* 12 lavender     */ { theme: 'editorial-cream', bg: '#F3EEF6', accent: '#7A3FA0', text_color: '#1A1326', palette: ['#7A3FA0', '#C77DBB', '#6E8BB5'], bg_style: 'gradient + curve + grain' },
  /* 13 clay gallery */ { theme: 'gallery', bg: '#EDE7DD', accent: '#A8432A', text_color: '#1A1A1A', palette: ['#A8432A', '#C9A24B', '#5E7E6E'], bg_style: 'gradient + grain' },
  /* 14 mono print   */ { theme: 'mono-print', bg: '#F5F5F2', accent: '#111111', text_color: '#111111', palette: ['#111111', '#E5342B', '#9A9A9A'], bg_style: 'band + grain' },
  /* 15 rose coral   */ { theme: 'editorial-cream', bg: '#FBEFEC', accent: '#E0533D', text_color: '#2A1512', palette: ['#E0533D', '#F2A65A', '#6E8BB5'], bg_style: 'gradient:vert + curve + grain' },
];
// A definite fallback (also the tech lane's literal) — keeps return types Mood
// without a non-null assertion when an index is (impossibly) missing.
const DEFAULT_MOOD: Mood = MOOD_BANK[1] ?? { theme: 'bold-poster', bg: '#0E0B14', accent: '#7C5CFF', text_color: '#F5F1EA', palette: ['#7C5CFF', '#27C2A0', '#F4B740'], bg_style: 'mesh + glow + grain' };
// Topic → bank index. First match wins, so specific/strong-signal lanes precede
// broad ones; overlaps resolve by order (eco/nature before architecture, etc.).
const LANES: { test: RegExp; idx: number }[] = [
  { test: /\b(ai|ml|tech|software|developer|saas|startup|crypto|web3|cyber|cloud|api|devops|robot|llm|quantum|chip|compute|data|app)\b/i, idx: 1 },
  { test: /\b(finance|financial|econom|market|invest|revenue|business|sales|stock|fintech|bank|profit|cost|costs|price|pricing|budget|billion|trillion|gdp|wage|salary|money|wealth|tax|debt|productivity|roi|valuation|funding|waste)\b/i, idx: 2 },
  { test: /\b(ocean|sea|marine|coral|reef|fish|aqua|diving|whale|shark|abyss|abyssal|tide|wave|coast|nautical)\b/i, idx: 3 },
  { test: /\b(space|astro|cosmos|galaxy|planet|star|nasa|rocket|orbit|moon|mars|universe|nebula|comet|telescope|spacecraft)\b/i, idx: 4 },
  { test: /\b(music|audio|concert|band|festival|jazz|song|vinyl|sound|dj|album|gig|rave|nightlife|opera)\b/i, idx: 5 },
  { test: /\b(history|historic|vintage|heritage|ancient|retro|medieval|era|classic|neon|antique|century|archive)\b/i, idx: 6 },
  { test: /\b(nature|wildlife|forest|jungle|animal|bird|bee|beekeep|tree|plant|garden|safari|botanic|species|wild)\b/i, idx: 7 },
  { test: /\b(climate|environment|sustain|green|eco|renewable|solar|carbon|energy|recycle|biodiversity|conservation)\b/i, idx: 7 },
  { test: /\b(health|wellness|medical|fitness|mental|care|nutrition|yoga|sleep|wellbeing|mindful|therapy|diet)\b/i, idx: 8 },
  { test: /\b(food|culinary|recipe|cook|coffee|espresso|cuisine|restaurant|baking|wine|chef|kitchen|dish|flavor|street food)\b/i, idx: 9 },
  { test: /\b(education|learn|school|student|course|study|teach|academic|university|tutorial|lesson|skill)\b/i, idx: 10 },
  { test: /\b(travel|destination|tour|adventure|journey|explore|trip|wander|expedition|hiking|hike|camping)\b/i, idx: 11 },
  { test: /\b(fashion|style|beauty|cosmetic|luxury|jewel|makeup|aesthetic)\b/i, idx: 12 },
  { test: /\b(art|gallery|exhibition|paint|sculpture|museum|photo|photography|creative|illustration|craft|culture)\b/i, idx: 13 },
  { test: /\b(architecture|building|interior|urban|construct|library|libraries|structure|skyscraper|housing|estate|property|lighthouse)\b/i, idx: 14 },
  { test: /\b(sport|athlet|olympic|run|running|climb|climbing|boulder|bouldering|soccer|football|basketball|race|gym|workout|marathon|cycling)\b/i, idx: 0 },
  { test: /\b(science|physics|chemistry|biology|geolog|volcano|volcanoes|research|lab|experiment|microb|genetic|molecul)\b/i, idx: 4 },
];
// Small deterministic FNV-1a-ish hash for the no-lane fallback — same subject ⇒
// same mood (stable), different subjects ⇒ (almost always) different moods.
function moodHash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
/**
 * Pick a topic-matched art-direction: a semantic lane if one matches `text`,
 * else a deterministic hash of `seed` → a stable, VARIED entry from the bank —
 * so unmatched topics don't collapse onto one default (the "same template" bug).
 */
export function pickMood(text: string, seed: string): Mood {
  const lane = LANES.find(l => l.test.test(text));
  if (lane) return MOOD_BANK[lane.idx] ?? DEFAULT_MOOD;
  return MOOD_BANK[moodHash(seed || text) % MOOD_BANK.length] ?? DEFAULT_MOOD;
}
/**
 * A preset's default art-direction when the model gave no bg/accent — derived
 * from the design's own CONTENT (title + body text), so two different topics
 * render differently even though neither carried a color. Lanes match on the
 * content words ("abyssal/sea" → teal, "volcano" → midnight, "neon" → sepia).
 */
export function seededMood(seed: string): Mood {
  return pickMood(seed, seed);
}

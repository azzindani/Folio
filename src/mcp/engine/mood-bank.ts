// Shared art-direction bank — the single source of "what does a topic look like".
//
// Used by BOTH enrich_brief (plan a design from a prompt) and the shorthand
// presets (decide a default when a vision-less model omits bg/accent/bg_style —
// which 30B-class models reliably do, collapsing every design onto one preset
// default = the "same template" complaint). Seeding the preset default from the
// design's own content keeps variety even when the model drops the colors.

// `headline` = the TYPOGRAPHIC treatment of the title/kicker — the type
// personality on top of the color+geometry+font. One of: 'rule' (accent rule),
// 'highlight' (knockout marker chip), 'underline' (accent swipe under the title),
// 'mega' (oversized uppercase), 'rotate' (vertical magazine-spine kicker).
export interface Mood { theme: string; bg: string; accent: string; text_color: string; palette: string[]; bg_style: string; font: string; headline: string; }

// 20 distinct STYLES — each its own art-direction: color + a GEOMETRIC bg recipe
// (triangles / blocks / rings / arcs / diagonals / waves / shards, not just the
// circular glow) + a display FONT. Variety here is what makes two topics LOOK
// different. Lanes map known domains to an apt style; the tail hashes to one.
export const MOOD_BANK: Mood[] = [
  /* 0  bold red     */ { theme: 'bold-poster', bg: '#0A0A0A', accent: '#FF3D00', text_color: '#FAFAFA', palette: ['#FF3D00', '#F4B740', '#3DD4C8'], bg_style: 'tri:br + diagonal_stripes + grain', font: 'Anton', headline: 'mega' },
  /* 1  indigo tech  */ { theme: 'bold-poster', bg: '#0E0B14', accent: '#7C5CFF', text_color: '#F5F1EA', palette: ['#7C5CFF', '#27C2A0', '#F4B740'], bg_style: 'mesh + grid + grain', font: 'Space Grotesk', headline: 'underline' },
  /* 2  gold money   */ { theme: 'bold-poster', bg: '#0A0A0A', accent: '#F4B740', text_color: '#FAFAFA', palette: ['#F4B740', '#E0A96D', '#3DD4C8'], bg_style: 'blocks + glow + grain', font: 'Bebas Neue', headline: 'highlight' },
  /* 3  teal ocean   */ { theme: 'bold-poster', bg: '#06141B', accent: '#2FD2C4', text_color: '#EAF6F4', palette: ['#2FD2C4', '#48A6C9', '#F2C66B'], bg_style: 'wave:bottom + rings:tr + grain', font: 'Space Grotesk', headline: 'rotate' },
  /* 4  midnight sky */ { theme: 'bold-poster', bg: '#0A0E1C', accent: '#5B8CFF', text_color: '#EAF0FF', palette: ['#5B8CFF', '#9B7CFF', '#F2C66B'], bg_style: 'diag:tr + rings:tr + grain', font: 'Orbitron', headline: 'rule' },
  /* 5  plum night   */ { theme: 'bold-poster', bg: '#160A14', accent: '#FF5C8A', text_color: '#FDEFF3', palette: ['#FF5C8A', '#FFB347', '#7C5CFF'], bg_style: 'glow + arcs:bottom + grain', font: 'Playfair Display', headline: 'highlight' },
  /* 6  sepia past   */ { theme: 'bold-poster', bg: '#17120B', accent: '#E0A96D', text_color: '#F6EFE2', palette: ['#E0A96D', '#C66B4A', '#8FA37E'], bg_style: 'vignette + crosshatch + grain', font: 'Playfair Display', headline: 'rotate' },
  /* 7  forest green */ { theme: 'bold-poster', bg: '#08140F', accent: '#34C77B', text_color: '#EAF5EE', palette: ['#34C77B', '#9CCB6A', '#E0B15E'], bg_style: 'wave:bottom + dot_grid + grain', font: 'Bricolage Grotesque', headline: 'underline' },
  /* 8  sage cream   */ { theme: 'editorial-cream', bg: '#F2F0E6', accent: '#3E7C5A', text_color: '#1A1A1A', palette: ['#3E7C5A', '#9CAF88', '#6E8BB5'], bg_style: 'curve:tr + dot_grid + grain', font: 'Source Serif', headline: 'rotate' },
  /* 9  terracotta   */ { theme: 'editorial-cream', bg: '#FAF5EC', accent: '#B8543C', text_color: '#1A1A1A', palette: ['#B8543C', '#E0A96D', '#6E8BB5'], bg_style: 'tri:br + diagonal_stripes + grain', font: 'Playfair Display', headline: 'underline' },
  /* 10 swiss blue   */ { theme: 'swiss-international', bg: '#F4F1EA', accent: '#1F4FD8', text_color: '#111111', palette: ['#1F4FD8', '#E5342B', '#111111'], bg_style: 'blocks + grid + grain', font: 'Space Grotesk', headline: 'mega' },
  /* 11 cool azure   */ { theme: 'editorial-cream', bg: '#EAF0F4', accent: '#1F6FB2', text_color: '#15202B', palette: ['#1F6FB2', '#3DB6C9', '#E08A3C'], bg_style: 'arcs:bottom + dot_grid + grain', font: 'Manrope', headline: 'rule' },
  /* 12 lavender     */ { theme: 'editorial-cream', bg: '#F3EEF6', accent: '#7A3FA0', text_color: '#1A1326', palette: ['#7A3FA0', '#C77DBB', '#6E8BB5'], bg_style: 'rings:tr + scallop + grain', font: 'Quicksand', headline: 'highlight' },
  /* 13 clay gallery */ { theme: 'gallery', bg: '#EDE7DD', accent: '#A8432A', text_color: '#1A1A1A', palette: ['#A8432A', '#C9A24B', '#5E7E6E'], bg_style: 'shards + grain', font: 'Bricolage Grotesque', headline: 'rotate' },
  /* 14 mono print   */ { theme: 'mono-print', bg: '#F5F5F2', accent: '#111111', text_color: '#111111', palette: ['#111111', '#E5342B', '#9A9A9A'], bg_style: 'blocks + crosshatch + grain', font: 'Bebas Neue', headline: 'mega' },
  /* 15 rose coral   */ { theme: 'editorial-cream', bg: '#FBEFEC', accent: '#E0533D', text_color: '#2A1512', palette: ['#E0533D', '#F2A65A', '#6E8BB5'], bg_style: 'wave:bottom + dots + grain', font: 'Plus Jakarta Sans', headline: 'underline' },
  /* 16 emerald noir */ { theme: 'bold-poster', bg: '#07130E', accent: '#1FBF75', text_color: '#E9F6EE', palette: ['#1FBF75', '#7FD99B', '#E0B15E'], bg_style: 'diag:tl + tri:br + grain', font: 'Space Grotesk', headline: 'highlight' },
  /* 17 amber noir   */ { theme: 'bold-poster', bg: '#14100A', accent: '#FFB000', text_color: '#FBF3E4', palette: ['#FFB000', '#E0673B', '#5E7E6E'], bg_style: 'blocks + diagonal_stripes + grain', font: 'Anton', headline: 'mega' },
  /* 18 slate mono   */ { theme: 'mono-print', bg: '#ECEEF0', accent: '#2B2F36', text_color: '#15181C', palette: ['#2B2F36', '#C0392B', '#7E8A99'], bg_style: 'grid + tri:tr + grain', font: 'IBM Plex Sans', headline: 'rule' },
  /* 19 magenta pop  */ { theme: 'bold-poster', bg: '#120516', accent: '#E0218A', text_color: '#FCE9F4', palette: ['#E0218A', '#9B5CFF', '#36C9C0'], bg_style: 'shards + glow + grain', font: 'Audiowide', headline: 'highlight' },
];
// A definite fallback (also the tech lane's literal) — keeps return types Mood
// without a non-null assertion when an index is (impossibly) missing.
const DEFAULT_MOOD: Mood = MOOD_BANK[1] ?? { theme: 'bold-poster', bg: '#0E0B14', accent: '#7C5CFF', text_color: '#F5F1EA', palette: ['#7C5CFF', '#27C2A0', '#F4B740'], bg_style: 'mesh + grid + grain', font: 'Space Grotesk', headline: 'underline' };
// Topic → bank index. First match wins, so specific/strong-signal lanes precede
// broad ones; overlaps resolve by order (eco/nature before architecture, etc.).
const LANES: { test: RegExp; idx: number }[] = [
  { test: /\b(ai|ml|tech|software|developer|saas|startup|crypto|web3|cyber|cloud|api|devops|robot|llm|quantum|chip|compute|data|app|artificial intelligence|machine learning|deep learning|neural|automation|digital)\b/i, idx: 1 },
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
 * Pick the Nth DISTINCT art-direction for one topic — the engine side of "give me
 * N options of the same subject". variant 0 is the topic-apt default (== pickMood,
 * unchanged); variants 1..N step through the bank from that anchor, so each option
 * is a different palette + typography treatment (and, paired with a variant-seeded
 * proceduralBgStyle, different geometry) while staying the same topic. Deterministic:
 * (topic, variant) ⇒ one stable mood, so a re-run of option 3 looks identical.
 */
export function pickMoodVariant(text: string, seed: string, variant: number): Mood {
  const v = Math.max(0, Math.floor(variant || 0));
  if (v === 0) return pickMood(text, seed);
  const lane = LANES.find(l => l.test.test(text));
  const anchor = lane ? lane.idx : moodHash(seed || text) % MOOD_BANK.length;
  return MOOD_BANK[(anchor + v) % MOOD_BANK.length] ?? DEFAULT_MOOD;
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

// ── Procedural background grammar ─────────────────────────────
// The bg_style language (base + sweeps + pattern + grain) is already
// combinatorial; the 20 moods just hardcode ONE recipe each, so the same colour
// always draws the same geometry ("some designs use the same background"). These
// pools SAMPLE that grammar, seeded by the design's content, so two decks in the
// same colour mood get different geometry. Space = base × sweep × sweep2 ×
// pattern ≫ 100 distinct, coherent backgrounds. Pools are individually vetted;
// sweeps blend toward the bg and patterns render faint, so any combination stays
// legible. marble/photo are excluded (need extra inputs / don't raster cleanly).
const BG_BASE_DARK = ['gradient', 'radial', 'mesh', 'gradient:vert', 'solid'];
const BG_BASE_LIGHT = ['gradient:vert', 'gradient', 'solid', 'radial'];
const BG_SWEEP = ['tri:br', 'tri:tr', 'diag:tr', 'diag:tl', 'blocks', 'rings:tr', 'rings:tl', 'arcs:bottom', 'wave:bottom', 'shards', 'curve:tr', 'curve:bl', 'glow:top'];
// Only the SUBTLE patterns are sampled procedurally — the dense weaves
// (crosshatch/diagonal_stripes/carbon/halftone/zigzag/chevron) read as
// over-processed at any opacity (user feedback), so the auto-sampler never
// reaches for them. A model can still request one explicitly via a bg_style
// string; parseBgSpec/composeBackground still support the full pattern set.
const BG_PATTERN_CALM = ['grid', 'dot_grid', 'dots', 'graph_paper', 'plus', 'blueprint'];

// FNV-1a salted by slot so each part of the recipe draws an independent index
// from the same seed (stable per content, decorrelated across slots).
function hashSalt(s: string, salt: number): number {
  let h = (0x811c9dc5 ^ salt) >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Compose a bg_style recipe procedurally from the seed — base + 1-2 geometric
 * sweeps + a faint pattern + grain. Deterministic per seed, varied across seeds.
 * `dark` picks the base pool that reads on a dark vs light canvas.
 */
/** True when a hex reads as a dark canvas (picks the dark vs light base pool). */
export function isDarkHex(hex: string): boolean {
  const h = (hex || '').replace('#', '');
  if (h.length < 6) return true;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

export function proceduralBgStyle(seed: string, dark: boolean): string {
  const s = seed && seed.trim() ? seed : 'folio-default';
  const bases = dark ? BG_BASE_DARK : BG_BASE_LIGHT;
  const base = bases[hashSalt(s, 1) % bases.length] ?? 'gradient';
  const sweep1 = BG_SWEEP[hashSalt(s, 2) % BG_SWEEP.length] ?? 'glow:top';
  // A SECOND sweep is now RARE (~12%, was 40%) — stacking geometry is what made
  // backgrounds crowded; one restrained sweep + grain is the calm default.
  const sweep2 = hashSalt(s, 3) % 8 === 0 ? (BG_SWEEP[hashSalt(s, 4) % BG_SWEEP.length] ?? '') : '';
  // A pattern is OPTIONAL (~45%) and only from the subtle set — so roughly half
  // the backgrounds are just base + one sweep + grain (clean), the rest add a
  // faint dot/grid texture. More variety, far less crowding.
  const usePattern = hashSalt(s, 6) % 100 < 45;
  const pattern = usePattern ? (BG_PATTERN_CALM[hashSalt(s, 5) % BG_PATTERN_CALM.length] ?? '') : '';
  const parts = [base, sweep1];
  if (sweep2 && sweep2 !== sweep1) parts.push(sweep2);
  if (pattern) parts.push(pattern);
  parts.push('grain');
  return parts.join(' + ');
}

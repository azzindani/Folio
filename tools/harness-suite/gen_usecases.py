#!/usr/bin/env python3
"""Generate 100 diverse design use cases for the harness suite.

Each case = a natural design brief fed to harness-claude (a vision-less model)
driving the Folio MCP, plus an evaluation rubric (expected preset/intent) used
when reviewing the render with vision. Project name is fixed (suite-NNN) so the
produced design is locatable + renderable deterministically.
"""
import json

# (title, brief, expected_intent, theme, dims)
# theme "" = let the engine pick. dims drive create_design.
CASES = [
    # ── Events / flyers / announcements (event preset) ───────────────────────
    ("Jazz night", "a flyer for a live jazz night at a downtown bar — Friday 9PM, $15 cover, 21+", "event", "bold-poster", "1080x1350"),
    ("Farmers market", "a poster for a Saturday morning farmers market in the town square, 8am-1pm, free entry", "event", "editorial-cream", "1080x1350"),
    ("Yoga retreat", "a weekend mountain yoga retreat announcement, June 14-16, limited spots", "event", "gallery", "1080x1350"),
    ("Charity gala", "an elegant charity gala invitation, black-tie, Oct 5, Grand Ballroom", "event", "", "1080x1350"),
    ("Film screening", "an outdoor film screening in the park, Sat July 18 at dusk, bring a blanket, free", "event", "mono-print", "1080x1350"),
    ("Book launch", "a bookstore launch event for a debut novel, reading + signing, Thursday 7PM", "event", "editorial-cream", "1080x1350"),
    ("Food truck festival", "a food-truck festival flyer, 20+ trucks, live music, Sunday all day", "event", "bold-poster", "1080x1920"),
    ("Comedy night", "a stand-up comedy night poster, doors 8PM, 5 comics, $10", "event", "brutalist-mono", "1080x1350"),
    ("Startup meetup", "a tech founders meetup announcement, lightning talks + networking, Wed 6PM", "event", "swiss-international", "1080x1350"),
    ("Art walk", "a first-friday gallery art walk, 12 studios, free, 5-9PM", "event", "gallery", "1080x1350"),

    # ── Feature grids / benefits / cards (feature_grid preset) ───────────────
    ("SaaS features", "a product poster showing 4 key features of a project-management app", "feature_grid", "swiss-international", "1080x1350"),
    ("Gym memberships", "the benefits of a gym membership — 6 perks, energetic", "feature_grid", "bold-poster", "1080x1350"),
    ("Note app features", "4 features of a privacy-first notes app", "feature_grid", "dark-tech", "1080x1350"),
    ("Online course", "the 4 modules of an online photography course", "feature_grid", "gallery", "1080x1350"),
    ("Plant care kit", "what's included in a houseplant care subscription box, 4 items", "feature_grid", "editorial-cream", "1080x1080"),
    ("Hotel amenities", "6 amenities of a boutique beach hotel", "feature_grid", "", "1080x1350"),
    ("EV features", "4 standout features of a new electric car", "feature_grid", "dark-tech", "1080x1350"),
    ("Meal kit", "3 reasons to try a healthy meal-kit service", "feature_grid", "editorial-cream", "1080x1350"),
    ("Bank app", "4 benefits of a mobile-first bank account, trustworthy", "feature_grid", "swiss-international", "1080x1350"),
    ("Coworking perks", "6 perks of a coworking space membership", "feature_grid", "", "1080x1080"),

    # ── Infographic sections w/ stats + data viz (sections preset) ───────────
    ("Climate stats", "an infographic on climate change with key stats and a short explainer", "sections", "", "1080x1350"),
    ("Sleep science", "an explainer on why sleep matters, with stats and 3 sections", "sections", "ocean-blue", "1080x1350"),
    ("Productivity report", "a 'by the numbers' productivity report with stats and a bar chart", "sections+bars", "swiss-international", "1080x1350"),
    ("Water usage", "an infographic on household water usage with a donut breakdown", "sections+donut", "ocean-blue", "1080x1350"),
    ("Streaming trends", "a poster on streaming-service growth with a line trend over years", "sections+line", "dark-tech", "1080x1350"),
    ("Recycling guide", "a recycling facts infographic with 4 stats and tips", "sections", "editorial-cream", "1080x1350"),
    ("Remote work", "a remote-work statistics infographic with stats and sections", "sections", "swiss-international", "1080x1350"),
    ("EV adoption", "EV adoption by the numbers, with a bar chart ranking countries", "sections+bars", "dark-tech", "1080x1350"),
    ("Screen time", "a digital-wellbeing infographic about screen time with a donut chart", "sections+donut", "", "1080x1350"),
    ("Coffee facts", "fun facts about coffee consumption with stats and a short note", "sections", "editorial-cream", "1080x1350"),
    ("Ocean plastic", "an infographic about ocean plastic pollution with stats + sections", "sections", "ocean-blue", "1080x1920"),
    ("Reading habits", "a poster on reading habits with 4 stats and a bar chart", "sections+bars", "mono-print", "1080x1350"),

    # ── Editorial / essay / opinion (editorial preset) ───────────────────────
    ("AI opinion", "an editorial opinion piece headline + standfirst on whether AI will replace designers", "editorial", "mono-print", "1080x1350"),
    ("Founder letter", "a founder's letter / manifesto for a sustainable fashion brand", "editorial", "editorial-cream", "1080x1350"),
    ("Magazine cover", "a minimalist design-magazine cover, issue 12, theme 'Negative Space'", "editorial", "gallery", "1080x1350"),
    ("City essay", "an editorial think-piece headline about the future of walkable cities", "editorial", "swiss-international", "1080x1350"),
    ("Brand story", "a short brand story for an artisan chocolate maker", "editorial", "editorial-cream", "1080x1350"),
    ("Photo essay", "an intro page for a black-and-white street photography photo essay", "editorial", "mono-print", "1080x1350"),
    ("Slow living", "an opinion editorial on slow living and doing less", "editorial", "gallery", "1080x1350"),
    ("Tech manifesto", "a bold one-page manifesto for an open-source software movement", "editorial", "brutalist-mono", "1080x1350"),

    # ── Process / flow / workflow (sections + flow block) ────────────────────
    ("Onboarding flow", "a 4-step user onboarding flow for a mobile app", "flow", "swiss-international", "1080x1350"),
    ("Recipe steps", "a 5-step recipe process for making sourdough bread", "flow", "editorial-cream", "1080x1350"),
    ("Design process", "the 5 stages of a design thinking process", "flow", "", "1080x1350"),
    ("Hiring pipeline", "a 4-stage hiring pipeline from application to offer", "flow", "swiss-international", "1080x1350"),
    ("Water cycle", "the water cycle explained in 4 sequential steps", "flow", "ocean-blue", "1080x1350"),
    ("Coffee brewing", "a 5-step pour-over coffee brewing guide", "flow", "editorial-cream", "1080x1350"),

    # ── Comparison / versus (sections + versus block) ────────────────────────
    ("iOS vs Android", "a comparison of iOS vs Android across 5 dimensions", "versus", "dark-tech", "1080x1350"),
    ("Tea vs coffee", "a fun tea vs coffee comparison, 5 rows", "versus", "editorial-cream", "1080x1350"),
    ("Rent vs buy", "rent vs buy a home comparison across key factors", "versus", "swiss-international", "1080x1350"),
    ("React vs Vue", "a developer comparison of React vs Vue, 5 rows", "versus", "dark-tech", "1080x1350"),
    ("Gas vs electric", "gas vs electric car comparison across cost, range, maintenance", "versus", "", "1080x1350"),

    # ── Timeline / roadmap / history (sections + timeline block) ─────────────
    ("Company history", "a company history timeline from 2015 to 2025, 5 milestones", "timeline", "swiss-international", "1080x1350"),
    ("Product roadmap", "a product roadmap for the next 4 quarters", "timeline", "dark-tech", "1080x1350"),
    ("Space exploration", "a timeline of major space-exploration milestones", "timeline", "dark-tech", "1080x1920"),
    ("Music history", "a timeline of music genres by decade", "timeline", "bold-poster", "1080x1350"),
    ("Personal milestones", "a 'my year in review' timeline with 5 personal milestones", "timeline", "editorial-cream", "1080x1350"),
    ("Project plan", "a 5-phase project plan timeline with dates", "timeline", "", "1080x1350"),

    # ── Pricing / plans / tiers (sections + pricing block) ───────────────────
    ("SaaS pricing", "a 3-tier SaaS pricing table, middle plan highlighted", "pricing", "swiss-international", "1080x1350"),
    ("Gym tiers", "3 gym membership tiers with prices and features", "pricing", "bold-poster", "1080x1350"),
    ("Streaming plans", "3 streaming-service plans compared by price and features", "pricing", "dark-tech", "1080x1350"),
    ("Coworking plans", "3 coworking membership plans with monthly prices", "pricing", "", "1080x1350"),
    ("Insurance plans", "3 insurance plan tiers with prices, recommend the middle one", "pricing", "swiss-international", "1080x1350"),

    # ── Single big stat (stat preset) ────────────────────────────────────────
    ("Donation goal", "a fundraising poster heroing a single number: $1.2M raised", "stat", "bold-poster", "1080x1350"),
    ("Growth number", "a startup growth poster heroing '300% YoY growth'", "stat", "dark-tech", "1080x1350"),
    ("Survey result", "a poster heroing a survey result: '87% would recommend us'", "stat", "swiss-international", "1080x1080"),
    ("Milestone", "a celebration poster: '1 million downloads'", "stat", "bold-poster", "1080x1350"),
    ("Carbon saved", "a sustainability poster heroing '50,000 tons of CO2 saved'", "stat", "ocean-blue", "1080x1350"),

    # ── Quote / poster (editorial or hand-place) ─────────────────────────────
    ("Motivational quote", "a motivational quote poster: 'Done is better than perfect'", "quote", "brutalist-mono", "1080x1350"),
    ("Author quote", "a literary quote poster from Maya Angelou, elegant", "quote", "gallery", "1080x1350"),
    ("Lyric poster", "a song-lyric poster, bold typographic treatment", "quote", "bold-poster", "1080x1350"),
    ("Philosophy", "a stoic philosophy quote poster, minimal", "quote", "mono-print", "1080x1350"),
    ("Brand slogan", "a brand slogan poster for a running shoe: 'Run your own race'", "quote", "bold-poster", "1080x1920"),

    # ── Carousels / slide decks (carousel, multi-page) ───────────────────────
    ("Tips carousel", "a 4-slide instagram carousel with productivity tips", "carousel", "swiss-international", "1080x1080"),
    ("How-to carousel", "a 4-slide how-to carousel: start a morning routine", "carousel", "editorial-cream", "1080x1080"),
    ("Product launch deck", "a 4-slide product-launch carousel for a new app", "carousel", "dark-tech", "1080x1080"),
    ("Story slides", "a 3-slide brand-story carousel for a coffee roaster", "carousel", "editorial-cream", "1080x1920"),
    ("Recipe carousel", "a 4-slide recipe carousel for a smoothie bowl", "carousel", "", "1080x1080"),
    ("Fitness routine", "a 4-slide home-workout routine carousel", "carousel", "bold-poster", "1080x1080"),
    ("Travel guide", "a 4-slide '48 hours in Lisbon' travel carousel", "carousel", "gallery", "1080x1080"),
    ("Study notes", "a 3-slide study-notes carousel on the French Revolution", "carousel", "mono-print", "1080x1080"),

    # ── Data-viz-forward (sections with a dominant chart) ────────────────────
    ("Bar ranking", "a poster ranking the top 5 programming languages by popularity (bar chart)", "sections+bars", "dark-tech", "1080x1350"),
    ("Donut breakdown", "a budget breakdown poster with a donut chart of spending categories", "sections+donut", "swiss-international", "1080x1350"),
    ("Line trend", "a poster showing website-traffic growth over 6 months as a line chart", "sections+line", "ocean-blue", "1080x1350"),
    ("Market share", "a smartphone market-share poster with a donut chart", "sections+donut", "dark-tech", "1080x1350"),
    ("Sales by quarter", "a quarterly sales bar chart poster", "sections+bars", "swiss-international", "1080x1350"),

    # ── Menus / misc structured (likely sections or hand-place) ──────────────
    ("Cafe menu", "a cafe drink menu poster with prices, 8 items in sections", "sections", "editorial-cream", "1080x1350"),
    ("Wine list", "a restaurant wine list poster, elegant, by category", "sections", "gallery", "1080x1350"),
    ("Event ticket", "a concert ticket design with event name, date, seat, barcode area", "hand-place", "bold-poster", "1080x600"),
    ("Certificate", "a course completion certificate, elegant, with a name placeholder", "hand-place", "editorial-cream", "1500x1080"),
    ("Name badge", "a conference name badge with name, role, company placeholders", "hand-place", "swiss-international", "1080x720"),

    # ── More topics for diversity (mixed presets) ────────────────────────────
    ("Podcast cover", "a podcast cover art for a true-crime show, moody", "editorial", "dark-tech", "1080x1080"),
    ("Mental health", "a gentle mental-health awareness poster with 3 supportive tips", "feature_grid", "ocean-blue", "1080x1350"),
    ("Garden guide", "a beginner's vegetable-garden guide, 4 tips with icons", "feature_grid", "editorial-cream", "1080x1350"),
    ("Pet adoption", "a cat adoption poster — meet 'Mochi', friendly, 2 years old", "event", "editorial-cream", "1080x1350"),
    ("Crypto explainer", "an explainer poster: what is a blockchain, in 4 simple steps", "flow", "dark-tech", "1080x1350"),
    ("Language tips", "5 tips for learning a new language fast", "feature_grid", "bold-poster", "1080x1350"),
    ("Hiking safety", "a hiking-safety checklist poster, 6 items", "sections", "", "1080x1350"),
    ("Wedding invite", "an elegant wedding invitation, names, date, venue", "event", "gallery", "1080x1350"),
    ("Sale promo", "a bold 50%-off flash sale promo poster for a clothing brand", "stat", "bold-poster", "1080x1350"),
    ("Webinar", "a free webinar announcement: 'Scaling your startup', speaker + date", "event", "swiss-international", "1080x1350"),
    ("Science fact", "a single fascinating space fact poster, dramatic", "stat", "dark-tech", "1080x1920"),
    ("Quarterly OKRs", "a one-page team OKRs poster with 3 objectives", "sections", "swiss-international", "1080x1350"),
    ("Restaurant week", "a restaurant-week promo: prix-fixe menu, 3 courses $35", "event", "editorial-cream", "1080x1350"),
    ("App update", "a 'what's new in v2.0' feature announcement, 4 updates", "feature_grid", "dark-tech", "1080x1350"),
    ("Volunteer drive", "a community volunteer-drive poster, this Saturday, sign up", "event", "bold-poster", "1080x1350"),
    ("Newsletter header", "a clean newsletter header poster for a weekly tech digest", "editorial", "swiss-international", "1200x600"),
    ("Habit tracker", "a minimalist 30-day habit tracker poster", "hand-place", "mono-print", "1080x1350"),
    ("Quote square", "a square inspirational quote post for instagram", "quote", "editorial-cream", "1080x1080"),
]


def build(idx, case):
    title, brief, intent, theme, dims = case
    proj = f"suite-{idx:03d}"
    w, h = dims.split("x")
    is_carousel = intent == "carousel"
    kind = "carousel (3-4 pages)" if is_carousel else "poster"
    # Neutral, NON-STEERING brief: no "prefer a preset", no forced theme, no
    # "one design / no variations". The model designs freely — the whole point is
    # to observe what it (and the engine) produce UNPROMPTED, not to score whether
    # it routed to the expected template. (intent/theme stay in the JSON only as
    # metadata for the human vision review, never injected into the prompt.)
    prompt = (
        f"Use the folio MCP to create a {kind}. "
        f"First call create_project with name EXACTLY \"{proj}\". "
        f"Then create a {w}x{h} design titled \"{title}\" for: {brief}. "
        f"Design it however best fits the topic — you choose the theme, layout, "
        f"typography, colour and composition. Build it with add_layers, then call "
        f"seal_design when it's finished."
    )
    return {
        "id": idx, "project": proj, "title": title, "intent": intent,
        "theme": theme or "auto", "dims": dims, "carousel": is_carousel,
        "brief": brief, "prompt": prompt,
    }


cases = [build(i + 1, c) for i, c in enumerate(CASES)][:100]
assert len(cases) == 100, f"expected 100, got {len(cases)}"
with open("tools/harness-suite/usecases.json", "w") as f:
    json.dump(cases, f, indent=1)
print(f"wrote {len(cases)} use cases")
# quick diversity report
from collections import Counter
print("intents:", dict(Counter(c["intent"] for c in cases)))
print("themes :", dict(Counter(c["theme"] for c in cases)))
print("dims   :", dict(Counter(c["dims"] for c in cases)))

#!/usr/bin/env python3
"""100 HAND-WRITTEN use-case prompts for the Folio harness — the "real human last
exam". Every prompt is authored by hand as a literal string: how an actual person
would type a design request — terse or rambling, vague or obsessively specific,
polite or burned-by-three-designers demanding. NO template/build() shapes the
prompt text (that was the bug: generated happy-path prompts → samey, biased output).

Deliberate spread:
  · personality — lazy/terse · casual · over-explaining · perfectionist · condescending
                  · stressed/in-a-hurry · nervous/unsure · corporate-jargon · artsy
  · complexity  — one line  →  multi-paragraph brand-system briefs with exact copy,
                  legal lines, hex palettes, named fonts, print specs (bleed/fold/CMYK),
                  reference brands, contradictions, dependencies
  · deliverable — poster · flyer · IG square/portrait/story · carousel · tri-fold
                  brochure · zine · book/album cover · menu (print+board) · business
                  card · certificate · web/roll-up/transit/LinkedIn banner · billboard
                  · sticker sheet · wine/beer/jam label · annual-report spread · pitch
                  slide · magazine cover/contents/spread · lookbook · wedding suite…
  · size/units  — px · A2/A3/A4/A5 · US letter · 6×9in · 3.5×2in card · mm+bleed · ratios
  · style       — y2k, vaporwave, riso, art-deco, brutalist, swiss, memphis, cottagecore,
                  sepia/academic, cyberpunk, grunge, maximalist, scandi, newspaper,
                  conspiracy-board, governmental, high-school, luxury, mid-century, Polish
                  modernist, blueprint, constructivist, blackletter, kawaii, collage…
  · job         — single / bulk same-style (with per-item data) / bulk different styles
                  (options) / multi-format same campaign / edit-restyle / research·url·data

`tags`/`job`/`n` are METADATA for the human review + diversity eval — NEVER injected
into the prompt the model sees. The runner prepends only one constant, non-creative
scaffold (the suite-NNN project name) at send time, identical for all 100 cases.

Run:  python3 cases.py   → writes usecases.json
"""
import json
import os

# job: single | bulk-same | bulk-diff | multiformat | edit | research
# n  : how many distinct designs the brief asks for
CASES = [
    # ── terse, but specific & non-generic ───────────────────────────────────
    ("single", 1, "flyer·noise-band·ugly",
     "flyer. my noise band. 'CONCRETE LUNG'. saturday, the squat off 9th. byob. make it ugly "
     "on purpose, photocopied, broken."),
    ("single", 1, "sign·bakery·witty",
     "need a window sign for the bakery: SOLD OUT OF SOURDOUGH (AGAIN). big, a bit funny, we "
     "slap it up most afternoons."),
    ("single", 1, "flyer·lost-bird",
     "lost budgie, bright green, answers to Kevin, flew off near the canal. our number 0412 333 "
     "901. reward is beer. make it stand out on a lamppost."),
    ("single", 1, "story·live·urgent",
     "instagram story: 'WE GO LIVE IN 30 MINS', twitch-purple, loud and urgent, a countdown "
     "feeling."),
    ("single", 1, "sign·studio·minimal",
     "'BACK IN 10 MINUTES' sign for the studio door. clean, huge, no nonsense, readable from "
     "across the street."),
    ("single", 1, "civic·vote·nonpartisan",
     "i just want something that makes people remember to vote on tuesday. non-partisan, "
     "friendly, civic. no party colours, no candidate, just VOTE TUESDAY."),
    ("single", 1, "card·tipjar·witty",
     "tiny card for the tip jar: 'tips fund the staff trip to nowhere exciting'. witty, small, "
     "sits on the counter."),
    ("single", 1, "poster·90th·photo",
     "happy 90th, Nonna. leave a clear square for one photo, gold and classy, we're printing it "
     "A3 for the party."),

    # ── casual, conversational, real detail ─────────────────────────────────
    ("single", 1, "carousel·gardening·handdrawn",
     "carousel, 5 slides, 'how to repot a plant without killing it', for my little gardening "
     "account. friendly, green, a bit hand-drawn feeling, not corporate at all."),
    ("single", 1, "savethedate·vowrenewal",
     "save-the-date for our vow renewal — 25 years! Marcus & Dineo, Cape Town, february. warm, "
     "golden-hour, grown-up romantic — please not first-wedding-y or cutesy."),
    ("single", 1, "poster·schoolplay·whimsical",
     "poster for the school play, 'A Midsummer Night's Dream' — drama club, three nights in "
     "june, 7pm, tickets at the door. whimsical and theatrical but legible from the back row."),
    ("single", 1, "menuboard·foodtruck·birria",
     "my food truck does birria. i need a menu board, chalkboard-ish but modern: tacos 4, "
     "quesabirria 6, consome 3, loaded fries 8, jarritos 3. warm reds and gold, a bit of "
     "spanish flair."),
    ("single", 1, "flyer·yardsale·multifamily",
     "multi-family yard sale flyer — three houses on Juniper Court, saturday 7am sharp (early "
     "birds will be ignored), furniture, tools, kids' stuff, plants. friendly, a little funny, "
     "very readable."),
    ("single", 1, "social·podcast·ep-drop",
     "new episode post for my history podcast 'The Long Story' — episode 47, 'The Year Without "
     "a Summer', drops friday. moody, bookish, a bit of an old-map feeling. square."),
    ("single", 1, "invite·housewarming",
     "housewarming invite — we finally have a place with a door that closes! saturday the 14th "
     "from 4, bring a plant not a bottle. fun, casual, a bit illustrated. story size so i can "
     "send it round."),
    ("single", 1, "poster·parkrun·friendly",
     "weekly free 5k in the park, every saturday 8am, all paces, dogs and buggies welcome, "
     "stay for coffee after. friendly and energetic, but calm — it's not a competition."),
    ("single", 1, "social·smallbiz·restock",
     "'back in stock' post for my candle shop — the bestseller 'Fig & Woodsmoke' is back, "
     "limited run. cosy, warm, a little luxe but still handmade-feeling. square."),
    ("single", 1, "flyer·languageexchange",
     "flyer for a casual language-exchange meetup at the pub, every other wednesday, all "
     "languages and levels, first drink on us. welcoming and a bit playful, maybe little speech "
     "bubbles."),
    ("single", 1, "poster·openday·studio",
     "open day for our ceramics studio — try the wheel, meet the makers, sunday 11-4, kids "
     "welcome. earthy, tactile, handmade. nothing slick or techy."),
    ("single", 1, "social·charity·match",
     "donations are being matched this week only — every pound doubled, up to 20k, for the "
     "youth shelter. urgent but hopeful, not guilt-trippy. square, easy to reshare."),
    ("single", 1, "card·newjob·congrats",
     "a 'congrats on the new job' card from the whole team for someone leaving us — bittersweet, "
     "warm, a bit funny, we'll print and all sign it. A5."),
    ("single", 1, "poster·filmclub·noir",
     "monthly film club is doing a noir season — four fridays, four classics, the church hall, "
     "byo snacks, donation on the door. smoky, high-contrast, venetian-blind shadows. legible."),

    # ── detailed → demanding: brand systems, exact copy, print specs, refs ───
    ("single", 1, "social·fintech·branded·legal·burned",
     "Right — I've been burned by three designers so let me be crystal clear. We're a Series-A "
     "fintech, Ledgerly, and I need a launch announcement for instagram, 1080x1350, but keep a "
     "96px safe margin all round because it gets reposted and cropped. Brand: ink #0B132B, "
     "accent #5BC0BE, never pure black, never drop shadows, never gradients — I will notice. "
     "Headline set tight, almost touching. Exact copy: headline 'Banking that does the math.', "
     "subhead 'Ledgerly is now live in the US.', and a small legal line at the very bottom: "
     "'Ledgerly is a financial technology company, not a bank. Banking services provided by "
     "Partner Bank, Member FDIC.' Feel like Stripe — confident, restrained, lots of negative "
     "space — but warmer, not cold. No people, no phones-in-hands stock. Asymmetric, weight on "
     "the left. If it looks like a generic SaaS template I'll know."),
    ("single", 1, "brochure·dental·trifold·bleed·a11y",
     "I need a tri-fold A4 brochure (landscape, folds in three) for a dental clinic — design it "
     "as the flat OUTER spread, six panels, and mind the fold order: the right panel is the "
     "front cover, the middle is the back, the left is the inside flap. 3mm bleed, keep text "
     "5mm off the trims. Cover: 'Bright Smile Dental', a calm tagline, room for a photo. The "
     "other panels: three short service blurbs (general, cosmetic, emergency), opening hours, "
     "address, phone, and a little map placeholder. Soft teal and white, friendly, and "
     "accessible — type big enough for older patients, AA contrast. No clip-art teeth."),
    ("single", 1, "report·annual·cover+data·honest",
     "Annual-report cover and one data spread, US letter. Cover: 'NorthWind Energy', 'Annual "
     "Report 2026', understated and corporate, deep green and slate, lots of grid discipline. "
     "The spread should visualise these honestly — no chart-junk, no 3D, no rainbow: revenue "
     "$4.2B (+8% YoY), renewables now 38% of the mix (was 31%), 1,240 MW added, customer "
     "satisfaction 82/100, and a five-year revenue trend 3.1 / 3.4 / 3.6 / 3.9 / 4.2 billions. "
     "Pick the right chart for each number, don't just bar-chart everything."),
    ("single", 1, "label·wine·packaging·elegant",
     "A wine bottle label — front label only, about 90mm wide by 100mm tall, portrait. Estate "
     "'Hollow Ridge', a 2023 Syrah, 14.5% ABV, 750ml, 'Product of South Africa'. Old-world "
     "elegant: a crisp serif, a fine engraved-looking line motif, cream and a deep oxblood, "
     "understated. It has to look expensive on a shelf and survive being shrunk."),
    ("single", 1, "banner·rollup·tradeshow·distance",
     "Roll-up banner for a trade show, 850 x 2000 mm, portrait. It'll stand behind our stand so "
     "the top third reads from across the hall — company 'AeroSeal', the line 'Leak-proof "
     "fittings for hydrogen systems', a logo space up top, and three tiny proof points near the "
     "bottom (ISO 19880-3 certified, -40 to 85 C, 5-year warranty). Industrial, clean, blue and "
     "steel, confident. Don't crowd the middle — a person stands in front of it."),
    ("single", 1, "poster·gig·polish-modernist·refs",
     "Make a gig poster but I want it to look like those Polish and Cuban modernist posters from "
     "the 60s — flat shapes, a tight limited palette, a bit surreal, hand-cut feeling, NOT "
     "digital-clean. It's for an experimental jazz quartet, 'The Inversions', one night at a "
     "tiny basement venue, march 2, 9pm. Let the shapes do the work, minimal text, and don't "
     "centre everything. A bit of riso grain is welcome."),
    ("single", 1, "sheet·realestate·listing·letter",
     "A printable listing sheet, US letter portrait, for a realtor. Top: a big photo area I'll "
     "fill, the address '42 Larkspur Lane', and the price $725,000. Then a clean stats row — 4 "
     "bed, 3 bath, 2,400 sqft, 0.3 acre, built 1998 — a short description block, three smaller "
     "photo placeholders, and a footer with the agent's name, phone, and brokerage. Upscale, "
     "trustworthy, restrained. Leave real room for photos."),
    ("single", 1, "slide·pitchdeck·16x9·metric",
     "Two pitch-deck slides, 16:9. The title slide: startup 'Rootstock', tagline 'Soil data for "
     "every acre', minimal, confident, one quiet accent. The second slide heroes a single proof "
     "point — '3.2M acres mapped' — with a tiny supporting line. Investor-deck clean, generous "
     "margins, not a wall of text."),
    ("single", 1, "cover·magazine·masthead·refs",
     "Design an indie magazine cover, like a Monocle / Kinfolk sensibility — a confident "
     "masthead 'FALLOW', issue 09, the line 'The Land Issue', three or four small cover lines "
     "down one side, a price and a barcode placeholder bottom corner. Editorial, calm, a warm "
     "paper tone, one strong photo space. A4-ish portrait."),
    ("multiformat", 3, "wedding·suite·invite+rsvp+details",
     "We need a wedding suite, three matching cards: the invitation, an RSVP card, and a details "
     "card — all clearly one set. Couple: 'Priya & Tom', September 12 2026, Thornbury Hall, "
     "4pm, black tie. The RSVP needs a 'kindly reply by August 1' line and meal options "
     "(chicken / fish / vegetarian); the details card has parking, accommodation and a website "
     "'priyaandtom.example'. Timeless and elegant — a fine serif, deckled feeling, blush and "
     "ink. 5x7in each."),
    ("single", 1, "label·beer·can·craft·playful",
     "A craft beer can label — the wrap art, roughly 200mm wide by 110mm tall. Brewery 'Bad "
     "Weather', the beer 'Drizzle' (a hazy pale ale), 5.2% ABV, 35 IBU, 440ml. Playful, a bit "
     "irreverent, hand-lettered, a grumpy little rain-cloud character would be perfect, bold "
     "colours that pop in a fridge. Keep the legal bits readable."),
    ("single", 1, "banner·linkedin·1584x396·safezone",
     "A LinkedIn banner, exactly 1584 x 396. It's for my personal brand as a product coach — "
     "name 'Dana Osei', the line 'I help PMs ship less and learn more', and keep the bottom-left "
     "corner clear because the round profile photo sits over it. Calm, credible, one accent, "
     "lots of breathing room, definitely not a busy collage."),
    ("single", 1, "notice·election·official·multilingual",
     "An official polling-place notice from the county — it must look governmental and neutral, "
     "no flair. 'Notice of Election', date November 3, polls open 7am-8pm, 'Bring photo ID', the "
     "polling location 'Maple Grove Community Center, 200 Oak St'. Include the same one-line "
     "'Necesita ayuda? Llame al 1-800-555-0100' in Spanish, a small county seal placeholder, and "
     "a notice number. Structured, flat, authoritative."),
    ("single", 1, "poster·teardown·blueprint·technical",
     "I want a poster in a technical-blueprint / exploded-diagram style for a bike shop's "
     "workshop wall — 'Anatomy of a Bicycle'. Blueprint blue, thin white technical linework, a "
     "monospace label feel, callout numbers with a little parts legend down the side. Accurate-"
     "looking and nerdy, A2 portrait. It's decorative but should feel like a real engineering "
     "drawing."),
    ("single", 1, "sticker·sheet·diecut·mascot",
     "A sticker sheet, A5, with about 8 small die-cut sticker designs laid out together for a "
     "plant shop — variations on a cute mascot (a smiling monstera leaf), a couple of little "
     "phrases like 'leaf me alone' and 'plant parent', a logo sticker. Bright, friendly, kawaii- "
     "ish, each one clearly its own sticker with a little breathing room around it."),
    ("single", 1, "resume·cv·onepage·restrained",
     "Design a one-page resume that looks considered but is still ATS-sane — clear sections "
     "(summary, experience, skills, education), a strong but quiet name header, one accent "
     "colour, good hierarchy, plenty of white space. For a UX designer, 8 years' experience. "
     "Tasteful, not a flashy infographic-CV with skill ‘percentage’ bars — I hate those."),
    ("single", 1, "ad·transit·busshelter·3word",
     "A bus-shelter ad, portrait, very bold — it has about two seconds to land. For an oat-milk "
     "brand 'Velvet', the whole thing basically a three-word headline 'Smoother by nature.' with "
     "the brand mark and a tiny 'Find us in the chiller aisle.' Big confident type, one creamy "
     "colour field, almost no clutter. Readable from a moving bus."),
    ("single", 1, "infographic·nonprofit·impact·honest",
     "An impact infographic for a literacy charity's yearly recap — a headline 'Our Year in "
     "Reading', four stats (14,200 books donated, 38 schools reached, 1,100 volunteer hours, 92% "
     "of kids read more), one simple chart, and a short pull-quote from a teacher. Warm and "
     "hopeful, credible, not corporate. Honest visuals — no exaggerated bars. 1080x1350."),
    ("single", 1, "invite·kids·circus·designsnob",
     "Kids' birthday party invite, circus theme — but I'm a designer and I will not hang a "
     "comic-sans, primary-colour clip-art monstrosity on my fridge. So: a charming modern "
     "circus, warm reds and cream, a nice bold display face, maybe a simple striped-tent or "
     "bunting motif, tasteful. It's for 'Theo', turning 5, saturday 2pm, our place. Square."),
    ("single", 1, "teaser·perfume·luxury·aesop",
     "A perfume teaser, the kind of restrained, almost pharmaceutical luxury Aesop does — a calm "
     "neutral ground, a refined serif, enormous negative space, the product name 'No. VII' and "
     "one quiet line 'an amber woods eau de parfum.' and nothing else. It should feel embossed "
     "and expensive even though it's flat. 1080x1350."),
    ("single", 1, "poster·metal·blackletter·legible-legal",
     "A metal gig poster — proper blackletter, aggressive, dark, a bit occult, ornate. Band "
     "'IRONCLAD' with two supports 'Hex' and 'Lowtide', the Crowbar venue, friday, doors 7, "
     "18+, $20 on the door / $15 advance. As nasty-looking as you like, BUT the venue insists "
     "all that door/age/time info is actually readable, so handle that cleanly somewhere."),
    ("single", 1, "canvas·spotify·9x16·abstract",
     "A vertical 9:16 still for a track's streaming canvas — for an ambient electronic artist "
     "'HALON', track 'Tidewater'. Abstract, atmospheric, slow-moving feeling even though it's a "
     "still — soft gradients, a grain, a horizon-ish band, the artist name small and low. Moody "
     "blues and a dim amber. No literal imagery."),
    ("single", 1, "poster·market·artnouveau·2color",
     "A poster for a botanical artisan market — I love art-nouveau, so ornate flowing borders, "
     "whiplash curves, elegant lettering, a sense of vines framing it. BUT it's screen-printed "
     "in just two colours (a deep green and a warm cream), so design it for two flat inks, no "
     "gradients. 'Bloom & Bramble Market', first sunday monthly, the old glasshouse."),
    ("single", 1, "onepager·dashboard·exec·colorblind",
     "A one-page executive dashboard poster summarising Q3 for the leadership offsite — a tight "
     "header, four KPI tiles (ARR $12.4M up 14%, churn 2.1% down from 2.8%, NPS 47, headcount "
     "210), a small revenue-by-quarter chart, and a one-line 'what to watch' note. Disciplined, "
     "corporate, and colourblind-safe — no red/green pairs, no rainbow. Letter, landscape."),

    # ── more demanding singles: emotional, contradictory, niche, dense ───────
    ("single", 1, "flyer·flowershop·rambling·editorial",
     "ok so my sister is opening a flower shop and i promised i'd sort the opening flyer and i "
     "have NO eye for this. it's called 'Wild & Stem'. she wants it to feel… not the usual "
     "swirly-script flowery thing everyone does, you know? more editorial, magazine-y, a bit "
     "cool and grown-up but still soft. opening day is the 5th, free coffee, 10% off the first "
     "week. oh and her instagram is @wildandstem, put that somewhere small. honestly if it looks "
     "like a wedding invitation she'll cry (the bad kind). A5."),
    ("single", 1, "poster·cafe·contradiction·modern-vintage",
     "I want our new cafe poster to look modern AND vintage at the same time — does that make "
     "sense? Like clean and contemporary but with a nostalgic, faded, been-here-forever soul. "
     "'Corner & Co.', now open, specialty coffee and pastries, 7am til late. Muted, warm, a "
     "considered serif, maybe a subtle aged texture. Not retro-kitsch, not sterile-minimal — "
     "somewhere in between, and yes I know that's hard."),
    ("single", 1, "cover·zine·diy·collage",
     "Cover for issue 3 of my DIY feminist zine 'LOUD' — cut-paper collage energy, photocopied "
     "and high-contrast, ransom-note and marker scrawl, deliberately rough and hand-made, not "
     "polished. 'LOUD — the anger issue', a price 'pay what you can'. A5, black and one hot "
     "colour like it was run on a risograph in someone's kitchen."),
    ("single", 1, "poster·midcentury·spaceage·travel",
     "A mid-century 'space-age travel' poster, the optimistic 1950s-60s style — 'VISIT EUROPA', "
     "Jupiter's moon, a sleek retro rocket and a planet on the horizon, a limited flat palette "
     "(teal, cream, burnt orange), geometric, that vintage tourism-board confidence. A small "
     "line 'Daily departures from the orbital terminal'. A2 portrait."),
    ("single", 1, "poster·rebrand·townhall·jargon·condescending",
     "We're unveiling the new brand at the all-hands and I need a poster that frankly most "
     "people won't 'get' but the leadership will love. It must communicate that we are premium, "
     "disruptive and human-centric, leveraging our synergies to deliver best-in-class outcomes. "
     "Headline 'One Vision. Infinite Momentum.' Make it feel like a $10M rebrand — bold, "
     "aspirational, a gradient is fine actually, real gravitas. Company 'Veridian', the townhall "
     "is the 28th. Don't overthink it, just make it look expensive."),
    ("single", 1, "social·etsy·soap·nervous-firsttimer",
     "hi! um, i make natural soap and i'm finally launching my little etsy shop and i don't "
     "really know what i want, sorry. something for the launch announcement? it's all handmade, "
     "natural ingredients, kind of calm and earthy i guess. the shop's called 'Slow Lather'. "
     "maybe soft and simple? i don't want it to look cheap but i'm not fancy. whatever you think "
     "looks nice, honestly. square i think, for instagram?"),
    ("single", 1, "poster·academic·scientific·A0·dense",
     "An academic conference poster, A0 portrait, for a research symposium — proper scientific "
     "layout. Title 'Mycorrhizal Networks and Drought Resilience in Boreal Forests', authors "
     "'L. Haddad, R. Mbeki, S. Okafor' with a university affiliation line, then organised "
     "sections: Abstract, Methods, Results (with one bar chart comparing three conditions), and "
     "Conclusions, plus a small references corner and a QR placeholder for the full paper. "
     "Dense but rigorously organised in columns, calm academic palette, very legible."),
    ("single", 1, "cover·childrensbook·gentle",
     "A children's picture-book cover, for ages 3-6, called 'The Moon Forgot'. Gentle and "
     "dreamy, soft hand-illustrated feeling, a sleepy nighttime palette, a small round moon "
     "character with a worried little face. Author line 'by Eli Fern'. Warm and reassuring, the "
     "title in a friendly rounded hand. Square-ish, like a hardback."),
    ("single", 1, "menu·restaurant·naturalwine·fullbrand·demanding",
     "Full dinner menu for our natural-wine bar, and I care about every detail. It should feel "
     "like a tiny Copenhagen wine bar — paper-driven, understated, a touch austere. Two type "
     "sizes only: a grotesque for headings, a serif for the dishes. Sections: Snacks, Smaller, "
     "Larger, To Finish, with 3-4 invented seasonal dishes each (dish + short description + "
     "price), an allergen key (V, VG, GF) explained at the foot, and a footer line '@grapeskin "
     "· no corkage on tuesdays'. Cream stock, ink, one dusty accent. A4. No decoration for "
     "decoration's sake."),

    # ── bulk, ONE style, with the actual per-item data a client would give ───
    ("bulk-same", 12, "monthly·gardenclub·themed·set",
     "12 instagram posts, one per month, for our community garden — all the same calm "
     "illustrated style so they're clearly a year-long set, each showing the month name and one "
     "seasonal job: Jan plan, Feb prep soil, Mar sow seeds, Apr seedlings, May plant out, Jun "
     "water, Jul watch for pests, Aug harvest, Sep preserve, Oct compost, Nov mulch, Dec rest. "
     "Soft, earthy, friendly. Square."),
    ("bulk-same", 10, "quotes·attributed·set·exact",
     "10 quote posts in one consistent elegant style, instagram square, for my book club. Use "
     "exactly these, attribution under each: 'A reader lives a thousand lives' — George R.R. "
     "Martin; 'I cannot live without books' — Thomas Jefferson; 'Books are a uniquely portable "
     "magic' — Stephen King; 'So many books, so little time' — Frank Zappa; 'A room without "
     "books is a body without a soul' — Cicero; 'Until I feared I would lose it, I never loved "
     "to read' — Harper Lee; 'Read 500 pages every day' — Warren Buffett; 'There is no friend as "
     "loyal as a book' — Hemingway; 'Reading is dreaming with open eyes' — anonymous; 'Once you "
     "learn to read you will be forever free' — Frederick Douglass. Same look for all 10."),
    ("bulk-same", 6, "podcast·episodecovers·titled·set",
     "6 episode-cover graphics for my podcast 'Made It Weird Adjacent', same template and style, "
     "each with the episode number and title: 01 'Quitting on a high', 02 'The myth of the "
     "morning routine', 03 'Failing in public', 04 'Money and shame', 05 'When the work stops "
     "working', 06 'Starting over at 40'. Bold, warm, conversational. Square, with a consistent "
     "corner for the guest's photo."),
    ("bulk-same", 5, "speaker·conference·announce·set",
     "5 'speaker announcement' cards for our design conference 'SHAPE 2027', one consistent "
     "style, each a name, role and talk title: Mara Lindqvist, Design Director at Northstar — "
     "'Designing for doubt'; Idris Bello, Founder of Klay — 'Tools that disappear'; Sun Park, "
     "Researcher — 'The user you forgot'; Tomas Reyes, Type designer — 'Letters with opinions'; "
     "Aoife Quinn, Creative Lead — 'Saying no, beautifully'. Confident and modern, a spot for "
     "each headshot. Square."),
    ("bulk-same", 7, "classschedule·yoga·daily·set",
     "A week of daily class-schedule story cards for our yoga studio — 7 cards, Monday to "
     "Sunday, same serene style, each listing that day's classes and times. Mon Vinyasa 7am / "
     "Restorative 6pm; Tue Power 6:30am / Yin 7pm; Wed Hatha 9am / Vinyasa 6pm; Thu Mobility "
     "7am / Candlelight 8pm; Fri Flow 6:30am; Sat Slow Flow 9am / Family 11am; Sun Restorative "
     "10am. Calm, sage and stone, story size."),
    ("bulk-same", 4, "sneaker·colourways·hype·set",
     "Four product posts for the same running shoe, the 'Drift v2', in four colourways — layout "
     "and energy identical, only the colourway name and accent change to match: 'Volt' (acid "
     "yellow), 'Tarmac' (charcoal), 'Coral Reef' (bright coral), 'Glacier' (icy blue). Hyped, "
     "dynamic, shoe name big, 'GBP 140, drops friday'. Square."),

    # ── more style-forward / niche singles ──────────────────────────────────
    ("single", 1, "poster·constructivist·designtalk",
     "A poster for a graphic-design lecture in full Soviet constructivist style — bold red, "
     "black and cream, hard diagonals, dynamic angled type, a sense of propaganda urgency, "
     "geometric photomontage energy. 'PRODUCTION / THE POSTER AS MACHINE', a talk, april 11, "
     "7pm, the design school. Make it feel like it's shouting."),
    ("single", 1, "social·realestate·penthouse·luxury",
     "A 'just listed' post for a penthouse — but ultra-luxury, the restraint of a fashion house. "
     "Almost nothing on it: 'The Pinnacle Residence', a single elegant line 'Two floors above "
     "the city', and 'Price on application'. Deep charcoal, a whisper of gold, a thin serif, "
     "vast negative space, one place for a twilight skyline photo. If it feels busy it's wrong. "
     "1080x1350."),
    ("single", 1, "poster·sports·gameday·hype",
     "Game-day hype graphic for our basketball team — high energy, dynamic, team colours are "
     "purple and gold. 'TIP-OFF FRIDAY 7PM', Lakers… no, our team is the 'River City Kings' vs "
     "the 'Northside Heat'. Hero one player, 'MARCUS BELL #23', with a stat flash '28.4 PPG'. "
     "Aggressive angled type, motion, a stadium-light feel. Portrait, for stories."),
    ("single", 1, "cover·scifi·retrofuturism·80s",
     "An 80s sci-fi paperback cover, full retro-futurism — chrome lettering, a neon sunset over "
     "a wireframe grid horizon, purples and hot pinks, that VHS-airbrush feel. Novel 'NEON "
     "HALO', author 'J. D. Cross', and a tagline 'In the year 2099, the city never sleeps — and "
     "neither do its machines.' 6x9 inches."),
    ("single", 1, "card·boba·loyalty·kawaii",
     "A loyalty card for my boba shop, business-card size (3.5 x 2 inches), double-sided idea: "
     "front a cute kawaii boba-cup mascot with the shop name 'Squish Tea', back a row of 10 "
     "little stamp circles and 'buy 10 get 1 free'. Pastel, adorable, rounded, playful. Bouncy "
     "and sweet."),

    # ── bulk, deliberately DIFFERENT styles (real options to choose from) ────
    ("bulk-diff", 3, "options·funrun·poster·different",
     "Give me 3 genuinely different poster directions for the same event so I can choose — a "
     "charity fun run, '5K for Clean Water', sunday june 8, 8am, register at the link. I mean "
     "actually different: not three colours of one idea — different composition, type, whole "
     "mood. Surprise me with at least one I wouldn't have asked for."),
    ("bulk-diff", 5, "options·juicebar·explore·different",
     "We're opening a juice bar, 'Pulp & Press', and I want to explore the visual identity "
     "before committing. Make 5 'now open' posts, each a completely different design language — "
     "I'm thinking one stark minimal, one 70s-retro, one loud-and-bold, one playful-illustrated, "
     "one quiet-elegant — same info on all five, wildly different looks. This is a real test of "
     "range, don't repeat yourself."),
    ("bulk-diff", 3, "options·album·concepts·different",
     "3 different album-cover concepts for an indie-folk record called 'Paper Boats' by 'Hartley "
     "& the Tide'. Each should feel like a different art director made it — say one photographic-"
     "minimal, one hand-illustrated, one bold-typographic. Square."),
    ("bulk-diff", 4, "options·halloween·moods·different",
     "Four mood directions for one Halloween party flyer so we can pick: a cute-spooky one, a "
     "genuinely creepy one, an elegant-gothic one, and a retro-B-movie one. Same details on all "
     "four — 'Fright Night at The Vault', oct 31, 9pm, costumes mandatory, $15 — four very "
     "different vibes."),
    ("bulk-diff", 3, "options·hiring·tones·different",
     "Same message — 'We're hiring a Senior Designer' — in three different brand tones so I can "
     "see what fits us: one buttoned-up corporate, one warm and casual, one bold and a bit "
     "cheeky. Each should clearly be a different company's voice. Square, with a 'careers at "
     "example.com' line."),
    ("bulk-diff", 5, "options·gala·savethedate·different",
     "Five save-the-date directions for a hospital-foundation gala so the committee can vote — "
     "deliberately spanning the range: classic black-tie formal, modern-minimal, warm and "
     "human, art-deco glamour, and one unexpected editorial take. 'An Evening for the Children's "
     "Wing', november 15, The Athenaeum. Same info, five distinct looks."),

    # ── multi-format, ONE campaign (cohesion across pieces, with specs) ──────
    ("multiformat", 3, "campaign·oatmilk·poster+post+story·specs",
     "Launch campaign for an oat-milk product, three pieces that obviously belong together: a "
     "portrait poster (1080x1350), an instagram square, and a story (1080x1920). Same palette, "
     "type and message across all three. Product 'Velvet Oat', line 'Smoother by nature.', "
     "creamy, friendly, sustainable, a small 'now in the chiller aisle' tag. Keep the story's "
     "bottom 250px clear for the swipe-up."),
    ("multiformat", 3, "campaign·rooftop·flyer+square+carousel",
     "Our summer rooftop series needs a matching set in one warm sunset style: an A5 flyer for "
     "the bar, an instagram square, and a 4-slide carousel listing the july lineup (DJ Sola, "
     "The Hush, Marisol, Kit & the Coast — one per Friday). 'ROOFTOP SESSIONS', fridays in july, "
     "7pm til late, free before 8. Fun, golden, cohesive."),
    ("multiformat", 2, "campaign·workshop·poster+carousel·painterly",
     "A poster AND a 5-slide carousel for the same class — 'Intro to Watercolour', 6 weeks, "
     "starts feb 3, tuesdays 7pm, materials included, £180. Make them visually a pair: same "
     "soft painterly palette, same type. The carousel walks through what you'll learn week by "
     "week. Artistic, calm, a little wash of colour."),
    ("multiformat", 3, "campaign·restaurantweek·tent+post+story·autumn",
     "Restaurant week, three matching pieces in one elegant autumnal look: a printed table-tent "
     "(small, double-sided, stands on the table), an instagram post, and a story. Same "
     "deep-rust-and-cream style throughout. 'Harvest Table — a 3-course tasting, $55, all week', "
     "reservations recommended. Seasonal, refined."),
    ("multiformat", 3, "campaign·cleanup·poster+carousel+square·ocean",
     "An awareness mini-campaign for a beach-cleanup drive, all the same hopeful ocean-blue "
     "style: an informational poster with two stats (8M tonnes of plastic enter the ocean a "
     "year; this beach collected 1.2 tonnes last year), a 4-step 'how to help' carousel, and a "
     "shareable square. 'Saturday Shoreline Cleanup', meet at the pier 9am, gloves provided."),
    ("multiformat", 3, "campaign·headphones·banner+square+story·3sizes",
     "Same BOGO ad in three placements, consistent and punchy: a wide web banner (1600x400), an "
     "instagram square, and a story (1080x1920). 'Buy one, get one free' on our wireless "
     "earbuds 'Pebble', this week only, code BOGO. Bold, clean, a single product colour, the "
     "offer impossible to miss. Mind each canvas's shape — don't just stretch one layout."),
    ("multiformat", 4, "campaign·applaunch·full·complex",
     "Full launch kit for a new habit-tracking app 'Streaky', four pieces in one bright, "
     "encouraging style: (1) a launch announcement poster, (2) a story teaser with 'launching "
     "tuesday', (3) a 4-slide carousel showing the three core features and a CTA, and (4) a "
     "press one-pager (letter) with a short blurb, three feature bullets, and contact/press "
     "details. Cohesive brand throughout — pick a friendly accent and commit to it."),
    ("multiformat", 3, "campaign·conference·poster+schedule+teaser",
     "A small brand kit for our one-day conference 'SHAPE 2027' in one consistent style: a main "
     "poster (date, venue 'The Foundry', 'tickets at shape.example'), a 4-slide schedule "
     "carousel (registration 9, talks 10-12:30, lunch, workshops 2-4, drinks 5), and a square "
     "teaser. Confident, modern, one strong accent — all three unmistakably the same event."),

    # ── edit / restyle (create, then a dependent variant — self-contained) ──
    ("edit", 2, "edit·winetasting·darker",
     "Make a clean event poster for a wine-tasting evening, then give me a second version of "
     "the exact same poster but much darker and moodier, candle-lit, like the lights went down. "
     "Friday, the cellar, 7pm, 6 wines, $30, book ahead."),
    ("edit", 2, "edit·swingdance·era·compare",
     "Design a flyer for a swing-dance social, then redo it in a completely different era so I "
     "can compare side by side — modern minimal first, then a full authentic 1950s look. Same "
     "details both times: beginners welcome, live band, saturday 8pm, $12, no partner needed."),
    ("edit", 2, "edit·recycling·boxier",
     "Make a simple recycling infographic with four quick stats, then make a variant that's far "
     "more boxy and grid-based — everything boxed in rectangles, hard modular grid, the same "
     "content. I want to see the gentle version and the strict version."),
    ("edit", 2, "edit·babyshower·tone·flip",
     "Create a baby-shower invite that's soft and pastel, then a second one that's bold and "
     "modern with the exact same details for the half of the family who hate anything cutesy. "
     "'Baby Garcia', march 9, 2pm, the garden room, gifts optional. Two real options."),
    ("edit", 2, "edit·meditation·airier",
     "Do a poster for a silent meditation retreat, then a version that's even more minimal and "
     "airy — far more white space, smaller type, almost empty. 'Stillness', a silent weekend, "
     "april 18-20, in the hills. Show me the calm one and the extremely calm one."),
    ("edit", 2, "edit·conference·contrast·engagement",
     "Make a conference-talk announcement, then give me a higher-contrast, louder, more "
     "thumb-stopping version of it for when the first one isn't getting clicks. 'The Future of "
     "Work', a free webinar, may 6, 1pm, register free. Same info, two energy levels."),
    ("edit", 2, "edit·cafemenu·festive·restyle",
     "Lay out a normal everyday menu for my cafe (coffees, a few pastries, prices), then restyle "
     "that same menu for the holiday season — same items and layout, but dressed up festive and "
     "warm, a 'seasonal specials' header, a couple of winter drinks added. So I can swap them "
     "out in december."),
    ("edit", 2, "edit·pitchslide·dumbdown·dependency",
     "Make an investor pitch slide explaining our tech — 'edge-deployed federated inference' — "
     "for a technical audience, with the jargon. Then, based on that same slide, make a second "
     "version that explains the exact same thing to a non-technical investor in plain language, "
     "simpler visual, no buzzwords. Both 16:9."),
    ("edit", 2, "edit·eventposter·declutter·dependency",
     "Design an event poster for a community arts festival with everything on it — five "
     "activities, times, sponsors, a map note, ticket info, the works. Then my client will say "
     "it's 'too busy' (they always do), so also give me a stripped-back version that keeps only "
     "the essentials and lets it breathe. Same festival: 'Riverside Arts Day', sept 7, free."),

    # ── research / url / data driven ────────────────────────────────────────
    ("research", 1, "research·health·10ksteps·infographic",
     "Do a bit of research on the real benefits of walking 10,000 steps a day and turn it into "
     "a clean, shareable infographic with a few credible stats and one clear takeaway. Friendly "
     "health-app style, square. Don't overstate the science."),
    ("research", 1, "url·company·overview·investors",
     "Here's our about page: example.com/about — pull the key points and turn them into a "
     "one-page company-overview poster for an investor meeting. Professional and confident, US "
     "letter, our blue is roughly #2b50aa, leave a spot for the logo."),
    ("research", 1, "research·ev·current·infographic·chart",
     "Look into the latest figures on electric-vehicle adoption and make an infographic poster "
     "with the most striking numbers and one simple chart (e.g. EV share of new car sales over "
     "the last few years). Clean, modern, optimistic green-tech feel, 1080x1350. Note your "
     "sources small at the bottom."),
    ("research", 1, "data·milestones·bythenumbers·purple",
     "I'll give you the data, you make a celebratory 'by the numbers' poster from it: 1,000,000 "
     "users, a 4.8 star average rating, live in 42 countries, built by a team of 12, 9.7M "
     "tasks completed. Bold and proud, our brand colour is a deep purple, pick the right way to "
     "hero each figure. Square."),
    ("research", 1, "research·desks·versus·credible",
     "Research the honest differences between standing desks and sitting all day and make a "
     "versus-style comparison poster across a few real factors (calories, back pain, focus, "
     "long-term health) — credible and balanced, not a sales pitch for standing desks. Clean, "
     "1080x1350, cite a source line."),
    ("research", 2, "research·vaccines·booklet+explainer·calm",
     "I want a small educational booklet cover plus a 3-slide explainer on how vaccines actually "
     "work, aimed at anxious parents. Do the research so the facts are right, and keep the tone "
     "calm, warm and reassuring — not clinical, not preachy, no scare tactics. Two pieces, one "
     "gentle style."),
    ("research", 1, "research·ai·trends·carousel·newsletter",
     "For my tech newsletter, make a 5-slide carousel rounding up the most important recent "
     "shifts in AI — research what's actually current and pick five that matter, one per slide "
     "with a punchy title and a sentence. Sharp, modern, a little opinionated, dark with one "
     "electric accent. Square."),
    ("research", 1, "data·sales·byregion·chart·poster",
     "Here's our quarterly sales by region, turn it into a clean internal results poster with "
     "the right chart: North 4.2M, South 3.1M, East 2.8M, West 5.6M, Central 1.9M (USD, this "
     "quarter). Add the total and the top region as a callout. Sober, corporate, one accent, "
     "colourblind-safe. Letter, landscape."),

    # ── three more, filling format gaps (billboard · door hanger · a11y) ────
    ("single", 1, "billboard·lawfirm·highway·brash",
     "A highway billboard, super-wide (think 14:48), for a personal-injury firm — yes, one of "
     "those. Six words max, a giant phone number 1-800-WIN-NOW, the firm 'Briggs & Hale', "
     "instantly readable at 70mph. Loud, high-contrast, a bit brash. No fine print — nobody can "
     "read it at speed anyway."),
    ("single", 1, "doorhanger·hotel·doublesided",
     "A hotel door hanger, about 4.25 x 11 inches, double-sided: one side says 'Please make up "
     "my room', the other 'Do not disturb'. Boutique hotel 'The Marlow', warm and understated, "
     "a small logo, legible at arm's length. Design both sides so they clearly belong together."),
    ("single", 1, "poster·publichealth·a11y·aaa",
     "A public-health poster for a clinic wall on the steps of proper hand-washing — and "
     "accessibility is the entire point. WCAG AAA contrast, very large type, clear numbered "
     "steps with simple supportive icons, nothing decorative fighting the message. Calm clinical "
     "blue, A3 portrait, readable by someone with low vision from a metre away."),
]


def main():
    out = []
    for i, (job, n, tags, prompt) in enumerate(CASES, 1):
        out.append({
            "id": i,
            "project": f"suite-{i:03d}",
            "title": tags,          # short descriptor for the runner log + human review
            "job": job,             # single | bulk-same | bulk-diff | multiformat | edit | research
            "n": n,                 # how many distinct designs the brief asks for
            "tags": tags,
            "prompt": prompt,       # the PURE hand-written human brief — no tool names, no scaffold
        })
    assert len(out) == 100, f"expected 100, got {len(out)}"
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, "usecases.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    print(f"wrote {len(out)} hand-written use cases -> {path}")
    from collections import Counter
    print("jobs   :", dict(Counter(c["job"] for c in out)))
    print("designs:", sum(c["n"] for c in out), "total across all briefs")
    lens = [len(c["prompt"]) for c in out]
    print(f"prompt length chars: min {min(lens)} · median {sorted(lens)[len(lens)//2]} · max {max(lens)}")


if __name__ == "__main__":
    main()

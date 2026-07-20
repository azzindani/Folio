// Mark/identity construction guidance. Kept out of guide.ts, which sits at the
// 700-line cap — same arrangement as craft.ts.

export const MARKS_GUIDE = `# Marks + Identity — construction, not generation

The engine will NOT draw a mark for you and does not ship logo templates. Preset
marks are why AI logos all look alike. You draw it; \`diagnose_design\` measures
whether it holds up, because these are the things you cannot see.

## The measurements you get
Run diagnose_design on a design whose mark sits on its own canvas. It returns:
• optical_center  — centroid of ink vs bounding-box centre
• scale_survival  — the mark rendered at 16/24/32/64/128/512px
• contrast        — the ink against white, black and mid grey
• clearspace      — a padding rule derived from the mark's own stroke width

## Optical vs geometric centring
Centre by bounding box and many marks look wrong. A play triangle is the standard
example: its mass sits at the flat edge while the box is set by the far point, so
box-centring pushes it visibly left. Centre the MASS, not the box. Anything past
~2% of the mark's width is visible to an ordinary viewer.

WHAT THE ENGINE ACTUALLY MEASURES: the alpha-weighted centroid of the WHOLE
rendered mark against its bounding box. So it catches a silhouette sitting off
-centre on its canvas. It CANNOT see an inner element that is off-centre within
an outer one — a white triangle on a solid disc is opaque everywhere, so the
centroid is just the disc's centre. To check that case, render the inner shape
on its own canvas and diagnose it there, or compute the nudge yourself: shift
the triangle right by about 1/12 of its width and it will look centred.

## Overshoot
A circle drawn to the same height as a square looks SMALLER — curves read as
lighter than flat edges. Round and pointed forms are drawn 1–3% oversize so they
appear equal. Same reason 'O' and 'A' overshoot the cap height in every serious
typeface. If your mark mixes a circle and a square at identical heights, the
circle needs to be bigger.

## Survive the small size
The mark will be a 16px favicon. Detail that reads at 512px turns to mud there.
scale_survival reports where structure stops being distinguishable — if it says
you are illegible below 48px, simplify, or ship a separate reduced mark. Common
killers: hairline strokes, small counters, gradients, more than ~3 elements.

## Stroke weight does not scale linearly
Halving a mark's size does NOT halve its apparent weight — thin strokes
disappear faster than thick ones grow. A mark used across a wide size range
usually needs its small version drawn with proportionally heavier strokes.

## Counters and negative space
The gaps carry as much identity as the ink. Counters that close up when small
are the most common failure. Check the 16px and 24px steps for coverage
collapsing toward 1.0 — that is the shape filling in.

## Lockups
Mark + wordmark: space them by the wordmark's x-height, not an arbitrary gap.
Align on the optical centre of the mark against the wordmark's visual centre —
usually its x-height midline, NOT its bounding-box middle, because ascenders and
descenders throw the box off.

## Clearspace
Express it in the mark's own units so it survives rescaling — every identity
manual does this. The engine derives it from median stroke width and recommends
2x. A rule in fixed pixels breaks the first time someone resizes the logo.

## What good looks like
One idea, not three. Works in one colour. Recognisable as a silhouette. Survives
a fax, a favicon and an embroidered shirt. If it needs a gradient to work, it
does not work.
`;

/** Resolve a marks section, mirroring craft()'s contract. Null = not ours. */
export function guideMarks(slug: string): string | null {
  return slug === 'marks' ? MARKS_GUIDE : null;
}

export const MARKS_SECTIONS = ['marks'];

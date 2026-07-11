// Folio MCP engine — add_layers + append_page. Split from engine.ts; verbatim bodies.
import * as fs from 'fs';
import * as path from 'path';
import type { DesignSpec, Layer } from '../schema/types';
import type { ToolResult } from './types';

import type { ProgressItem } from './types';

import { validateReport } from '../report/report-validator';

import { resolveDesignPath, snapshot, readYAML, writeYAML, errResult, okResult, pOk, pWarn, pInfo, buildContext, buildHandover } from './engine/utils';

import { lintComposition, reviewComposition, lockedHealNote } from './engine/design-lint';
import { lintAiSlop } from './engine/ai-slop-lint';

import { buildEditorLink } from './engine/editor-link';

import { expandShorthandLayers, coerceShorthandLayers, recoverStringifiedPreset, unwrapBareContainers, fillBleedPresetDims, fillFlowPresetsToPage, snapWrongFlowPresets, demoteCoveringBackdrops, lockCarouselCanvas, stampDeckSeed, hasPresetType, diagnoseLayers, diagnoseShorthandKeys } from './shorthand-parser';
import type { ShorthandLayer } from './shorthand-parser';
import { readTask, writeTask, markPageDone, buildNextAction } from './engine/task';
import { honorPosterRatio } from './poster-ratio';
import type { NextAction } from './types';

import { collectLayerIds, dedupeIncomingIds, normalizeReportAliases, normalizeTextAliases, flattenRelativeGroups, snapOffCanvasContent, ensureTopMargin, dropCollidingMotifs, rasterizeChartsDeep, trimTrailingDeadBand } from './engine-finalize-geom';
import { CONTENT_PRESET_RE, isFullBleedContentPreset, dropStackedPresets, stackDistinctFullBleedPresets, dropThrashDuplicates, dedupOverlappingDuplicates } from './engine-finalize-presets';
import { spreadStackedText, dedupDuplicateText, promoteCoveredTitle, recenterHalfAnchoredText, ensureDeckPageBackgrounds, structureHandPlacedText, decollideHandPlaced, fitOverflowingHeroText, setMeasuredTextHeights, clampShorthandToCanvas, variantIndexForDesign } from './engine-finalize-text';
import { fixInvisibleText, fixCapsTracking } from './engine-finalize-legibility';
import { stripNullLayers, placePositionlessLayers, recoverEmbeddedLayers } from './engine-finalize-autoplace';
import { finalizePageLayers, themeSpecOf as resolveThemeSpec } from './engine-finalize-pages';
import { VALID_LAYER_TYPES, dimError } from './engine-edit-tools';

// Layer/spec predicates live in a sibling to keep this file ≤700 lines;
// re-exported so existing import sites (engine-edit-tools, tests) are unchanged.
import { resolveThemeColors, isFullCanvasBgRect, hasFullCanvasBackdrop, hasRenderableContent } from './engine-layer-predicates';
export { isFullCanvasBgRect, hasFullCanvasBackdrop, hasRenderableContent };

export function addLayers(args: {
  design_path: string; page_id?: string; project_path?: string;
  layers?: Layer[]; layers_shorthand?: ShorthandLayer[]; task_path?: string;
}): ToolResult {
  const op = 'add_layers';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check design_path.');
  // Coerce the many shapes a small model sends (array of objects, array of
  // compact strings, or a {id: "type:[pos]:text"} dict) into canonical layers.
  const rawShorthand = args.layers_shorthand as unknown;
  // coerceShorthandLayers leniently parses a JSON/YAML-array STRING (a common
  // small-model form) back into layers. Only when that parse yields NOTHING do
  // we surface the helpful shape — e.g. a flat blob ("feature_grid:0,0,…:title=…")
  // with no [x,y,w,h] bracket that coerces to nothing.
  let shorthand = coerceShorthandLayers(rawShorthand);
  if (typeof rawShorthand === 'string' && !shorthand.length) {
    return errResult(op,
      'layers_shorthand was a STRING that did not parse into any layers.',
      'Send a JSON array. Feature/benefit/cards poster → one feature_grid (flat bg + one accent, not a gradient): layers_shorthand=[{type:"feature_grid", title:"Brew Lab", subtitle:"Premium coffee subscription", bg:"#0A0A0A", accent:"#FF3D00", text_color:"#FAFAFA", items:[{icon:"coffee", title:"Freshly Roasted", desc:"Sourced from sustainable farms"},{icon:"truck", title:"Fast Delivery", desc:"Shipped within 24h"},{icon:"shield-check", title:"Quality Assured", desc:"Third-wave control"}]}]');
  }
  // A STRING that smells like a preset (has "blocks"/a preset "type") but coerced
  // to NO real preset layer — almost always MALFORMED JSON (a stray brace, a
  // truncation). Left alone it degrades to a lone text layer holding the blob →
  // a blank-looking poster (g_arch). Reject so the model resends a clean array
  // rather than silently shipping the blank.
  if (typeof rawShorthand === 'string' && shorthand.length && !hasPresetType(shorthand)
    && /"blocks"|"type"\s*:\s*"(sections|stats|bars|feature_grid|editorial|stat|event|list|split)"/.test(rawShorthand)) {
    return errResult(op,
      'layers_shorthand looks like a preset but is MALFORMED JSON (it parsed into no valid preset layer — likely a stray brace or a truncation).',
      'Resend it as a clean JSON array — one preset object, e.g. layers_shorthand=[{type:"sections", title:"…", subtitle:"…", bg_style:"…", blocks:[{type:"stats", items:[{value:"30%", label:"…"}]}, {type:"heading_text", heading:"…", text:"…"}, {type:"callout", label:"Key Takeaway", text:"…"}]}]. Do NOT double-nest blocks ([[…]]) and close every brace.');
  }
  if (!args.layers?.length && !shorthand.length) return errResult(op, 'No layers provided', 'Pass layers or a layers_shorthand array/object.');
  // A weak model sometimes packs the ENTIRE preset as a STRINGIFIED JSON blob
  // inside a verbose text layer (`content.value`) instead of passing it as
  // layers_shorthand — the engine then renders one unreadable JSON wall → a
  // blank-looking poster. Recover the preset and re-route it through the
  // shorthand expander (same silent-drop class as a stringified shorthand, #42).
  if (!shorthand.length && args.layers?.length) {
    const recovered = recoverStringifiedPreset(args.layers);
    if (recovered?.length) {
      shorthand = recovered;
      progress.push(pInfo('Recovered a stringified preset from a text layer', `re-expanding ${recovered.length} preset layer(s)`));
    }
  }

  const spec = readYAML<DesignSpec>(dPath);
  // Hoist any bare page/document wrapper the model invented (a typeless container
  // carrying page-level bg/accent/fonts + a nested layers:[…]). Left alone it
  // becomes a dimensionless group → "needs a positive width" → blank poster.
  if (shorthand.length) {
    const uw = unwrapBareContainers(shorthand, spec.document.width, spec.document.height);
    if (uw.unwrapped) {
      shorthand = uw.layers;
      progress.push(pInfo(`Unwrapped ${uw.unwrapped} container wrapper(s)`, 'hoisted nested layers to the page'));
    }
  }
  // Size a boxless full-bleed preset to the page so it fills the whole canvas
  // instead of a hardcoded square — no dead strip on a portrait/tall page for
  // the model to "fix" with a covering rect (the blank-carousel-slide find).
  if (shorthand.length) {
    const filled = fillBleedPresetDims(shorthand, spec.document.width, spec.document.height);
    if (filled) progress.push(pInfo(`Sized ${filled} full-bleed preset(s) to the page`, `${spec.document.width}×${spec.document.height}`));
    // Snap a mispositioned flow preset (off-canvas / oversized / offset from origin)
    // to fill the page — a content-sizing flow preset placed at y=400 renders its
    // tall content off the bottom edge (the signup-flow blank). Posters + carousels.
    const flowSnapped = snapWrongFlowPresets(shorthand, spec.document.width, spec.document.height);
    if (flowSnapped) progress.push(pInfo(`Snapped ${flowSnapped} mispositioned flow preset(s) to the page`, 'off-origin content preset would render off-canvas'));
  }
  // A PAGED design (carousel/presentation) filled via add_layers + page_id — the
  // path create_presentation takes (it scaffolds EMPTY pages, then the model fills
  // each slide here, NOT via append_page). Run the same page-prep append_page does
  // so the deck still gets a full-bleed content fill (no left-anchored portrait
  // group on a landscape slide, no dead strip) AND stays cohesive (one shared mood
  // for bg-less slides; light↔dark / font flips snapped to the deck). Posters (no
  // spec.pages) are untouched — they keep content-sizing + the centering pass.
  if (shorthand.length && spec.pages && spec.pages.length) {
    const flowFilled = fillFlowPresetsToPage(shorthand, spec.document.width, spec.document.height);
    if (flowFilled) progress.push(pInfo(`Filled ${flowFilled} content preset(s) to the slide`, `${spec.document.width}×${spec.document.height}`));
    const deckSeed = (spec.meta?.name && String(spec.meta.name).trim()) || spec.meta?.id || '';
    const seeded = stampDeckSeed(shorthand, deckSeed);
    if (seeded) progress.push(pInfo(`Locked deck mood on ${seeded} slide(s)`, 'shared palette+font from the deck identity'));
    const locked = lockCarouselCanvas(spec.pages, shorthand);
    if (locked.bg || locked.font) progress.push(pInfo('Locked carousel cohesion', `${locked.bg} bg + ${locked.font} font snapped to the deck`));
  }
  // Clamp any top-level layer the model sized larger than the canvas BEFORE
  // expansion. A full-bleed preset given height 1350 on a 1080 doc expands to a
  // group + bg taller than the page → off_canvas error the model then can't fix
  // (patching the already-EXPANDED group's shorthand keys is inert). Clamping at
  // the source lets the preset lay itself out correctly inside the page.
  if (shorthand.length) clampShorthandToCanvas(shorthand, spec.document.width, spec.document.height);

  // "Give me N options of one topic": stamp this design's index within its sibling
  // variant set so a preset whose style the model DROPPED still picks the Nth curated
  // art-direction (seededDefaults → pickMoodVariant) instead of the same seeded mood
  // every other option got. Only fires when the model omitted bg (explicit style is
  // always honored); a lone design → index 0 → unchanged.
  if (shorthand.length) {
    const vi = variantIndexForDesign(dPath);
    if (vi > 0) {
      for (const l of shorthand) (l as unknown as Record<string, unknown>)['__variant'] = vi;
      progress.push(pInfo(`Applied art-direction variant ${vi}`, 'one of a sibling variant set — distinct palette/typography/background'));
    }
  }

  // Stamp the chosen theme's bg/text onto each preset so its content-seeded mood
  // can't fight the theme's light/dark polarity — a `light-clean` poster used to
  // come back on a dark indigo gradient because the "AI/tech" topic seeded a dark
  // mood and the preset never consulted the theme ("that is not a light theme").
  // Colours only; composition (geometry/type/font/accent) stays mood-driven, and
  // an explicit shorthand `bg` still wins (seededDefaults bails on it).
  const themeColors = resolveThemeColors(spec);
  if (themeColors && shorthand.length) {
    for (const l of shorthand) {
      const rr = l as unknown as Record<string, unknown>;
      if (rr['__theme'] === undefined) rr['__theme'] = themeColors;
    }
  }

  const incoming: Layer[] = shorthand.length
    ? expandShorthandLayers(shorthand)
    : (args.layers ?? []);
  progress.push(pInfo(`Expanding ${incoming.length} layer(s)`, shorthand.length ? 'via shorthand' : 'verbose'));

  // Canonicalize verbose text layers FIRST: fold a bare `text:"…"` alias + flat
  // font/size/color shorthand into { content, style } before any pass that reads
  // content.value (structure/decollide/empty-slot) or the schema validator runs.
  // The shorthand path already normalizes; this rescues a hand-authored verbose
  // text layer from rendering/exporting blank.
  const textAliased = normalizeTextAliases(incoming);
  if (textAliased) progress.push(pInfo(`Normalized ${textAliased} verbose text alias(es)`, 'text:/size:/color: → canonical content + style'));

  // Strip a stray `- null` before any pass reads `.id` off it (crashes loadDesign
  // + poisons the file — suite-030); then flow positionless poster layers.
  const nulled = stripNullLayers(incoming);
  if (nulled) progress.push(pInfo(`Dropped ${nulled} null layer(s)`, 'editor-crash guard — a null layer breaks loadDesign'));
  // Recover a layer-array serialized into ONE text layer (else it renders as a raw JSON blob — suite-033/084).
  const rec = recoverEmbeddedLayers(incoming);
  if (rec.recovered || rec.dropped) progress.push(pInfo(`Recovered ${rec.recovered}, dropped ${rec.dropped} JSON-in-text layer(s)`, 'a stringified layer array was rendering as literal text'));
  const placed = spec.pages ? 0 : placePositionlessLayers(incoming, spec.document.width, spec.document.height);
  if (placed) progress.push(pInfo(`Placed ${placed} positionless layer(s)`, 'flowed into a centered column'));

  // Draw a foreignObject BAR chart natively so it isn't blank in PNG/PDF export —
  // recursing into groups/auto_layouts so a grouped or locked dashboard's charts
  // rasterize too (render fidelity, not a layout rescue, so locking doesn't skip it).
  const rasterizedCharts = rasterizeChartsDeep(incoming);
  if (rasterizedCharts) progress.push(pInfo(`Rasterized ${rasterizedCharts} bar chart(s)`, 'foreignObject charts render BLANK in PNG → drew native rect bars'));

  // Bake any local-framed hand-authored group offset into its children (the
  // engine renders group children at absolute coords; a model that placed them
  // relative to a moved group would otherwise collapse them to the top-left).
  const flattened = flattenRelativeGroups(incoming);
  if (flattened) progress.push(pInfo(`Flattened ${flattened} relative group(s)`, 'baked group offset into children → absolute coords'));

  // Rescue a hand-placed, unsized text poster (a weak model that skipped the
  // preset) into a readable title/subtitle/body hierarchy. Posters only — paged
  // designs route into pages and have their own flow.
  if (!spec.pages) {
    const restructured = structureHandPlacedText(incoming, spec.document.width, spec.document.height);
    if (restructured) progress.push(pInfo(`Structured ${restructured} unsized text layer(s)`, 'hand-placed → title/subtitle/body hierarchy'));
    // Then de-collide: a model that SIZED its text still gives wrong heights (it
    // can't see wrapping), so text overflows and overprints the next layer (the
    // fitness-infographic "Month 4: 12,000" over "User Base"). Re-measure + push
    // overlapping hand-placed layers apart. No-op on a preset (one group) or a
    // clean layout. Posters only — pages flow their own content.
    const decollided = decollideHandPlaced(incoming, spec.document.width, spec.document.height);
    if (decollided) progress.push(pInfo(`Reflowed ${decollided} overlapping hand-placed layer(s)`, 'measured text → no overprint'));
  }

  // Hand-placed VERBOSE text with no color renders #000 (the renderer default) —
  // a dark-on-dark blank on dark themes (live blind-30B: a details block went
  // invisible on a near-black poster). Default a missing text color to the theme
  // $text token, which always contrasts the theme background. The shorthand path
  // already does this via applyVisibleDefaults; this covers the verbose path.
  let coloredText = 0;
  for (const l of incoming) {
    if (l.type !== 'text') continue;
    const st = l.style as { color?: unknown } | undefined;
    if (st?.color === undefined || st.color === '') {
      l.style = { ...l.style, color: '$text' };
      coloredText++;
    }
  }
  if (coloredText) progress.push(pInfo(`Defaulted ${coloredText} text color(s)`, 'missing → $text (legible on theme bg)'));

  const invalid = incoming.find(l => !l?.type || !VALID_LAYER_TYPES.has(l.type));
  if (invalid) {
    return errResult(
      op,
      `Invalid layer.type: "${invalid.type}" (id: ${invalid.id ?? '?'})`,
      `Allowed: ${[...VALID_LAYER_TYPES].join(', ')}`,
    );
  }
  // Catch dimension omissions early — silently-invisible layers are the
  // single most common LLM authoring failure mode in verbose mode.
  for (const l of incoming) {
    const dimMsg = dimError(l);
    if (dimMsg) return errResult(op, dimMsg, 'Pass explicit width + height (px) on every sized layer, or use pos:[x,y,w,h] shorthand.');
  }

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));

  // Canonicalize aliases, then guarantee globally-unique ids before insert.
  normalizeReportAliases(incoming);
  const renamed = dedupeIncomingIds(incoming, collectLayerIds(spec));
  if (renamed.length) progress.push(pInfo(`Renamed ${renamed.length} colliding id(s)`, renamed.slice(0, 8).join(', ')));

  // Routing: a paged design (report/carousel) keeps content in pages[]. Never
  // silently spill into a divergent top-level layers[] — that splits the canvas
  // from the editor and hides half the report. Default to the sole page.
  const pages = spec.pages;
  let activeLayers: Layer[] = incoming;
  if (pages && pages.length) {
    const pageId = args.page_id ?? (pages.length === 1 ? pages[0].id : undefined);
    if (!pageId) return errResult(op, `Design has ${pages.length} pages — pass page_id to say which one`, `Pages: ${pages.map(p => p.id).join(', ')}`, progress);
    const page = pages.find(p => p.id === pageId);
    if (!page) return errResult(op, `Page not found: ${pageId}`, `Pages: ${pages.map(p => p.id).join(', ')}`, progress);
    if (!args.page_id && pages.length === 1) progress.push(pInfo('Routed to the only page', pageId));
    if (!page.layers) page.layers = [];
    const sunk = demoteCoveringBackdrops(page.layers, incoming, spec.document.width, spec.document.height);
    if (sunk) progress.push(pInfo(`Sank ${sunk} full-canvas backdrop(s) behind page content`, 'a background added last would have blanked the page'));
    page.layers.push(...incoming);
    activeLayers = page.layers;
  } else {
    if (!spec.layers) spec.layers = [];
    const hadContent = spec.layers.length > 0;
    const sunk = demoteCoveringBackdrops(spec.layers, incoming, spec.document.width, spec.document.height);
    if (sunk) progress.push(pInfo(`Sank ${sunk} full-canvas backdrop(s) behind poster content`, 'a background added last would have blanked the poster'));
    spec.layers.push(...incoming);
    activeLayers = spec.layers;
    // Auto-fit the canvas to a fresh single full-bleed preset. A flow preset
    // (sections/stat/…) builds its group at the origin sized to its own content.
    // Fit the document to it — HEIGHT (short → shorter page, long → taller, no
    // dead band, no spill) AND WIDTH, so a poster the model created on a
    // mismatched canvas (e.g. a 2000×1080 LANDSCAPE doc holding a 1080-wide
    // portrait preset) doesn't render in a half-width column with the bottom
    // clipped (g_cyber). Only when this preset IS the whole poster.
    // The poster IS the sole content group, possibly accompanied ONLY by
    // full-canvas backdrop rect(s) the model added as a separate background. A
    // model that added [bg-rect, sections] in one call used to skip this fit
    // (length !== 1), leaving the content group (e.g. 972) on a tall doc (1920)
    // with the backdrop showing through the empty lower half (the sage-block
    // "In Praise of Doing Less" bug). Fit the doc to the group and clamp the
    // backdrops to it so there's no dead band.
    if (!hadContent) {
      const { width: DW, height: DH } = spec.document;
      type Box = Layer & { x?: number; y?: number; width?: number; height?: number };
      const groups = incoming.filter(l => l.type === 'group') as Box[];
      const others = incoming.filter(l => l.type !== 'group') as Box[];
      const fullCanvasRect = (l: Box): boolean => l.type === 'rect'
        && (l.width ?? 0) >= DW * 0.9 && (l.height ?? 0) >= DH * 0.9;
      const g = groups.length === 1 ? groups[0] : undefined;
      if (g && others.every(fullCanvasRect)
        && (g.x ?? 0) <= DW * 0.02 && (g.y ?? 0) <= DH * 0.02
        && typeof g.width === 'number' && g.width > 0 && typeof g.height === 'number' && g.height > 0) {
        // The user/model created the doc with a deliberate standard portrait/
        // square ratio (4:5, 9:16, 1:1, …) → HONOR it instead of silently
        // resizing the canvas to the content's natural height (4:5 → 3:5).
        const ratioFit = honorPosterRatio(g as unknown as Layer, others as unknown as Layer[], DW, DH);
        if (ratioFit) {
          spec.document.width = ratioFit.width;
          spec.document.height = ratioFit.height;
          progress.push(pInfo(`Kept the requested ${DW}×${DH} aspect ratio`, `fit the content to a ${ratioFit.width}×${ratioFit.height} canvas (same shape) instead of reshaping it to the content's height`));
        } else {
          spec.document.width = g.width;
          spec.document.height = g.height;
          for (const r of others) {
            if ((r.height ?? 0) > g.height) r.height = g.height;
            if ((r.width ?? 0) > g.width) r.width = g.width;
          }
        }
      }
    }
  }
  // Remove stacked duplicate full-canvas presets (a thrashing model rebuilds the
  // poster several times, leaving N overlapping content groups). Keep the final
  // one; on a poster, re-fit the doc to it (a later add_layers means the fresh-
  // poster auto-fit above didn't fire).
  const droppedStacked = dropStackedPresets(activeLayers, spec.document.width, spec.document.height);
  if (droppedStacked) {
    progress.push(pInfo(`Removed ${droppedStacked} stacked duplicate preset(s)`, 'a thrashing rebuild stacked full-canvas presets — kept the final one'));
    if (!spec.pages) {
      const g = activeLayers.find(l => isFullBleedContentPreset(l, spec.document.width, spec.document.height)) as (Layer & { width?: number; height?: number }) | undefined;
      if (g && typeof g.width === 'number' && g.width > 0 && typeof g.height === 'number' && g.height > 0) {
        const ratioFit = honorPosterRatio(g as unknown as Layer, [], spec.document.width, spec.document.height);
        if (ratioFit) {
          spec.document.width = ratioFit.width;
          spec.document.height = ratioFit.height;
        } else {
          spec.document.width = g.width;
          spec.document.height = g.height;
        }
      }
    }
  }

  // Multi-section brief → the model stacked 2+ DISTINCT full-bleed presets at the
  // same box (only the top one would render). Re-seat each into its own vertical
  // band so every section is visible (poster only; carousel sections are pages).
  if (!spec.pages) {
    const stacked = stackDistinctFullBleedPresets(activeLayers, spec.document, spec.document.width, spec.document.height);
    if (stacked) progress.push(pInfo(`Stacked ${stacked} full-bleed section(s) into bands`, 'distinct full-canvas sections were piled at one spot — split into a vertical brochure'));
  }

  // Guarantee a canvas GROUND: a blind model routinely omits the background, so a
  // poster with real content but no full-canvas backdrop rasterizes to a stark WHITE
  // void (suite-022 noir, suite-042 perfume). design-lint only WARNS the model (which
  // it ignores), so paint the theme's own background as a back rect — the ground the
  // theme already implies. A real bg (rect / token / preset group) is detected and we
  // skip; an empty scaffold (no content) is left for the model. Never overrides intent
  // (the theme color IS the intent), only fills an omission.
  if (!spec.pages) {
    const themeC = resolveThemeColors(spec);
    const W = spec.document.width, H = spec.document.height;
    if (themeC && hasRenderableContent(activeLayers) && !hasFullCanvasBackdrop(activeLayers, W, H)) {
      let minZ = Infinity;
      for (const l of activeLayers) { const z = Number((l as unknown as Record<string, unknown>)['z']); if (Number.isFinite(z)) minZ = Math.min(minZ, z); }
      const bgZ = (Number.isFinite(minZ) ? minZ : 0) - 1;
      activeLayers.unshift({ id: 'bg_auto', type: 'rect', z: bgZ, x: 0, y: 0, width: W, height: H, fill: { type: 'solid', color: themeC.bg } } as unknown as Layer);
      progress.push(pInfo('Added a full-canvas background', `no background present → painted the theme ground (${themeC.bg}) so the canvas isn't a white void`));
    }
  }

  // First collapse repeated strings from a rebuild to one copy each (runs before the
  // preset-thrash pass so N duplicate titles become ONE unique title it can keep).
  const droppedDupText = dedupDuplicateText(activeLayers, spec.document.width, spec.document.height);
  if (droppedDupText) progress.push(pInfo(`Removed ${droppedDupText} duplicate text/backdrop(s)`, 'a rebuild stamped the same text several times — kept the final copy'));

  // Then remove loose hand-placed duplicates from a rebuild thrash (many stacked
  // full-canvas backdrops + a complete content preset → keep the preset + a unique
  // title, drop the loose copies that just repeat the preset's own content).
  const droppedThrash = dropThrashDuplicates(activeLayers, spec.document.width, spec.document.height);
  if (droppedThrash) progress.push(pInfo(`Removed ${droppedThrash} hand-placed duplicate(s)`, 'a thrashing rebuild stacked loose copies over the content preset — kept the preset'));

  // Catch a rebuild that re-stacked a chart/diagram group + a reworded caption
  // without re-laying the backdrop (the dup-backdrop gates miss it): collapse
  // stacked duplicate groups + overlapping near-duplicate text.
  const droppedOverlap = dedupOverlappingDuplicates(activeLayers, spec.document.width, spec.document.height);
  if (droppedOverlap) progress.push(pInfo(`Removed ${droppedOverlap} stacked/overlapping duplicate(s)`, 'a rebuild stacked identical groups + overlapping captions — kept the last'));

  // On a hand-placed poster (no preset owns the layout), shrink any oversized
  // multi-line hero line so the attribution/footer it placed below still fits —
  // otherwise the de-collide shoves them off the bottom.
  const hasContentPreset = activeLayers.some(l => l?.type === 'group' && CONTENT_PRESET_RE.test(String((l as unknown as Record<string, unknown>)['id'] ?? '')));
  if (!spec.pages && !hasContentPreset) {
    const fitted = fitOverflowingHeroText(activeLayers, spec.document.width, spec.document.height);
    if (fitted) progress.push(pInfo(`Fitted ${fitted} oversized text block(s)`, 'shrank a wrapped hero line so its attribution/footer fits on canvas'));
  }

  // Give hand-placed text its TRUE wrapped height (the model stores height:0) so
  // every geometry pass below sees the box that will actually render — without it
  // a wrapped quote reads as a zero-height box and overprints / spills unchecked.
  const measured = setMeasuredTextHeights(activeLayers, spec.document.width);
  if (measured) progress.push(pInfo(`Measured ${measured} text height(s)`, 'set true wrapped height so overlap/overflow passes can see the box'));

  // Cross-batch de-collide: the per-batch pass sees ONLY the current call, so a
  // poster hand-placed across SEVERAL add_layers calls overprints (suite-106). Re-run
  // on the MERGED set — but only when fully hand-placed, never inside a preset group.
  let recollided = 0;
  if (!spec.pages && !activeLayers.some(l => isFullBleedContentPreset(l, spec.document.width, spec.document.height))) {
    recollided = decollideHandPlaced(activeLayers, spec.document.width, spec.document.height);
    if (recollided) progress.push(pInfo(`Reflowed ${recollided} cross-batch overlapping layer(s)`, 'merged hand-placed text added across calls → no overprint'));
  }

  // Pull any top-level content layer the model placed fully off-canvas back
  // inside (e.g. a title computed at y:1095 on a 1080 poster) — otherwise it
  // renders nowhere and the content is silently lost.
  const snappedOff = snapOffCanvasContent(activeLayers, spec.document.width, spec.document.height);
  if (snappedOff) progress.push(pInfo(`Snapped ${snappedOff} off-canvas layer(s) inside`, 'content placed past the canvas edge would have rendered nowhere'));

  // Give a composition flush against the top edge (first text at y:0) a real top
  // margin so the headline doesn't clip — a downward shift, only when there's room.
  const topMargined = ensureTopMargin(activeLayers, spec.document.width, spec.document.height);
  if (topMargined) progress.push(pInfo(`Added a top margin (${topMargined} layer(s) shifted)`, 'content flush against the canvas top edge was nudged down for breathing room'));

  // Surface a hand-placed title buried under a full-canvas preset's background
  // (lift it above the wash; re-seat up top if the header's empty) — else invisible.
  const promoted = promoteCoveredTitle(activeLayers, spec.document.width, spec.document.height);
  if (promoted) progress.push(pInfo(`Surfaced ${promoted} covered title(s)`, 'a title hidden under a full-canvas preset was lifted into view'));

  // Rescue near-invisible text (a nested style.color left dark on a dark bg, pale
  // labels on a light bg) — recover the model's own flat color if it's legible,
  // else force a backdrop-matched neutral. Illegible text is never the intent.
  const relitTheme = resolveThemeSpec(spec);
  const relit = fixInvisibleText(activeLayers, spec.document.width, spec.document.height, relitTheme);
  if (relit) progress.push(pInfo(`Re-lit ${relit} near-invisible text(s)`, 'text that rendered invisible on its background was recolored to read'));

  // Mechanical typographic fix: ALL-CAPS always needs ≥0.06em tracking (the #1
  // AI tell in blind-model output). Adds it only where missing; never overrides
  // the model's own tracking/look (§0.4 — engine assists, doesn't redesign).
  const tracked = fixCapsTracking(activeLayers);
  if (tracked) progress.push(pInfo(`Tracked ${tracked} ALL-CAPS text(s)`, 'caps without letter-spacing read cramped/generic — added ~0.06em'));

  // Re-center a title the model anchored at the canvas mid-line (docW/2 used as a
  // left edge → title stuck in the right half with an empty left).
  const recentered = recenterHalfAnchoredText(activeLayers, spec.document.width, spec.document.height);
  if (recentered) progress.push(pInfo(`Re-centered ${recentered} mid-anchored text(s)`, 'a title placed with its left edge on the canvas centerline was centered'));

  // Re-stack hand-placed texts the model dropped at the same y (a title overprinting
  // its intro) into separate lines, so they read instead of smearing together.
  const spread = spreadStackedText(activeLayers, spec.document.width, spec.document.height);
  if (spread) progress.push(pInfo(`Un-stacked ${spread} overlapping text(s)`, 'distinct texts at the same position were spread into lines'));

  // Drop any space-filling motif that overlaps content. Runs on the MERGED set
  // (existing + incoming), so a motif added in its own add_layers call — the
  // common shape, since the content preset and the decoration arrive separately —
  // is still checked against the content already on the page. A motif that isn't
  // in dead space has failed its only job; removing it beats a strikethrough.
  const droppedMotifs = dropCollidingMotifs(activeLayers);
  if (droppedMotifs) progress.push(pInfo(`Dropped ${droppedMotifs} colliding motif(s)`, 'decoration overlapped content → removed (no dead space to fill)'));

  // Deck cohesion: give every slide the shared background so a bg-less hand-placed
  // cover doesn't render white against cream/dark content slides.
  if (spec.pages) {
    const bgAdded = ensureDeckPageBackgrounds(spec.pages, spec.document.width, spec.document.height);
    if (bgAdded) progress.push(pInfo(`Added a deck background to ${bgAdded} slide(s)`, 'matched the shared deck color so the cover is cohesive'));
  } else {
    // Trim a trailing dead band: a top-anchored poster whose content fills only the
    // upper canvas (a flow preset that over-measured, or sparse hand-placed content)
    // — shrink the page to the real content so there's no empty lower half.
    const trimmed = trimTrailingDeadBand(activeLayers, spec.document.width, spec.document.height);
    if (trimmed) { progress.push(pInfo(`Trimmed the canvas to ${trimmed}px`, 'removed a dead band of background below the last content')); spec.document.height = trimmed; }
  }

  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  progress.push(pOk(`Added ${incoming.length} layer(s)`, incoming.map(l => l.id).join(', ')));

  const lint = lintComposition(activeLayers, spec.document.width, spec.document.height);
  // Quality critic — advisory; only when the page looks "complete" (the full
  // poster has been composed, not a 2-layer partial), so we guide, not nag.
  const review = activeLayers.length >= 6
    ? [...reviewComposition(activeLayers, spec.document.width, spec.document.height), ...lintAiSlop(activeLayers)]
    : [];
  // Heal touched hand-placed layers → lead with the locked-group opt-out (lets a
  // strong model keep deliberate art-direction; surfaces only when heal fired).
  const heal = lockedHealNote([[relit, 're-lit'], [recollided, 'reflowed'], [snappedOff, 'snapped-in'], [recentered, 're-centered'], [spread, 'un-stacked'], [droppedMotifs, 'dropped-motif']], spec.document.width, spec.document.height);
  const notes = [...(heal ? [heal] : []), ...(shorthand.length ? diagnoseShorthandKeys(shorthand) : []), ...diagnoseLayers(incoming), ...lint, ...review];
  for (const n of notes) progress.push(pInfo('Layer note', n));
  // Report cross-reference diagnostics (charts→datasets, buttons→modals, …) so
  // the LLM building the report sees broken refs immediately, not at export.
  const diagnostics = spec.meta.type === 'report' ? validateReport(spec) : [];
  for (const d of diagnostics) progress.push(pWarn(`[${d.code}] ${d.message}`, d.fix));
  const next_action: NextAction = { tool: 'seal_design', params: { design_path: dPath }, remaining: 0, hint: notes.length ? `Layers added with ${notes.length} note(s) to address — see notes — then seal_design.` : 'Layers added. Call seal_design or add more layers.' };
  const context = buildContext(op, `Added ${incoming.length} layer(s) to ${path.basename(dPath)}`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const handover = buildHandover('COMPOSE', { design_path: dPath, ...(args.task_path ? { task_path: args.task_path } : {}) });
  return okResult(op, { added: incoming.length, layer_ids: incoming.map(l => l.id), ...(notes.length ? { notes } : {}), ...(diagnostics.length ? { diagnostics } : {}), next_action, progress, context, handover }, bak);
}

// Pure-decoration leaf types — a slide built from ONLY these renders blank.

export const DECORATIVE_LAYER_TYPES = new Set(['rect', 'ellipse', 'circle', 'line', 'path', 'polygon', 'polyline', 'particle', 'connector', 'background', 'backdrop']);
// Does a page carry any readable content (text/image/icon/chart/preset), or is
// it only background shapes? Recurses into groups/containers.

export function pageHasReadableContent(layers: Layer[]): boolean {
  return layers.some(l => {
    const kids = (l as Layer & { layers?: Layer[] }).layers;
    if (Array.isArray(kids)) return pageHasReadableContent(kids);
    return !DECORATIVE_LAYER_TYPES.has(l.type);
  });
}

export function appendPage(args: {
  design_path: string; page_id?: string; label?: string; template_ref?: string;
  slots?: Record<string, unknown>; layers?: Layer[]; layers_shorthand?: ShorthandLayer[];
  task_path?: string; project_path?: string; replace?: boolean;
}): ToolResult {
  const op = 'append_page';
  const progress: ProgressItem[] = [];
  const dPath = resolveDesignPath(args.design_path, args.project_path);
  if (!fs.existsSync(dPath)) return errResult(op, `Design not found: ${dPath}`, 'Check the design_path value.');

  const spec = readYAML<DesignSpec>(dPath);
  let pageShorthand = coerceShorthandLayers(args.layers_shorthand as unknown);
  // Hoist a bare page/document wrapper before expansion (same blank-slide guard
  // as add_layers) so a nested layers:[…] container isn't dropped to a group.
  if (pageShorthand.length) {
    const uw = unwrapBareContainers(pageShorthand, spec.document.width, spec.document.height);
    if (uw.unwrapped) {
      pageShorthand = uw.layers;
      progress.push(pInfo(`Unwrapped ${uw.unwrapped} container wrapper(s)`, 'hoisted nested layers to the page'));
    }
    // Fill the page with a boxless full-bleed preset so a tall slide (e.g. a
    // 1080×1350 carousel page) has no dead strip below a 1080² preset.
    const filled = fillBleedPresetDims(pageShorthand, spec.document.width, spec.document.height);
    if (filled) progress.push(pInfo(`Sized ${filled} full-bleed preset(s) to the page`, `${spec.document.width}×${spec.document.height}`));
    // A content-sized list/steps preset on a fixed slide left an empty lower band;
    // hand it the page box so it fills + centers (carousel pages only — a poster
    // list still auto-fits its canvas to the content).
    const flowFilled = fillFlowPresetsToPage(pageShorthand, spec.document.width, spec.document.height);
    if (flowFilled) progress.push(pInfo(`Filled ${flowFilled} flow preset(s) to the page`, 'centered content, no dead band'));
    // Cohesion at the SOURCE: a model that appends bare `{type:"sections"}` slides
    // (no bg/font) would otherwise get a per-slide mood seeded from each slide's
    // content. Stamp the deck identity so every bg-less slide seeds ONE shared
    // mood (palette+font). Runs for the first page too, so the whole set matches.
    const deckSeed = (spec.meta?.name && String(spec.meta.name).trim()) || spec.meta?.id || '';
    const seeded = stampDeckSeed(pageShorthand, deckSeed);
    if (seeded) progress.push(pInfo(`Locked deck mood on ${seeded} slide(s)`, 'shared palette+font from the deck identity'));
    // Keep the deck cohesive: snap a slide that flips light↔dark or changes the
    // heading font back to the look the first page established.
    if (spec.pages?.length) {
      const locked = lockCarouselCanvas(spec.pages, pageShorthand);
      if (locked.bg || locked.font) progress.push(pInfo(`Locked carousel cohesion`, `${locked.bg} bg + ${locked.font} font snapped to the deck`));
    }
  }
  // Same theme reconciliation as posters (see addLayers): keep a slide's seeded
  // mood from fighting the deck's theme polarity. Deck cohesion already locks one
  // shared mood, so every slide reconciles the same way.
  const pageThemeColors = resolveThemeColors(spec);
  if (pageThemeColors && pageShorthand.length) {
    for (const l of pageShorthand) {
      const rr = l as unknown as Record<string, unknown>;
      if (rr['__theme'] === undefined) rr['__theme'] = pageThemeColors;
    }
  }
  const layers: Layer[] = pageShorthand.length
    ? expandShorthandLayers(pageShorthand)
    : (args.layers ?? []);
  normalizeTextAliases(layers); // canonicalize verbose text:/size:/color: → content+style
  // Rescue chain on the page layers (recover JSON-in-text → strip null → flow
  // positionless → fill bg → de-collide → re-light); pages historically only
  // de-collided, so a verbose carousel page piled at the origin (suite-079/009).
  const pf = finalizePageLayers(layers, spec.document.width, spec.document.height, resolveThemeSpec(spec));
  for (const [n, msg] of [[pf.nulls, 'null layer(s) dropped (editor-crash guard)'], [pf.recovered, 'JSON-in-text layer(s) recovered'], [pf.placed, 'positionless layer(s) flowed into a column'], [pf.bgFilled, 'empty background(s) filled from text polarity'], [pf.reflowed, 'overlapping layer(s) reflowed'], [pf.relit, 'low-contrast layer(s) re-lit']] as [number, string][]) {
    if (n) progress.push(pInfo(`Page: ${n} ${msg}`, 'rescue pass'));
  }
  // Never silently append an EMPTY page when content was MEANINGFULLY supplied
  // but coerced to nothing (e.g. a stringified shorthand that didn't parse) — a
  // blank slide would still report success and the dropped copy goes unnoticed,
  // exactly how a 6-page carousel sealed with every page empty. An explicit
  // `layers: []` / `layers_shorthand: []` scaffold call stays allowed.
  const rawSh = args.layers_shorthand as unknown;
  const shorthandSupplied =
    (typeof rawSh === 'string' && rawSh.trim().length > 0) ||
    (Array.isArray(rawSh) && rawSh.length > 0) ||
    (rawSh != null && typeof rawSh === 'object' && !Array.isArray(rawSh) && Object.keys(rawSh as object).length > 0);
  if (layers.length === 0 && shorthandSupplied) {
    return errResult(op,
      'append_page produced 0 layers — the page content did not parse, so nothing was written.',
      'Pass layers_shorthand as an ARRAY of preset objects (ONE per slide), e.g. layers_shorthand=[{type:"editorial", bg:"#FAF5EC", accent:"#B8543C", text_color:"#1A1A1A", kicker:"…", title:"…", deck:"…"}].', progress);
  }
  progress.push(pInfo(`Page has ${layers.length} layer(s)`, pageShorthand.length ? 'via shorthand' : 'verbose'));

  const bak = snapshot(dPath);
  progress.push(pInfo('Snapshot created', path.basename(bak)));
  if (!spec.pages) spec.pages = [];

  // Ensure a UNIQUE page id. A model that labels two slides the same (or passes
  // page_id twice) would otherwise create duplicate ids — which makes a page_id-
  // scoped op (render_preview/remove_layer/update_layer) ambiguous and can break
  // navigation/export. Suffix on collision, mirroring the layer-id de-dupe —
  // UNLESS replace:true, which makes the same page_id an explicit IN-PLACE
  // replace (WP-3.3): fixing one deck page no longer means rebuilding the deck.
  const desiredId = args.page_id ?? `page_${spec.pages.length + 1}`;
  const existingIdx = spec.pages.findIndex(p => p.id === desiredId);
  let pageId = desiredId;
  let replacedAt = -1;
  if (existingIdx >= 0 && args.replace) {
    const prev = spec.pages[existingIdx];
    spec.pages[existingIdx] = { id: desiredId, label: args.label ?? prev.label, template_ref: args.template_ref, slots: args.slots, layers };
    replacedAt = existingIdx;
    progress.push(pOk(`Replaced page "${desiredId}" in place`, `position ${existingIdx + 1} of ${spec.pages.length} — order and other pages untouched`));
  } else {
    const taken = new Set(spec.pages.map(p => p.id));
    for (let n = 2; taken.has(pageId); n++) pageId = `${desiredId}-${n}`;
    if (pageId !== desiredId) progress.push(pInfo(`Renamed colliding page id`, `${desiredId} → ${pageId} — pass replace:true to overwrite the existing page in place instead`));
    spec.pages.push({ id: pageId, label: args.label ?? `Page ${spec.pages.length + 1}`, template_ref: args.template_ref, slots: args.slots, layers });
  }

  if (spec.meta.generation) {
    spec.meta.generation.completed_pages = spec.pages.length;
    spec.meta.generation.total_pages = Math.max(spec.meta.generation.total_pages, spec.pages.length);
    spec.meta.generation.last_operation = 'append_page';
  }
  spec.meta.modified = new Date().toISOString().split('T')[0];
  writeYAML(dPath, spec);
  if (replacedAt < 0) progress.push(pOk(`Appended page "${pageId}"`, `total: ${spec.pages.length} page(s)`));

  const pageHealNote = lockedHealNote([[pf.relit, 're-lit'], [pf.reflowed, 'reflowed']], spec.document.width, spec.document.height);
  const notes = [...(pageHealNote ? [pageHealNote] : []), ...(pageShorthand.length ? diagnoseShorthandKeys(pageShorthand) : []), ...diagnoseLayers(layers)];
  for (const n of notes) progress.push(pInfo('Layer note', n));

  let next_action: NextAction | undefined;
  if (args.task_path && fs.existsSync(args.task_path)) {
    const taskSpec = readTask(args.task_path);
    markPageDone(taskSpec, pageId);
    writeTask(args.task_path, taskSpec);
    next_action = buildNextAction(taskSpec, args.task_path);
    progress.push(pInfo('Task updated', next_action.tool));
  }

  const context = buildContext(op, replacedAt >= 0
    ? `Replaced page "${pageId}" in place — ${spec.pages.length} total`
    : `Appended page "${pageId}" — ${spec.pages.length} total`, [
    { type: 'design', path: dPath, role: 'updated' },
  ]);
  const remaining = next_action ? next_action.remaining : 0;
  const handover = buildHandover(remaining === 0 ? 'SEAL' : 'COMPOSE', {
    design_path: dPath, ...(args.task_path ? { task_path: args.task_path } : {}),
  }, { type: 'carousel' });
  const link = buildEditorLink(dPath, { page: replacedAt >= 0 ? replacedAt : spec.pages.length - 1 });
  return okResult(op, { page_id: pageId, page_count: spec.pages.length, open_url: link.open_url, share_url: link.short_url, editor_url: link.editor_url, ...(notes.length ? { notes } : {}), ...(next_action ? { next_action } : {}), progress, context, handover, _attachments: [link.attachment] }, bak);
}

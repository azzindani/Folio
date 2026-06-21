// Folio renderer — group/auto-layout/qr/popup/particle/widget renderers (verbatim).
import type { Layer, GroupLayer, QRCodeLayer, AutoLayoutLayer, PopupLayer, ParticleLayer, ButtonLayer, TabsLayer, AccordionLayer, FilterBarLayer, ToggleLayer, TooltipLayer, CalloutLayer, ProgressLayer } from '../schema/types';
import { createSVGElement } from './svg-utils';

import { applyFill } from './fill-renderer';
import { applyEffects } from './effects-renderer';

import { encodeQR } from './qr/encode';
import { applyCommonAttributes, applyStroke, normalizeStroke, normalizePadding, escHtml, foPreview, numOr } from './layer-renderers-shared';

export function renderGroup(
  layer: GroupLayer,
  svg: SVGSVGElement,
  renderLayerFn: (layer: Layer, svg: SVGSVGElement) => SVGElement,
): SVGElement {
  const g = createSVGElement('g');

  const sorted = [...layer.layers].sort((a, b) => a.z - b.z);
  for (const child of sorted) {
    g.appendChild(renderLayerFn(child, svg));
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);

  return g;
}

// ── QR Code ─────────────────────────────────────────────────
// Real QR Code renderer using Reed-Solomon error correction.
// Supports Version 1 (21×21), EC levels L/M/Q/H, byte mode.
// Input longer than ~17 chars (H) / ~25 chars (L) will be truncated to fit.

export function renderQRCode(layer: QRCodeLayer, _svg: SVGSVGElement): SVGElement {
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 120;
  const h = typeof layer.height === 'number' ? layer.height : 120;
  const fg = layer.fill ?? '#000000';
  const bg = layer.background ?? 'transparent';
  const ec = (layer.error_correction ?? 'M') as 'L' | 'M' | 'Q' | 'H';

  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  if (bg !== 'transparent') {
    g.appendChild(createSVGElement('rect', { x, y, width: w, height: h, fill: bg }));
  }

  // Encode — returns 21×21 boolean matrix
  let matrix: boolean[][];
  try {
    matrix = encodeQR(layer.value, ec);
  } catch {
    // Fallback: empty black square with error indicator
    g.appendChild(createSVGElement('rect', { x, y, width: w, height: h, fill: '#ff000033', stroke: '#e94560', 'stroke-width': 2 }));
    return g;
  }

  const MODULES = matrix.length;
  const cellSize = w / MODULES;

  for (let row = 0; row < MODULES; row++) {
    for (let col = 0; col < MODULES; col++) {
      if (matrix[row][col]) {
        g.appendChild(createSVGElement('rect', {
          x: x + col * cellSize,
          y: y + row * cellSize,
          width: cellSize + 0.5, // +0.5 prevents hairline gaps between cells
          height: cellSize + 0.5,
          fill: fg,
        }));
      }
    }
  }

  if (layer.effects) applyEffects(g, layer.effects, _svg);
  return g;
}

// ── Auto Layout ──────────────────────────────────────────────

export function renderAutoLayout(
  layer: AutoLayoutLayer,
  svg: SVGSVGElement,
  renderChild: (l: Layer, s: SVGSVGElement) => SVGElement,
): SVGElement {
  const isRow = layer.direction === 'row';
  const gap = layer.gap ?? 0;
  const pad = normalizePadding(layer.padding);
  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width === 'number' ? layer.width : 0;
  const h = typeof layer.height === 'number' ? layer.height : 0;

  const align   = layer.align_items    ?? 'start';
  const justify = layer.justify_content ?? 'start';

  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  if (layer.fill && layer.fill.type !== 'none') {
    const bg = createSVGElement('rect', { x, y, width: w, height: h });
    if (typeof layer.radius === 'number') {
      bg.setAttribute('rx', String(layer.radius));
      bg.setAttribute('ry', String(layer.radius));
    }
    const fillResult = applyFill(layer.fill, svg, { width: w, height: h });
    bg.setAttribute('fill', fillResult.fill);
    if (fillResult.opacity !== undefined) bg.setAttribute('opacity', String(fillResult.opacity));
    fillResult.extraElements?.forEach(el => g.appendChild(el));
    const bgStroke = normalizeStroke(layer);
    if (bgStroke) applyStroke(bg, bgStroke, svg);
    g.appendChild(bg);
  }

  const sorted = [...(layer.layers ?? [])].sort((a, b) => a.z - b.z);

  const mainSizes = sorted.map(child =>
    isRow ? (typeof child.width  === 'number' ? child.width  : 0)
          : (typeof child.height === 'number' ? child.height : 0),
  );
  const crossSizes = sorted.map(child =>
    isRow ? (typeof child.height === 'number' ? child.height : 0)
          : (typeof child.width  === 'number' ? child.width  : 0),
  );

  const mainPadStart  = isRow ? pad.left  : pad.top;
  const mainPadEnd    = isRow ? pad.right : pad.bottom;
  const crossPadStart = isRow ? pad.top   : pad.left;
  const containerMain  = isRow ? w : h;
  const containerCross = isRow ? h : w;
  const availableMain  = containerMain  - mainPadStart - mainPadEnd;
  const availableCross = containerCross - crossPadStart - (isRow ? pad.bottom : pad.right);

  // Flexbox-style sizing for children that omit dimensions. Models expect a
  // container to distribute space, but Folio sizes children from their own
  // width/height — so a row of 3 sizeless columns would collapse onto each
  // other. Children with no main-axis size share the leftover main space
  // equally (flex-grow:1); children with no cross-axis size fill the cross.
  // Skipped when wrapping (wrap needs intrinsic sizes). Sized children are
  // left untouched.
  if (!layer.wrap && availableMain > 0) {
    const flexIdx = sorted.map((_, i) => i).filter(i => !(mainSizes[i] > 0));
    if (flexIdx.length) {
      const fixed = mainSizes.reduce((s, v) => s + (v > 0 ? v : 0), 0);
      const gaps = Math.max(0, sorted.length - 1) * gap;
      const share = Math.max(0, (availableMain - fixed - gaps) / flexIdx.length);
      for (const i of flexIdx) mainSizes[i] = share;
    }
    for (let i = 0; i < crossSizes.length; i++) if (!(crossSizes[i] > 0)) crossSizes[i] = availableCross;
  }
  const totalMain = mainSizes.reduce((s, v) => s + v, 0) + Math.max(0, sorted.length - 1) * gap;

  const calcCursor = (total: number, count: number, sizes: number[]): { start: number; dynGap: number } => {
    switch (justify) {
      case 'center':      return { start: mainPadStart + (availableMain - total) / 2,              dynGap: gap };
      case 'end':         return { start: mainPadStart + availableMain - total,                    dynGap: gap };
      case 'space-between': return { start: mainPadStart, dynGap: count > 1 ? (availableMain - sizes.reduce((s,v)=>s+v,0)) / (count-1) : 0 };
      case 'space-around':  { const sp = availableMain - sizes.reduce((s,v)=>s+v,0); return { start: mainPadStart + (sp/count)/2, dynGap: sp/count }; }
      default:            return { start: mainPadStart,                                            dynGap: gap };
    }
  };

  const placeChild = (child: Layer, mc: number, cc: number, cIdx: number, trackCross: number): void => {
    let crossPos: number;
    switch (align) {
      case 'center': crossPos = cc + (trackCross - crossSizes[cIdx]) / 2; break;
      case 'end':    crossPos = cc + trackCross - crossSizes[cIdx]; break;
      default:       crossPos = cc;
    }
    // Apply the layout-computed sizes (== the child's own size when it set
    // one; the flex/fill value otherwise) so flexed/filled children actually
    // render at their distributed size and nested containers know their box.
    const mainSize  = mainSizes[cIdx];
    const crossSize = align === 'stretch' ? trackCross : crossSizes[cIdx];
    const placed: Layer = {
      ...child,
      x: isRow ? x + mc : x + crossPos,
      y: isRow ? y + crossPos : y + mc,
      width:  isRow ? mainSize : crossSize,
      height: isRow ? crossSize : mainSize,
    };
    g.appendChild(renderChild(placed, svg));
  };

  if (layer.wrap && availableMain > 0) {
    // Group children into wrap tracks
    const tracks: { idxs: number[] }[] = [];
    let track: number[] = [];
    let trackUsed = 0;
    for (let i = 0; i < sorted.length; i++) {
      const sz = mainSizes[i];
      const needed = track.length === 0 ? sz : trackUsed + gap + sz;
      if (track.length > 0 && needed > availableMain + 0.5) {
        tracks.push({ idxs: [...track] });
        track = [i]; trackUsed = sz;
      } else {
        track.push(i); trackUsed = needed;
      }
    }
    if (track.length > 0) tracks.push({ idxs: track });

    let crossCursor = crossPadStart;
    for (const { idxs } of tracks) {
      const tSizes = idxs.map(i => mainSizes[i]);
      const tTotal = tSizes.reduce((s,v)=>s+v,0) + Math.max(0, idxs.length-1) * gap;
      const trackCross = Math.max(...idxs.map(i => crossSizes[i]));
      const { start, dynGap } = calcCursor(tTotal, idxs.length, tSizes);
      let mc = start;
      for (let j = 0; j < idxs.length; j++) {
        placeChild(sorted[idxs[j]], mc, crossCursor, idxs[j], trackCross);
        mc += tSizes[j] + dynGap;
      }
      crossCursor += trackCross + gap;
    }
  } else {
    // No wrap — linear pass
    const { start, dynGap } = calcCursor(totalMain, sorted.length, mainSizes);
    let cursor = start;
    for (let i = 0; i < sorted.length; i++) {
      placeChild(sorted[i], cursor, crossPadStart, i, availableCross);
      cursor += mainSizes[i] + dynGap;
    }
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, svg);
  return g;
}

export function renderPopup(
  layer: PopupLayer,
  svg: SVGSVGElement,
  renderChildFn: (l: Layer, s: SVGSVGElement) => SVGElement,
): SVGElement {
  // Popup renders as a hidden <g> group; the report runtime JS shows/hides it.
  const w = typeof layer.width === 'number' ? layer.width : 600;
  const h = typeof layer.height === 'number' ? layer.height : 400;

  const g = createSVGElement('g', {
    'data-popup-id': layer.id,
    'data-trigger-id': layer.trigger_id ?? '',
    'data-modal': String(layer.modal ?? true),
    'data-animation': layer.open_animation ?? 'fade',
  });

  // Backdrop rect (hidden by default)
  const backdrop = createSVGElement('rect', {
    x: 0, y: 0, width: '100%', height: '100%',
    fill: 'rgba(0,0,0,0.5)',
    'data-popup-backdrop': layer.id,
  });
  g.appendChild(backdrop);

  // Panel rect
  const panel = createSVGElement('rect', {
    x: layer.x ?? 0,
    y: layer.y ?? 0,
    width: w,
    height: h,
    fill: '#1a1a2e',
    rx: 8,
    ry: 8,
  });
  g.appendChild(panel);

  // Child layers
  for (const child of (layer.layers ?? [])) {
    g.appendChild(renderChildFn(child, svg));
  }

  // Hidden by default; runtime JS handles show/hide
  g.setAttribute('visibility', 'hidden');
  g.setAttribute('opacity', '0');

  applyCommonAttributes(g, layer);
  return g;
}

// ── Particle ─────────────────────────────────────────────────

/** Deterministic PRNG — seed with layer id + index to avoid Math.random() in render path. */

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function makeStar(cx: number, cy: number, r: number): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const radius = i % 2 === 0 ? r : r * 0.4;
    points.push(`${cx + radius * Math.cos(angle)},${cy + radius * Math.sin(angle)}`);
  }
  return points.join(' ');
}

export function renderParticle(layer: ParticleLayer, _svg: SVGSVGElement): SVGElement {
  const g = createSVGElement('g');
  g.setAttribute('data-layer-id', layer.id);

  const count  = layer.count ?? 50;
  const size   = layer.size ?? 4;
  const speed  = layer.speed ?? 3;
  const colors = layer.colors ?? ['#6c5ce7', '#00cec9', '#fd79a8'];
  const shape  = layer.shape ?? 'circle';
  const spread = layer.spread ?? 1;

  const x = layer.x ?? 0;
  const y = layer.y ?? 0;
  const w = typeof layer.width  === 'number' ? layer.width  : 200;
  const h = typeof layer.height === 'number' ? layer.height : 200;

  const idSeed = hashString(layer.id);

  for (let i = 0; i < count; i++) {
    const seed = idSeed + i * 997;
    const px = x + seededRandom(seed)      * w * spread;
    const py = y + seededRandom(seed + 1)  * h * spread;
    const color = colors[i % colors.length];
    const animDelay = seededRandom(seed + 2) * speed;
    const animDur   = speed * (0.7 + seededRandom(seed + 3) * 0.6);
    const driftX    = (seededRandom(seed + 4) - 0.5) * size * 6;
    const driftY    = (seededRandom(seed + 5) - 0.5) * size * 6;

    let particle: SVGElement;
    if (shape === 'square') {
      particle = createSVGElement('rect', {
        x: px - size / 2,
        y: py - size / 2,
        width:  size,
        height: size,
        fill:   color,
        opacity: String(0.5 + seededRandom(seed + 6) * 0.5),
      });
    } else if (shape === 'star') {
      particle = createSVGElement('polygon', {
        points:  makeStar(px, py, size),
        fill:    color,
        opacity: String(0.5 + seededRandom(seed + 6) * 0.5),
      });
    } else {
      particle = createSVGElement('circle', {
        cx:      px,
        cy:      py,
        r:       size / 2,
        fill:    color,
        opacity: String(0.5 + seededRandom(seed + 6) * 0.5),
      });
    }

    // Floating CSS animation injected via inline style
    particle.setAttribute('style',
      `animation: folio-particle-float ${animDur.toFixed(2)}s ${animDelay.toFixed(2)}s ease-in-out infinite alternate;` +
      `--dp-dx:${driftX.toFixed(1)}px;--dp-dy:${driftY.toFixed(1)}px;`
    );

    g.appendChild(particle);
  }

  applyCommonAttributes(g, layer);
  if (layer.effects) applyEffects(g, layer.effects, _svg);

  return g;
}

// ── Interactive report controls (editor-canvas previews) ──────
// Static foreignObject previews so the studio shows + lets you select/edit these
// components (full interactivity lives in the HTML export runtime). The YAML/
// payload editor edits every field; these give a faithful visual on the canvas.

export function renderButton(layer: ButtonLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 200), h = numOr(layer.height, 46);
  const variant = layer.variant ?? 'solid';
  const bg = variant === 'solid' ? (layer.background ?? '#f5c842') : 'transparent';
  const col = layer.text_color ?? (variant === 'solid' ? '#0b0d12' : '#f5c842');
  const border = variant === 'ghost' || variant === 'link' ? 'none' : `1px solid ${layer.background ?? '#f5c842'}`;
  const r = layer.border_radius ?? 8;
  return foPreview(layer, w, h,
    `<div style="display:flex;align-items:center;justify-content:center;gap:7px;width:100%;height:100%;background:${bg};color:${col};border:${border};border-radius:${r}px;font-weight:600;">${layer.icon ? escHtml(layer.icon) + ' ' : ''}${escHtml(layer.label)}</div>`);
}

export function renderToggle(layer: ToggleLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 240), h = numOr(layer.height, 48);
  const opts = (layer.options ?? []).map((o, i) => {
    const lbl = typeof o === 'object' ? String(o.label) : String(o);
    const on = i === 0;
    return `<span style="padding:6px 14px;border-radius:6px;font-weight:600;${on ? 'background:#f5c842;color:#0b0d12;' : 'color:#9aa7b4;'}">${escHtml(lbl)}</span>`;
  }).join('');
  const lbl = layer.label ? `<span style="font-size:12px;color:#9aa7b4;font-weight:600;">${escHtml(layer.label)}</span>` : '';
  return foPreview(layer, w, h, `<div style="display:flex;align-items:center;gap:10px;height:100%;">${lbl}<div style="display:inline-flex;background:#1c1f2b;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:3px;gap:2px;">${opts}</div></div>`);
}

export function renderCallout(layer: CalloutLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 90);
  const v = layer.variant ?? 'info';
  const accent = { info: '#60a5fa', success: '#22c55e', warning: '#f5a623', danger: '#ef4444', neutral: '#9aa7b4' }[v];
  const icon = layer.icon ?? { info: 'ℹ', success: '✓', warning: '⚠', danger: '✕', neutral: '•' }[v];
  const title = layer.title ? `<div style="font-weight:700;margin-bottom:3px;">${escHtml(layer.title)}</div>` : '';
  // `content` is canonical; accept `text` as an alias (the field LLMs reach for).
  const body = layer.content ?? (layer as { text?: string }).text ?? '';
  return foPreview(layer, w, h,
    `<div style="display:flex;gap:12px;height:100%;padding:14px 16px;border:1px solid rgba(255,255,255,.1);border-left:4px solid ${accent};border-radius:10px;background:#161821;box-sizing:border-box;"><div style="color:${accent};font-size:18px;">${escHtml(icon)}</div><div style="font-size:14px;line-height:1.5;overflow:hidden;">${title}${escHtml(body)}</div></div>`);
}

export function renderProgress(layer: ProgressLayer, _svg: SVGSVGElement): SVGElement {
  const max = layer.max ?? 100;
  const pct = Math.max(0, Math.min(100, (layer.value / max) * 100));
  const color = layer.color ?? '#f5c842';
  const valText = `${layer.value}${layer.unit ?? (max === 100 ? '%' : '')}`;
  if (layer.style === 'radial') {
    const w = numOr(layer.width, 120), h = numOr(layer.height, 120);
    const r = 30, c = 2 * Math.PI * r, off = c * (1 - pct / 100);
    return foPreview(layer, w, h,
      `<div style="position:relative;width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><svg viewBox="0 0 80 80" style="width:90px;height:90px;transform:rotate(-90deg);"><circle cx="40" cy="40" r="${r}" fill="none" stroke="#1c1f2b" stroke-width="8"/><circle cx="40" cy="40" r="${r}" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/></svg><div style="position:absolute;font-weight:700;font-size:18px;">${escHtml(valText)}</div></div>`);
  }
  const w = numOr(layer.width, 280), h = numOr(layer.height, 60);
  const lbl = layer.label ? `<div style="display:flex;justify-content:space-between;font-size:12px;color:#9aa7b4;font-weight:600;margin-bottom:6px;"><span>${escHtml(layer.label)}</span><span>${escHtml(valText)}</span></div>` : '';
  return foPreview(layer, w, h,
    `<div style="display:flex;flex-direction:column;justify-content:center;height:100%;">${lbl}<div style="height:9px;border-radius:999px;background:#1c1f2b;overflow:hidden;"><div style="height:100%;width:${pct.toFixed(1)}%;background:${color};border-radius:999px;"></div></div></div>`);
}

export function renderTooltip(layer: TooltipLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 40), h = numOr(layer.height, 40);
  const trig = layer.icon ? escHtml(layer.icon) : (layer.label ? escHtml(layer.label) : 'ℹ');
  return foPreview(layer, w, h, `<div style="display:flex;align-items:center;justify-content:center;width:100%;height:100%;"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;border-radius:999px;background:#1c1f2b;color:#9aa7b4;font-size:12px;font-weight:700;padding:0 7px;">${trig}</span></div>`);
}

export function renderFilterBar(layer: FilterBarLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 56);
  const opts: string[] = (layer.options ?? []).map(o => (typeof o === 'object' ? String((o as { label: unknown }).label) : String(o)));
  const lbl = layer.label ? `<span style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#9aa7b4;font-weight:700;">${escHtml(layer.label)}</span>` : '';
  const all = layer.include_all !== false ? `<span style="padding:6px 14px;border-radius:999px;background:#f5c842;color:#0b0d12;font-size:13px;font-weight:600;">All</span>` : '';
  const chips = opts.map(o => `<span style="padding:6px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:13px;">${escHtml(o)}</span>`).join('');
  return foPreview(layer, w, h, `<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;height:100%;">${lbl}${all}${chips}</div>`);
}

export function renderTabs(layer: TabsLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 300);
  const active = layer.active ?? 0;
  const bar = (layer.tabs ?? []).map((t, i) =>
    `<span style="padding:9px 16px;font-weight:600;${i === active ? 'color:#f5c842;border-bottom:2px solid #f5c842;' : 'color:#9aa7b4;'}">${escHtml(t.label)}</span>`).join('');
  const cnt = (layer.tabs?.[active]?.layers ?? []).length;
  return foPreview(layer, w, h,
    `<div style="display:flex;flex-direction:column;height:100%;"><div style="display:flex;gap:4px;border-bottom:1px solid rgba(255,255,255,.1);">${bar}</div><div style="flex:1;display:flex;align-items:center;justify-content:center;color:#6b7685;font-size:13px;">Tab “${escHtml(layer.tabs?.[active]?.label ?? '')}” · ${cnt} layer(s)</div></div>`);
}

export function renderAccordion(layer: AccordionLayer, _svg: SVGSVGElement): SVGElement {
  const w = numOr(layer.width, 600), h = numOr(layer.height, 200);
  const items = (layer.items ?? []).map((it, i) => {
    const open = it.open ?? (i === 0);
    const body = open ? `<div style="padding:0 16px 14px;font-size:13px;color:#c2cad4;line-height:1.5;">${escHtml((it.body ?? '').slice(0, 160))}</div>` : '';
    return `<div style="border:1px solid rgba(255,255,255,.1);border-radius:10px;overflow:hidden;"><div style="padding:13px 16px;font-weight:600;display:flex;justify-content:space-between;">${escHtml(it.title)}<span style="color:#9aa7b4;">${open ? '▴' : '▾'}</span></div>${body}</div>`;
  }).join('');
  return foPreview(layer, w, h, `<div style="display:flex;flex-direction:column;gap:10px;">${items}</div>`);
}

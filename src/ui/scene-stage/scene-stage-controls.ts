/**
 * The stage's transport — play/pause, time, a scrub strip divided into scenes —
 * and the one thing the editor had no way to set: how each scene enters and how
 * long it stays on screen.
 *
 * Each segment is drawn at its planned length with its incoming transition
 * hatched at the front, because that is where the plan puts it: the transition
 * overlaps the start of the scene it brings in. Edits go through
 * state.setPageScene (undoable); the player re-plans on the state change and the
 * stage repaints the same moment.
 */

import type { StateManager } from '../../editor/state';
import type { ScenePlayer, ScenePlayerSnapshot } from '../../editor/scene-player';
import type { PageTransitionType } from '../../schema/types';
import { APPROXIMATED } from '../../export/scene-transition';
import { DEFAULT_TRANSITION_MS } from '../../export/scene-plan';

export interface Transport { element: HTMLElement; update(s: ScenePlayerSnapshot): void }

export const TRANSITION_TYPES: PageTransitionType[] = [
  'none', 'fade', 'dissolve', 'slide-left', 'slide-right', 'slide-up', 'slide-down',
  'wipe-left', 'wipe-right', 'reveal', 'zoom-in', 'zoom-out', 'flip-h', 'flip-v', 'cube-left', 'cube-right', 'morph',
];

export const BTN = 'background:#26262B;color:#F2F2F2;border:1px solid #3A3A40;border-radius:4px;min-width:34px;height:30px;font-size:13px;cursor:pointer;';
export const FIELD = 'background:#1E1E22;color:#F2F2F2;border:1px solid #3A3A40;border-radius:4px;height:26px;padding:0 6px;font-size:12px;';

export const secs = (ms: number): string => `${(ms / 1000).toFixed(1)}s`;
export const clampMs = (raw: string, lo: number, hi: number): number => Math.max(lo, Math.min(hi, Math.round(Number(raw) || 0)));

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

export function labelled(text: string, field: HTMLElement): HTMLElement {
  const l = el('label', 'display:flex;align-items:center;gap:6px;', text);
  l.appendChild(field);
  return l;
}

export function buildTransport(state: StateManager, player: ScenePlayer, onClose: () => void): Transport {
  const narrow = window.innerWidth < 768;
  const root = el('div', `flex:0 0 auto;display:flex;flex-direction:column;gap:${narrow ? 8 : 10}px;padding:${narrow ? '10px 12px 14px' : '12px 24px 18px'};background:#141416;color:#EDEDED;font:13px system-ui,sans-serif;border-top:1px solid #2A2A2E;padding-bottom:${narrow ? 'calc(14px + env(safe-area-inset-bottom, 0px))' : '18px'};`);
  const row = el('div', 'display:flex;align-items:center;gap:14px;');
  const playBtn = el('button', BTN, '▶');
  playBtn.className = 'scene-stage-play';
  playBtn.title = 'Play / pause (Space)';
  playBtn.addEventListener('click', () => player.toggle());
  const clock = el('span', 'font-variant-numeric:tabular-nums;min-width:96px;color:#BDBDBD;');
  clock.className = 'scene-stage-clock';
  const strip = el('div', 'position:relative;flex:1 1 auto;height:34px;display:flex;cursor:pointer;background:#1E1E22;border-radius:4px;overflow:hidden;');
  strip.className = 'scene-stage-strip';
  const head = el('div', 'position:absolute;top:0;bottom:0;width:2px;background:#FF5A3C;pointer-events:none;');
  const closeBtn = el('button', BTN, '✕');
  closeBtn.title = 'Close (Esc)';
  closeBtn.addEventListener('click', onClose);
  row.append(playBtn, clock, strip, closeBtn);
  const inspector = el('div', 'display:flex;align-items:center;gap:14px;flex-wrap:wrap;color:#BDBDBD;min-height:28px;');
  inspector.className = 'scene-stage-inspector';
  root.append(row, inspector);

  strip.addEventListener('click', e => {
    const r = strip.getBoundingClientRect();
    if (r.width > 0) player.seek(((e.clientX - r.left) / r.width) * player.total);
  });

  const drawStrip = (): void => {
    strip.replaceChildren();
    const plan = player.plan();
    const pages = state.get().design?.pages ?? [];
    const count = plan?.scenes.length ?? 1;
    const roomForLabels = (strip.clientWidth || window.innerWidth) / Math.max(1, count) >= 56;
    for (const sc of plan?.scenes ?? []) {
      const seg = el('div', `position:relative;flex:${sc.length_ms} 1 0;min-width:0;border-left:1px solid #0B0B0C;display:flex;align-items:center;padding:0 8px;overflow:hidden;`);
      seg.className = 'scene-stage-seg';
      seg.dataset['scene'] = String(sc.index);
      if (sc.transition) {
        const lead = el('div', `position:absolute;left:0;top:0;bottom:0;width:${(sc.transition.duration_ms / sc.length_ms) * 100}%;background:repeating-linear-gradient(135deg,#FF5A3C66 0 4px,transparent 4px 8px);`);
        lead.title = `enters with ${sc.transition.type}, ${sc.transition.duration_ms}ms`;
        seg.appendChild(lead);
      }
      // A label needs room to be a label. Seven scenes across a 250px phone
      // strip gave each one ~30px, which ellipsised every name down to a single
      // punctuation mark — a row of ":", "!" and "(" that read as corruption.
      // The inspector underneath names the current scene in full anyway.
      if (roomForLabels) {
        seg.appendChild(el('span', 'position:relative;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#D6D6D6;', `${sc.index + 1} ${pages[sc.index]?.label ?? sc.page_id}`));
      }
      strip.appendChild(seg);
    }
    strip.appendChild(head);
  };

  const drawInspector = (index: number): void => {
    inspector.replaceChildren();
    const sc = player.plan()?.scenes[index];
    const page = state.get().design?.pages?.[index];
    if (!sc || !page) return;
    inspector.appendChild(el('strong', 'color:#FFFFFF;font-weight:600;', `Scene ${index + 1} · ${page.label ?? page.id}`));
    const first = index === 0;
    const type = el('select', FIELD);
    type.className = 'scene-stage-transition';
    for (const t of TRANSITION_TYPES) type.appendChild(new Option(t === 'none' ? 'cut' : t, t));
    type.value = page.transition?.type ?? 'none';
    type.disabled = first;
    type.title = first ? 'The first scene opens the piece; it has nothing to enter from' : 'How this scene enters';
    const dur = el('input', `${FIELD}width:70px;`);
    Object.assign(dur, { type: 'number', min: '0', max: '3000', step: '50', value: String(page.transition?.duration ?? DEFAULT_TRANSITION_MS) });
    dur.disabled = first || type.value === 'none';
    const commitTransition = (): void => {
      const t = type.value as PageTransitionType;
      state.setPageScene(index, { transition: t === 'none' ? null : { ...page.transition, type: t, duration: clampMs(dur.value, 0, 3000) } });
    };
    type.addEventListener('change', commitTransition);
    dur.addEventListener('change', commitTransition);
    const len = el('input', `${FIELD}width:84px;`);
    Object.assign(len, { type: 'number', min: '100', step: '100', value: page.auto_advance ? String(page.auto_advance) : '', placeholder: `auto ${sc.length_ms}` });
    len.className = 'scene-stage-length';
    len.title = 'Time on screen, ms. Empty = its motion plus a 1.5s hold.';
    len.addEventListener('change', () => {
      state.setPageScene(index, { auto_advance: len.value.trim() === '' ? null : clampMs(len.value, 100, 60_000) });
    });
    inspector.append(labelled('Enters with', type), labelled('for ms', dur), labelled('On screen ms', len));
    const approx = page.transition ? APPROXIMATED[page.transition.type] : undefined;
    if (approx && !first) inspector.appendChild(el('span', 'color:#E8B04A;', approx));
    if (sc.words > 0 && sc.read_ms > sc.length_ms) inspector.appendChild(el('span', 'color:#8A8A8A;', `${sc.words} words, ~${secs(sc.read_ms)} to read`));
  };

  let drawnFrom: unknown = null;
  let inspected = -1;
  return {
    element: root,
    update(s) {
      playBtn.textContent = s.playing ? '❚❚' : '▶';
      clock.textContent = `${secs(s.time)} / ${secs(s.total)}`;
      const plan = player.plan();
      if (plan !== drawnFrom) { drawStrip(); drawnFrom = plan; inspected = -1; }
      head.style.left = `${s.total > 0 ? (s.time / s.total) * 100 : 0}%`;
      if (s.scene !== inspected) { drawInspector(s.scene); inspected = s.scene; }
    },
  };
}

/**
 * Size and smoothness for a video export, chosen before the server renders it.
 *
 * The first editor export rendered every video at full canvas size and the
 * engine's default fps: a 1920×1080 GIF at 12fps, heavy and visibly stepped.
 * This asks for both, shows what the choice costs in frames, and remembers the
 * last answer per format. Loaded on first use — the scene plan it estimates
 * with is not in the main bundle.
 */

import type { DesignSpec } from '../../schema/types';
import { planScenes } from '../../export/scene-plan';
import { animationDuration } from '../../export/gif-frames';
import { sourceOptions } from '../../renderer/resolve-source';
import type { VideoFormat } from './video-export';

export { exportVideo } from './video-export';

export interface VideoChoice { scale: number; fps: number }

export const FPS_CHOICES: Record<VideoFormat, number[]> = { gif: [10, 12, 15, 20, 25, 30, 50], mp4: [24, 25, 30, 50, 60] };
export const DEFAULT_CHOICE: Record<VideoFormat, VideoChoice> = { gif: { scale: 0.5, fps: 20 }, mp4: { scale: 1, fps: 30 } };
const SCALES = [1, 2 / 3, 1 / 2, 1 / 3, 1 / 4];

const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);

/** The sizes offered for a canvas, labelled in the pixels the file will have. */
export function sizeOptions(doc: { width: number; height: number }): Array<{ scale: number; label: string }> {
  return SCALES.map(scale => ({
    scale,
    label: `${even(doc.width * scale)} × ${even(doc.height * scale)}${scale === 1 ? ' (full)' : ''}`,
  }));
}

/** How long the export runs: the whole piece for a deck, the page's motion otherwise. */
export function exportDurationMs(design: DesignSpec, scenes: boolean): number {
  if (scenes) return planScenes(design).total_ms;
  return animationDuration(design.pages?.[0]?.layers ?? design.layers ?? [], sourceOptions(design, design.pages?.[0]));
}

const storageKey = (type: VideoFormat): string => `folio.videoExport.${type}`;

export function rememberedChoice(type: VideoFormat): VideoChoice {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(type)) ?? 'null') as Partial<VideoChoice> | null;
    if (saved && SCALES.includes(Number(saved.scale)) && FPS_CHOICES[type].includes(Number(saved.fps))) {
      return { scale: Number(saved.scale), fps: Number(saved.fps) };
    }
  } catch { /* no storage: use the defaults */ }
  return DEFAULT_CHOICE[type];
}

function remember(type: VideoFormat, choice: VideoChoice): void {
  try { localStorage.setItem(storageKey(type), JSON.stringify(choice)); } catch { /* private mode */ }
}

const FIELD = 'background:#1E1E22;color:#F2F2F2;border:1px solid #3A3A40;border-radius:4px;height:30px;padding:0 8px;font-size:13px;';
const BTN = 'border-radius:4px;height:32px;padding:0 16px;font-size:13px;cursor:pointer;border:1px solid #3A3A40;';

/** Ask how to render; resolves with the choice, or null when the dialog is cancelled. */
export function chooseVideoSettings(type: VideoFormat, design: DesignSpec, scenes: boolean): Promise<VideoChoice | null> {
  const start = rememberedChoice(type);
  const durationMs = exportDurationMs(design, scenes);
  return new Promise(resolve => {
    const backdrop = document.createElement('div');
    backdrop.className = 'video-export-dialog';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;';
    const box = document.createElement('div');
    box.setAttribute('role', 'dialog');
    box.style.cssText = 'background:#141416;color:#EDEDED;border:1px solid #2A2A2E;border-radius:8px;padding:20px 22px;width:340px;font:13px system-ui,sans-serif;display:flex;flex-direction:column;gap:14px;';
    const title = document.createElement('strong');
    title.style.cssText = 'font-size:15px;font-weight:600;';
    title.textContent = `Export ${type.toUpperCase()}${scenes ? ' · all pages' : ''}`;

    const size = document.createElement('select');
    size.className = 'video-export-size';
    size.style.cssText = FIELD;
    for (const o of sizeOptions(design.document)) size.appendChild(new Option(o.label, String(o.scale)));
    size.value = String(start.scale);
    const fps = document.createElement('select');
    fps.className = 'video-export-fps';
    fps.style.cssText = FIELD;
    for (const f of FPS_CHOICES[type]) fps.appendChild(new Option(`${f} fps`, String(f)));
    fps.value = String(start.fps);

    const cost = document.createElement('span');
    cost.className = 'video-export-cost';
    cost.style.cssText = 'color:#9A9AA0;';
    const choice = (): VideoChoice => ({ scale: Number(size.value), fps: Number(fps.value) });
    const describe = (): void => {
      const frames = Math.max(1, Math.round((durationMs / 1000) * choice().fps));
      cost.textContent = `${(durationMs / 1000).toFixed(1)}s · ${frames} frames to render`;
    };
    size.addEventListener('change', describe);
    fps.addEventListener('change', describe);
    describe();

    const row = (label: string, field: HTMLElement): HTMLElement => {
      const l = document.createElement('label');
      l.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;';
      l.append(label, field);
      return l;
    };
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.style.cssText = `${BTN}background:#26262B;color:#F2F2F2;`;
    const go = document.createElement('button');
    go.className = 'video-export-go';
    go.textContent = 'Export';
    go.style.cssText = `${BTN}background:#E5462D;color:#FFFFFF;border-color:#E5462D;`;
    actions.append(cancel, go);
    box.append(title, row('Size', size), row('Frame rate', fps), cost, actions);
    backdrop.appendChild(box);

    const finish = (result: VideoChoice | null): void => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      if (result) remember(type, result);
      resolve(result);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { e.stopPropagation(); finish(null); }
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); finish(choice()); }
    };
    cancel.addEventListener('click', () => finish(null));
    go.addEventListener('click', () => finish(choice()));
    backdrop.addEventListener('click', e => { if (e.target === backdrop) finish(null); });
    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(backdrop);
    go.focus();
  });
}
